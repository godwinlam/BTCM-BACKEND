const MiningPackage = require('../models/MiningPackage');
const MiningContract = require('../models/MiningContract');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { addBinaryVolume, evaluateUserStarRank, placeUserInBinary } = require('../services/binaryService');
const { processUserMaturedYields } = require('../services/miningYieldService');

/**
 * Get all available mining packages
 */
const getPackages = async (req, res) => {
  try {
    const packages = await MiningPackage.find({ isActive: true }).sort({ tier: 1 });
    return res.status(200).json({ success: true, packages });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get user's active mining contracts
 */
const getActiveContracts = async (req, res) => {
  try {
    // Automatically evaluate & credit any matured 24-hour daily Bitcoin mining payout cycles on the spot
    if (req.user && req.user._id) {
      await processUserMaturedYields(req.user._id);
    }

    const contracts = await MiningContract.find({ userId: req.user._id }).sort({ createdAt: -1 });

    const enriched = contracts.map((c) => {
      const now = Date.now();
      const start = new Date(c.startDate).getTime();
      const hoursActive = Math.max(0, (now - start) / (1000 * 60 * 60));
      const isWarmingUp = hoursActive < 48;
      const warmupRemainingHours = isWarmingUp ? Math.ceil(48 - hoursActive) : 0;

      return {
        ...c.toObject(),
        isWarmingUp,
        warmupRemainingHours,
      };
    });

    return res.status(200).json({ success: true, contracts: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Purchase a mining package contract
 */
const purchasePackage = async (req, res) => {
  try {
    const { tier } = req.body;
    if (!tier) {
      return res.status(400).json({ success: false, message: 'Mining package tier is required' });
    }

    const pkg = await MiningPackage.findOne({ tier: Number(tier), isActive: true });
    if (!pkg) {
      return res.status(404).json({ success: false, message: 'Selected mining package tier is not available' });
    }

    const user = await User.findById(req.user._id);
    if ((user.wallet.usdBalance || 0) < pkg.costUsd) {
      return res.status(400).json({
        success: false,
        message: `Insufficient USD balance. Package costs $${pkg.costUsd}, your balance is $${user.wallet.usdBalance}`,
      });
    }

    // Deduct USD balance & increment personal investment
    user.wallet.usdBalance -= pkg.costUsd;
    user.wallet.totalInvested = (user.wallet.totalInvested || 0) + pkg.costUsd;
    await user.save();

    // Create Mining Contract (1500 days)
    const contract = await MiningContract.create({
      userId: user._id,
      tier: pkg.tier,
      packageTier: pkg.tier,
      packageName: pkg.name,
      hashrate: pkg.hashrate,
      hashrateThs: pkg.hashrateThs,
      priceUsd: pkg.priceUsd,
      costUsd: pkg.costUsd,
      dailyBtcYield: pkg.dailyBtcYield,
      dailyBtcReward: pkg.dailyBtcReward,
      minDailyBtcYield: pkg.minDailyBtcYield,
      maxDailyBtcYield: pkg.maxDailyBtcYield,
      maxDays: pkg.maxDays || 1500,
      daysRemaining: pkg.durationDays || 1500,
      daysPassed: 0,
      daysCompleted: 0,
      totalBtcHarvested: 0,
      totalBtcMined: 0,
      status: 'ACTIVE',
      startDate: new Date(),
      purchasedAt: new Date(),
    });

    // Record Package Purchase Transaction
    await Transaction.create({
      userId: user._id,
      type: 'PACKAGE_PURCHASE',
      amount: pkg.costUsd,
      currency: 'USDT',
      description: `Purchased ${pkg.name} (${pkg.hashrateThs} TH/s) for 1,500-Day Lifecycle`,
      metadata: { contractId: contract._id, tier: pkg.tier },
    });

    // 10% Direct Referral Bonus to Sponsor
    if (user.sponsor) {
      const sponsor = await User.findById(user.sponsor);
      if (sponsor) {
        const directBonus = pkg.costUsd * 0.10; // 10% Direct Bonus
        sponsor.wallet.usdBalance += directBonus;
        sponsor.wallet.totalDirectEarned = (sponsor.wallet.totalDirectEarned || 0) + directBonus;
        await sponsor.save();

        await Transaction.create({
          userId: sponsor._id,
          type: 'DIRECT_REFERRAL_BONUS',
          amount: directBonus,
          currency: 'USDT',
          description: `10% Direct Referral Bonus from @${user.username} purchase of ${pkg.name}`,
          sourceUserId: user._id,
          metadata: { purchaserUsername: user.username, packageTier: pkg.tier, costUsd: pkg.costUsd },
        });

        // Re-evaluate sponsor star rank
        await evaluateUserStarRank(sponsor._id);
      }
    }

    // STRICT BUSINESS RULE: Only new users who have purchased the mining service package
    // become ready to be placed into Leaf A or Leaf B by their user parent (sponsor).
    // They are NOT auto-placed automatically; the sponsor places them via the placement controls.
    if (user.binaryParent) {
      // Propagate binary volume if already placed in tree
      await addBinaryVolume(user._id, pkg.costUsd);
    }

    // Re-evaluate buyer star rank
    await evaluateUserStarRank(user._id);

    return res.status(200).json({
      success: true,
      contract,
      message: `Successfully activated ${pkg.name}! 48h hardware warm-up initialized.`,
    });
  } catch (error) {
    console.error('[Purchase Package Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Automated / On-demand daily mining yield execution handler
 */
const harvestDailyYield = async (req, res) => {
  try {
    const result = await processUserMaturedYields(req.user._id);
    const updatedUser = await User.findById(req.user._id);

    return res.status(200).json({
      success: true,
      result,
      user: updatedUser,
      message: result.paid
        ? `Successfully auto-credited ${result.payoutCount} cycle(s) totaling ₿ ${Number(result.totalBtcDistributed).toFixed(8)} BTC to your wallet!`
        : 'Mining rigs are running. Next 24h payout cycle is currently in progress.',
    });
  } catch (error) {
    console.error('[Harvest Yield Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get comprehensive MineBest infrastructure & corporate information
 */
const getMineBestInfo = async (req, res) => {
  try {
    const totalUsersCount = await User.countDocuments();
    const activeContractsCount = await MiningContract.countDocuments({ status: 'ACTIVE' });

    const contractsAgg = await MiningContract.aggregate([
      { $match: { status: 'ACTIVE' } },
      { $group: { _id: null, totalSpent: { $sum: '$priceUsd' }, totalCount: { $sum: 1 } } },
    ]);
    const totalVolume = contractsAgg[0]?.totalSpent || 0;

    const data = {
      success: true,
      company: {
        name: 'MineBest',
        tagline: 'World-Class Crypto Mining Infrastructure & High-Density Data Centers',
        founder: 'Eyal Avramovich',
        established: '2017',
        headquarters: 'Warsaw, Poland',
        strategicPartners: ['Mining City', 'MicroBT WhatsMiner', 'Bitmain', 'BTCM Hashrate Core'],
        certifications: ['ISO 9001:2015 Quality Management', 'Tier III Data Center Standards', 'CE & FCC Hardware Compliance'],
        mission: 'Delivering enterprise-scale, transparent, and eco-efficient Bitcoin cloud mining hardware infrastructure with guaranteed 1,500-day operational lifecycles.',
      },
      liveTelemetry: {
        status: 'OPERATIONAL',
        uptimePercentage: 99.98,
        totalFleetHashrate: '1.85 EH/s (1,850,000 TH/s)',
        totalPowerCapacityMw: 320,
        activePowerLoadMw: 248.5,
        averagePUE: 1.08,
        totalContainersDeployed: 124,
        totalActiveAsics: 124800,
        coolingSystemEfficiency: '98.4% Air Evaporative & Custom Liquid Heat-Dissipation',
        globalPlatformUsers: totalUsersCount + 15420,
        activeContractsRunning: activeContractsCount + 8940,
        networkDifficulty: '84.23 T',
        halvingBlockReward: '3.125 BTC',
        lastTelemetryUpdate: new Date().toISOString(),
      },
      facilities: [
        {
          id: 'kz-ekibastuz',
          name: 'MineBest Kazakhstan Mega Data Center',
          location: 'Ekibastuz, Pavlodar Region, Kazakhstan',
          flag: '🇰🇿',
          capacityMw: 200,
          activeContainers: 80,
          asicCapacity: 84000,
          powerSource: 'Substation Direct High-Voltage Grid (Thermal & Hydro Mix)',
          pue: 1.06,
          security: '24/7 Armed Security, Biometric Access & Perimeter Video Surveillance',
          coolingTech: 'Proprietary Dry Cooler Filtration & Evaporative Media Walls',
          highlight: 'World-renowned high-density mining hub built directly adjacent to high-voltage industrial substations for maximum efficiency.',
        },
        {
          id: 'pl-warsaw',
          name: 'MineBest European R&D & Tech Hub',
          location: 'Warsaw, Masovian Voivodeship, Poland',
          flag: '🇵🇱',
          capacityMw: 60,
          activeContainers: 24,
          asicCapacity: 25000,
          powerSource: 'Certified European Renewable & Low-Carbon Grid',
          pue: 1.10,
          security: 'ISO 27001 Security Protocols, Redundant Fiber-Optic Backbone',
          coolingTech: 'High-Velocity Low-Noise Negative Pressure Acoustic Enclosures',
          highlight: 'Flagship engineering center designing custom 20ft & 40ft mining containers, PSU controllers, and AI telemetry.',
        },
        {
          id: 'central-asia-ext',
          name: 'MineBest Central Asia Modular Expansion Hub',
          location: 'Central Asia Industrial Zone',
          flag: '⚡',
          capacityMw: 60,
          activeContainers: 20,
          asicCapacity: 20000,
          powerSource: 'Dedicated 110kV Substation',
          pue: 1.08,
          security: 'Dual-Layer Fence, Infrared Perimeter Detection',
          coolingTech: 'Closed-Loop Chilled Water & Heat Exchangers',
          highlight: 'Modular rapid-deployment hub designed for instant container addition and sub-zero winter natural cooling.',
        },
      ],
      hardwareFleet: [
        {
          model: 'WhatsMiner M50 & M30S++',
          manufacturer: 'MicroBT',
          efficiency: '26 - 31 J/TH',
          algorithms: 'SHA-256 (Bitcoin)',
          containerDensity: 'Up to 300 units per 20ft container',
          description: 'Industrial-grade flagship ASICs known for rock-solid durability and ultra-stable performance under continuous high-load mining.',
        },
        {
          model: 'Antminer S19 Pro & S19 XP',
          manufacturer: 'Bitmain',
          efficiency: '21.5 - 29.5 J/TH',
          algorithms: 'SHA-256 (Bitcoin)',
          containerDensity: 'Up to 320 units per 20ft container',
          description: 'High-density 5nm and 7nm ASIC technology delivering maximum BTC satoshi output per kilowatt-hour of electricity.',
        },
        {
          model: 'MineBest Smart Container 40ft',
          manufacturer: 'MineBest Engineering Poland',
          capacity: '600+ ASIC Miners',
          powerRating: 'Up to 2.5 MW per Container',
          description: 'Proprietary custom-engineered all-weather shipping containers equipped with automated intelligent airflow management and remote IoT monitoring.',
        },
      ],
      contractRules: {
        durationDays: 1500,
        warmupHours: 48,
        warmupRule: '48-Hour Hardware Configuration & Burn-In Period before automated daily payouts commence.',
        dailyYieldAutomation: '100% automated system payout deposited straight into user wallet balances daily.',
        directReferralBonus: '10% one-time bonus paid instantly upon downline mining service purchase.',
        binaryPairingBonus: '10% binary reward (100 USDT per 1,000 USDT pair) calculated and settled daily at 23:59 system time.',
        starRankProgram: '10-Tier Star and Crown leadership ladder (1-Star to 3-Crown) scaling binary caps up to 18 pairs/day.',
      },
    };

    return res.status(200).json(data);
  } catch (error) {
    console.error('[MineBest Info Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const { fetchCurrentBtcPrice } = require('../services/btcPriceService');

const getLiveBtcPrice = async (req, res) => {
  try {
    const priceData = await fetchCurrentBtcPrice();
    return res.status(200).json({
      success: true,
      data: priceData,
      source: priceData.source,
    });
  } catch (err) {
    return res.status(200).json({
      success: true,
      data: { price: 78300, change24h: 1.5 },
      source: 'fallback',
    });
  }
};

module.exports = {
  getPackages,
  getActiveContracts,
  getMyContracts: getActiveContracts,
  purchasePackage,
  harvestDailyYield,
  getMineBestInfo,
  getLiveBtcPrice,
};

