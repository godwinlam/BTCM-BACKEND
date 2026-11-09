require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const MiningPackage = require('./models/MiningPackage');
const MiningContract = require('./models/MiningContract');
const Transaction = require('./models/Transaction');
const Datacenter = require('./models/Datacenter');
const SystemSetting = require('./models/SystemSetting');
const { connectDB } = require('./config/db');

async function seed() {
  await connectDB();
  console.log('[Mongoose Seed]: Initializing database seeds on MongoDB Atlas...');

  // 1. Admin & Root Users
  let admin = await User.findOne({ username: 'admin' });
  if (!admin) {
    admin = await User.create({
      username: 'admin',
      email: 'admin@btcm.network',
      password: 'admin',
      fullName: 'Chief Mining Administrator',
      referralCode: 'ROOTADMIN',
      role: 'admin',
      starRank: 10,
      phone: '+1 (555) 019-2831',
      country: 'United States',
      address: '742 Evergreen Terrace, Springfield, OR 97477',
      usdtTrc20PayoutAddress: 'TXv2nE8gQ6R4mN9kY7bL1jF5cW3pA8sD6Z',
      usdtErc20PayoutAddress: '0x71C26a6FfE65fF6D19Fe43d57fB0bC182A4',
      usdcPayoutAddress: '0x99A8c281313F101A84FE59a68a529949dF0',
      btcPayoutAddress: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
      wallet: {
        usdBalance: 150000,
        btcBalance: 12.85,
        totalInvested: 60000,
        totalDirectEarned: 18500,
        totalBinaryEarned: 32400,
        totalMiningBtcEarned: 8.45,
      },
      binaryLegs: {
        legACurrent: 45000,
        legBCurrent: 38000,
        legATotal: 280000,
        legBTotal: 265000,
        pairsCount: 265,
      },
    });
    console.log('[Mongoose Seed]: Admin created (admin / admin)');
  }

  // 2. Demo User (andy)
  let andy = await User.findOne({ username: 'andy' });
  if (!andy) {
    andy = await User.create({
      username: 'andy',
      email: 'andy@btcm.network',
      password: 'admin',
      fullName: 'Andy Kowalski',
      referralCode: 'BTCCEA6D8',
      sponsor: admin._id,
      binaryParent: admin._id,
      binaryPosition: 'A',
      role: 'user',
      starRank: 3,
      phone: '+1 (415) 890-1234',
      country: 'United States',
      address: '100 Montgomery St, Suite 1500, San Francisco, CA 94104',
      usdtTrc20PayoutAddress: 'TYd38H2sM9qK1jL4vN8cB6xP5wE7tA2zR1',
      usdtErc20PayoutAddress: '0x882A31f49B5b89a4Ec5f70D7C5392B7B342',
      usdcPayoutAddress: '0x123F45E67A89B0C1D2E3F45A67B89C0D1E2',
      btcPayoutAddress: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      wallet: {
        usdBalance: 5800.5,
        btcBalance: 0.18524,
        totalInvested: 6400,
        totalDirectEarned: 850,
        totalBinaryEarned: 1200,
        totalMiningBtcEarned: 0.18524,
      },
      binaryLegs: {
        legACurrent: 12000,
        legBCurrent: 8000,
        legATotal: 58000,
        legBTotal: 46000,
        pairsCount: 46,
      },
    });

    admin.binaryLeftChild = andy._id;
    await admin.save();
    console.log('[Mongoose Seed]: Demo user created (andy / admin)');
  }

  // Downlines under Andy for binary tree demo
  let bob = await User.findOne({ username: 'bob' });
  if (!bob) {
    bob = await User.create({
      username: 'bob',
      email: 'bob@btcm.network',
      password: 'admin',
      fullName: 'Robert Chen',
      referralCode: 'BTCBOB777',
      sponsor: andy._id,
      binaryParent: andy._id,
      binaryPosition: 'A',
      starRank: 2,
      role: 'user',
      wallet: {
        usdBalance: 1200,
        btcBalance: 0.045,
        totalInvested: 3000,
      },
      binaryLegs: {
        legACurrent: 4000,
        legBCurrent: 3000,
        legATotal: 15000,
        legBTotal: 12000,
        pairsCount: 12,
      },
    });
    andy.binaryLeftChild = bob._id;
    await andy.save();
  }

  let charlie = await User.findOne({ username: 'charlie' });
  if (!charlie) {
    charlie = await User.create({
      username: 'charlie',
      email: 'charlie@btcm.network',
      password: 'admin',
      fullName: 'Charlie Davis',
      referralCode: 'BTCCHARLIE9',
      sponsor: andy._id,
      binaryParent: andy._id,
      binaryPosition: 'B',
      starRank: 1,
      role: 'user',
      wallet: {
        usdBalance: 850,
        btcBalance: 0.021,
        totalInvested: 1000,
      },
      binaryLegs: {
        legACurrent: 2000,
        legBCurrent: 1000,
        legATotal: 8000,
        legBTotal: 6000,
        pairsCount: 6,
      },
    });
    andy.binaryRightChild = charlie._id;
    await andy.save();
  }

  // 3. Official 6 Mining Packages (1,500-day enterprise tiers)
  const packages = [
    {
      tier: 100,
      name: 'Antminer Starter 100',
      tagline: 'Entry-level Cloud ASIC Node',
      priceUsd: 100,
      costUsd: 100,
      hashrate: '5.5 TH/s',
      hashrateThs: 5.5,
      dailyBtcYield: 0.00000103,
      dailyBtcReward: 0.00000103,
      minDailyBtcYield: 0.000001,
      maxDailyBtcYield: 0.00000105,
      maxDays: 1500,
      durationDays: 1500,
      estimatedDailyUsd: 0.21,
      efficiency: '29.5 J/TH',
      badge: 'STARTER',
      datacenterName: 'Nordic Geo Station (Reykjavik)',
      latitude: 64.1466,
      longitude: -21.9426,
      description: 'Compact cloud ASIC node with direct renewable power link (1,500-day contract lifecycle)',
      isActive: true,
    },
    {
      tier: 300,
      name: 'WhatsMiner M30S 300',
      tagline: 'High-Efficiency MicroBT Rig',
      priceUsd: 300,
      costUsd: 300,
      hashrate: '17.5 TH/s',
      hashrateThs: 17.5,
      dailyBtcYield: 0.00000305,
      dailyBtcReward: 0.00000305,
      minDailyBtcYield: 0.000003,
      maxDailyBtcYield: 0.0000031,
      maxDays: 1500,
      durationDays: 1500,
      estimatedDailyUsd: 0.51,
      efficiency: '29.5 J/TH',
      badge: 'POPULAR',
      datacenterName: 'Quebec Hydro Vault',
      latitude: 46.8139,
      longitude: -71.2082,
      description: 'Commercial WhatsMiner ASIC array deployed in cold climate zero-emission vault (1,500-day contract lifecycle)',
      isActive: true,
    },
    {
      tier: 1000,
      name: 'Avalon Miner 1246 Pro',
      tagline: 'Standard Enterprise Mining Unit',
      priceUsd: 1000,
      costUsd: 1000,
      hashrate: '62.0 TH/s',
      hashrateThs: 62.0,
      dailyBtcYield: 0.00003633,
      dailyBtcReward: 0.00003633,
      minDailyBtcYield: 0.00003578,
      maxDailyBtcYield: 0.00003688,
      maxDays: 1500,
      durationDays: 1500,
      estimatedDailyUsd: 8.4,
      efficiency: '29.5 J/TH',
      badge: 'BEST VALUE',
      datacenterName: 'Texas Wind & Solar Complex',
      latitude: 31.9686,
      longitude: -99.9018,
      description: 'Enterprise Avalon miner powered by bifacial solar and ERCOT grid curtailment (1,500-day contract lifecycle)',
      isActive: true,
    },
    {
      tier: 5000,
      name: 'Antminer S19 XP Hydro',
      tagline: 'Liquid Cooled Mining Cluster',
      priceUsd: 5000,
      costUsd: 5000,
      hashrate: '335.0 TH/s',
      hashrateThs: 335.0,
      dailyBtcYield: 0.0001795,
      dailyBtcReward: 0.0001795,
      minDailyBtcYield: 0.000179,
      maxDailyBtcYield: 0.00018,
      maxDays: 1500,
      durationDays: 1500,
      estimatedDailyUsd: 45.5,
      efficiency: '29.5 J/TH',
      badge: 'PROFESSIONAL',
      datacenterName: 'Swedish Arctic Datacenter',
      latitude: 65.5848,
      longitude: 22.1567,
      description: 'Closed-loop hydro-cooled S19 cluster achieving whisper-quiet operations and sub-1.05 PUE (1,500-day contract lifecycle)',
      isActive: true,
    },
    {
      tier: 10000,
      name: 'Bitmain Mega Hydro Pod',
      tagline: 'High-Density Datacenter Container',
      priceUsd: 10000,
      costUsd: 10000,
      hashrate: '710.0 TH/s',
      hashrateThs: 710.0,
      dailyBtcYield: 0.0003615,
      dailyBtcReward: 0.0003615,
      minDailyBtcYield: 0.000358,
      maxDailyBtcYield: 0.000365,
      maxDays: 1500,
      durationDays: 1500,
      estimatedDailyUsd: 96.6,
      efficiency: '29.5 J/TH',
      badge: 'INSTITUTIONAL',
      datacenterName: 'Alpine Zero-Carbon Hub (Switzerland)',
      latitude: 46.8182,
      longitude: 8.2275,
      description: 'High-density modular hydro container deployed in subterranean Alpine facility (1,500-day contract lifecycle)',
      isActive: true,
    },
    {
      tier: 30000,
      name: 'GigaCluster Mega ASIC Array',
      tagline: 'Ultimate Industrial Hashrate Farm',
      priceUsd: 30000,
      costUsd: 30000,
      hashrate: '2350.0 TH/s',
      hashrateThs: 2350.0,
      dailyBtcYield: 0.0010775,
      dailyBtcReward: 0.0010775,
      minDailyBtcYield: 0.001075,
      maxDailyBtcYield: 0.00108,
      maxDays: 1500,
      durationDays: 1500,
      estimatedDailyUsd: 315,
      efficiency: '29.5 J/TH',
      badge: 'WHALE ELITE',
      datacenterName: 'Paraguay Itaipu Hydro Mega Farm',
      latitude: -25.4087,
      longitude: -54.5889,
      description: 'Industrial megawatt-scale ASIC array tied directly to the world-renowned Itaipu Hydroelectric Dam (1,500-day contract lifecycle)',
      isActive: true,
    },
  ];

  for (const pkg of packages) {
    await MiningPackage.findOneAndUpdate({ tier: pkg.tier }, pkg, { upsert: true, new: true });
  }
  console.log(`[Mongoose Seed]: ${packages.length} Official Mining Packages seeded.`);

  // 4. Sample active contracts for Andy
  const existingContracts = await MiningContract.countDocuments({ userId: andy._id });
  if (existingContracts === 0) {
    await MiningContract.create({
      userId: andy._id,
      tier: 1000,
      packageTier: 1000,
      packageName: 'Avalon Miner 1246 Pro',
      hashrate: '62.0 TH/s',
      hashrateThs: 62.0,
      priceUsd: 1000,
      costUsd: 1000,
      dailyBtcYield: 0.00003633,
      dailyBtcReward: 0.00003633,
      minDailyBtcYield: 0.00003578,
      maxDailyBtcYield: 0.00003688,
      maxDays: 1500,
      daysRemaining: 1478,
      daysCompleted: 22,
      daysPassed: 22,
      totalBtcHarvested: 0.00079926,
      totalBtcMined: 0.00079926,
      status: 'ACTIVE',
      startDate: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000),
      purchasedAt: new Date(Date.now() - 22 * 24 * 60 * 60 * 1000),
    });

    await MiningContract.create({
      userId: andy._id,
      tier: 5000,
      packageTier: 5000,
      packageName: 'Antminer S19 XP Hydro',
      hashrate: '335.0 TH/s',
      hashrateThs: 335.0,
      priceUsd: 5000,
      costUsd: 5000,
      dailyBtcYield: 0.0001795,
      dailyBtcReward: 0.0001795,
      minDailyBtcYield: 0.000179,
      maxDailyBtcYield: 0.00018,
      maxDays: 1500,
      daysRemaining: 1492,
      daysCompleted: 8,
      daysPassed: 8,
      totalBtcHarvested: 0.001436,
      totalBtcMined: 0.001436,
      status: 'ACTIVE',
      startDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      purchasedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    });
    console.log('[Mongoose Seed]: Seeded active contracts for demo user @andy.');
  }

  // 5. Datacenters with GeoJSON coordinates
  const datacenters = [
    {
      name: 'Nordic Geo Station (Reykjavik)',
      country: 'Iceland',
      location: { type: 'Point', coordinates: [-21.9426, 64.1466] },
      hashrateThs: 25000,
      energySource: '100% Geothermal & Hydro',
      pue: 1.02,
      status: 'OPERATIONAL',
    },
    {
      name: 'Quebec Hydro Vault',
      country: 'Canada',
      location: { type: 'Point', coordinates: [-71.2082, 46.8139] },
      hashrateThs: 42000,
      energySource: 'Hydro-Québec Renewable Power',
      pue: 1.04,
      status: 'OPERATIONAL',
    },
    {
      name: 'Texas Wind & Solar Complex',
      country: 'United States',
      location: { type: 'Point', coordinates: [-99.9018, 31.9686] },
      hashrateThs: 68000,
      energySource: 'Bifacial Solar & ERCOT Wind',
      pue: 1.06,
      status: 'OPERATIONAL',
    },
    {
      name: 'Swedish Arctic Datacenter',
      country: 'Sweden',
      location: { type: 'Point', coordinates: [22.1567, 65.5848] },
      hashrateThs: 38000,
      energySource: 'Glacial Hydroelectric',
      pue: 1.03,
      status: 'OPERATIONAL',
    },
    {
      name: 'Alpine Zero-Carbon Hub (Switzerland)',
      country: 'Switzerland',
      location: { type: 'Point', coordinates: [8.2275, 46.8182] },
      hashrateThs: 31000,
      energySource: 'Swiss Run-of-River Hydro',
      pue: 1.02,
      status: 'OPERATIONAL',
    },
    {
      name: 'Paraguay Itaipu Hydro Mega Farm',
      country: 'Paraguay',
      location: { type: 'Point', coordinates: [-54.5889, -25.4087] },
      hashrateThs: 95000,
      energySource: 'Itaipu Hydroelectric Dam',
      pue: 1.03,
      status: 'OPERATIONAL',
    },
  ];

  for (const dc of datacenters) {
    await Datacenter.findOneAndUpdate({ name: dc.name }, dc, { upsert: true });
  }
  console.log(`[Mongoose Seed]: ${datacenters.length} Datacenters seeded.`);

  // 6. System Settings
  const settings = [
    { key: 'usdt_deposit_address', value: 'TXv2nE8gQ6R4mN9kY7bL1jF5cW3pA8sD6Z', description: 'Official USDT TRC20 Deposit Address' },
    { key: 'usdt_deposit_network', value: 'TRC20 (Tron Network)', description: 'Default USDT network' },
    { key: 'btc_deposit_address', value: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', description: 'Official Bitcoin Native SegWit Address' },
    { key: 'usdc_deposit_address', value: '0x71C26a6FfE65fF6D19Fe43d57fB0bC182A4', description: 'Official USD Coin (USDC) Address' },
    { key: 'binary_pairing_percent', value: 10, description: '10% Binary Pairing Rate (100 USDT per 1,000)' },
    { key: 'direct_referral_percent', value: 10, description: '10% Instant Direct Referral Reward' },
    { key: 'contract_duration_days', value: 1500, description: 'Enterprise 1,500-day contract lifecycle' },
    { key: 'hardware_warmup_hours', value: 48, description: '48h ASIC node calibration rule' },
  ];

  for (const s of settings) {
    await SystemSetting.findOneAndUpdate({ key: s.key }, s, { upsert: true });
  }
  console.log(`[Mongoose Seed]: System Settings verified.`);

  console.log('=======================================================');
  console.log('🎉 [Mongoose Seed Complete]: Database successfully populated on MongoDB Atlas!');
  console.log('=======================================================');
  process.exit(0);
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('[Mongoose Seed Error]:', err);
    process.exit(1);
  });
}

module.exports = seed;
