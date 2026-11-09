const MiningContract = require('../models/MiningContract');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

/**
 * Process any matured 24-hour daily Bitcoin mining payout cycles for a specific user.
 * Runs automatically upon dashboard/contract load or payout timer trigger.
 */
async function processUserMaturedYields(userId) {
  const now = new Date();
  const WARMUP_HOURS = 48;

  const activeContracts = await MiningContract.find({
    userId,
    status: 'ACTIVE',
    daysRemaining: { $gt: 0 },
  });

  if (!activeContracts || activeContracts.length === 0) {
    return { paid: false, payoutCount: 0, totalBtcDistributed: 0 };
  }

  const user = await User.findById(userId);
  if (!user) return { paid: false, payoutCount: 0, totalBtcDistributed: 0 };

  let payoutCount = 0;
  let totalBtcDistributed = 0;

  for (const contract of activeContracts) {
    const startDate = new Date(contract.startDate || contract.createdAt);
    const contractAgeHours = (now.getTime() - startDate.getTime()) / (1000 * 60 * 60);

    // 48h hardware warm-up rule
    if (contractAgeHours < WARMUP_HOURS) {
      continue;
    }

    // Determine baseline from which 24h cycles are measured
    const activationTime = startDate.getTime() + WARMUP_HOURS * 60 * 60 * 1000;
    const lastYieldTime = contract.lastYieldAt || contract.lastHarvestAt
      ? new Date(contract.lastYieldAt || contract.lastHarvestAt).getTime()
      : activationTime;

    const msSinceLastYield = now.getTime() - lastYieldTime;
    const cyclesDue = Math.floor(msSinceLastYield / (24 * 60 * 60 * 1000));

    if (cyclesDue < 1) {
      continue;
    }

    const effectiveCycles = Math.min(cyclesDue, contract.daysRemaining);
    if (effectiveCycles <= 0) continue;

    const btcYieldPerDay = contract.dailyBtcReward || contract.dailyBtcYield || 0;
    if (btcYieldPerDay <= 0) continue;

    const totalBtcForContract = btcYieldPerDay * effectiveCycles;

    // Credit user's wallet
    user.wallet.btcBalance = (user.wallet.btcBalance || 0) + totalBtcForContract;
    user.wallet.totalMiningBtcEarned = (user.wallet.totalMiningBtcEarned || 0) + totalBtcForContract;

    // Advance contract progress and set lastHarvestAt / lastYieldAt
    contract.daysRemaining = Math.max(0, contract.daysRemaining - effectiveCycles);
    contract.daysPassed = (contract.daysPassed || 0) + effectiveCycles;
    contract.daysCompleted = (contract.daysCompleted || 0) + effectiveCycles;
    contract.totalBtcMined = (contract.totalBtcMined || 0) + totalBtcForContract;
    contract.totalBtcHarvested = (contract.totalBtcHarvested || 0) + totalBtcForContract;

    // Advance last harvest timestamp by the credited 24h cycle duration
    const newLastYieldTime = new Date(lastYieldTime + effectiveCycles * 24 * 60 * 60 * 1000);
    contract.lastYieldAt = newLastYieldTime;
    contract.lastHarvestAt = newLastYieldTime;

    if (contract.daysRemaining <= 0) {
      contract.status = 'EXPIRED';
    }
    await contract.save();

    // Record yield transaction
    await Transaction.create({
      userId: user._id,
      type: 'MINING_YIELD',
      amount: totalBtcForContract,
      currency: 'BTC',
      description: `Automated Daily Bitcoin Mining Yield (${effectiveCycles}x 24h cycle) from ${contract.packageName} (${contract.hashrate || contract.hashrateThs + ' TH/s'})`,
      metadata: {
        contractId: contract._id,
        packageTier: contract.tier || contract.packageTier,
        cyclesCredited: effectiveCycles,
        daysRemaining: contract.daysRemaining,
        daysCompleted: contract.daysCompleted,
      },
    });

    payoutCount += effectiveCycles;
    totalBtcDistributed += totalBtcForContract;
  }

  if (payoutCount > 0) {
    await user.save();
    console.log(`[Mongoose Auto-Yield]: Auto-credited ${payoutCount} cycle(s) totaling ₿${totalBtcDistributed.toFixed(8)} to @${user.username} (New balance: ₿${user.wallet.btcBalance.toFixed(8)})`);
  }

  return {
    paid: payoutCount > 0,
    payoutCount,
    totalBtcDistributed,
    newBtcBalance: user.wallet.btcBalance,
  };
}

/**
 * Execute automated daily mining yield payout across all active contracts for all users
 */
async function runAutoDailyYield() {
  const activeContracts = await MiningContract.find({
    status: 'ACTIVE',
    daysRemaining: { $gt: 0 },
  }).select('userId');

  const uniqueUserIds = [...new Set(activeContracts.map((c) => String(c.userId)))];
  let totalPayouts = 0;
  let totalBtc = 0;

  for (const userId of uniqueUserIds) {
    try {
      const res = await processUserMaturedYields(userId);
      if (res.paid) {
        totalPayouts += res.payoutCount;
        totalBtc += res.totalBtcDistributed;
      }
    } catch (e) {
      console.error(`[Auto-Yield Error for User ${userId}]:`, e.message);
    }
  }

  if (totalPayouts > 0) {
    console.log(`[Mongoose Auto-Yield]: Completed run. Total payouts: ${totalPayouts}, Total BTC: ₿${totalBtc.toFixed(8)}`);
  }
  return { success: true, payoutCount: totalPayouts, totalBtcDistributed: totalBtc };
}

/**
 * Start automated background yield checker (runs every 60 seconds)
 */
function startAutoYieldScheduler() {
  const CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds continuous evaluation
  setInterval(async () => {
    try {
      await runAutoDailyYield();
    } catch (err) {
      console.error('[Mongoose Auto-Yield Scheduler Error]:', err.message);
    }
  }, CHECK_INTERVAL_MS);
  console.log('[Mongoose Auto-Yield]: Continuous background yield scheduler active (runs every 60s + on-demand; 48h warm-up rule active).');
}

module.exports = {
  processUserMaturedYields,
  runAutoDailyYield,
  startAutoYieldScheduler,
};

