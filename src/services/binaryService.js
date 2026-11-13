const User = require('../models/User');
const Transaction = require('../models/Transaction');
const SystemSetting = require('../models/SystemSetting');

const STAR_RANKS = {
  0: { rank: 0, name: 'Unranked Miner', badge: null, minPersonalInvestment: 0, minDirectSales: 0, maxDailyPairs: 0, rewardRate: 0.10 },
  1: { rank: 1, name: '1 Star User', badge: '★ 1 STAR', minPersonalInvestment: 100, minDirectSales: 1000, maxDailyPairs: 1, rewardRate: 0.10 },
  2: { rank: 2, name: '2 Star User', badge: '★★ 2 STAR', minPersonalInvestment: 300, minDirectSales: 2000, maxDailyPairs: 2, rewardRate: 0.10 },
  3: { rank: 3, name: '3 Star User', badge: '★★★ 3 STAR', minPersonalInvestment: 1000, minDirectSales: 10000, maxDailyPairs: 4, rewardRate: 0.10 },
  4: { rank: 4, name: '4 Star User', badge: '★★★★ 4 STAR', minPersonalInvestment: 5000, minDirectSales: 50000, maxDailyPairs: 6, rewardRate: 0.10 },
  5: { rank: 5, name: '5 Star User', badge: '★★★★★ 5 STAR', minPersonalInvestment: 5000, minDirectSales: 100000, maxDailyPairs: 7, rewardRate: 0.10 },
  6: { rank: 6, name: '6 Star User', badge: '★★★★★★ 6 STAR', minPersonalInvestment: 10000, minDirectSales: 1000000, maxDailyPairs: 9, rewardRate: 0.10 },
  7: { rank: 7, name: '7 Star User', badge: '★★★★★★★ 7 STAR', minPersonalInvestment: 30000, minDirectSales: 5000000, maxDailyPairs: 11, rewardRate: 0.10 },
  8: { rank: 8, name: 'Crown User', badge: '👑 CROWN', minPersonalInvestment: 30000, minDirectSales: 10000000, maxDailyPairs: 13, rewardRate: 0.10 },
  9: { rank: 9, name: '2 Crown User', badge: '👑👑 2 CROWN', minPersonalInvestment: 60000, minDirectSales: 50000000, maxDailyPairs: 15, rewardRate: 0.10 },
  10: { rank: 10, name: '3 Crown User', badge: '👑👑👑 3 CROWN', minPersonalInvestment: 100000, minDirectSales: 100000000, maxDailyPairs: 18, rewardRate: 0.10 },
};

/**
 * Calculate total sales volume under a user's direct placement tree:
 * Includes binary placement tree volume (Leg A total + Leg B total, current legs),
 * plus direct sponsor downlines total investment.
 */
async function calculateDirectSalesVolume(userId) {
  const user = await User.findById(userId);
  if (!user) return 0;

  // 1. Binary placement tree lifetime and current volume
  const binaryLegsTotal = (user.binaryLegs?.legATotal || 0) + (user.binaryLegs?.legBTotal || 0);
  const binaryLegsCurrent = (user.binaryLegs?.legACurrent || 0) + (user.binaryLegs?.legBCurrent || 0);

  // 2. Direct downlines sponsor sales volume
  const directDownlines = await User.find({ sponsor: userId }).select('wallet.totalInvested');
  let sponsorSales = 0;
  for (const d of directDownlines) {
    sponsorSales += d.wallet?.totalInvested || 0;
  }

  return Math.max(binaryLegsTotal, binaryLegsCurrent, sponsorSales);
}

/**
 * Evaluate star rank for a user
 */
async function evaluateUserStarRank(userId) {
  const user = await User.findById(userId);
  if (!user) return STAR_RANKS[0];

  const personalInvested = user.wallet?.totalInvested || 0;
  const directSales = await calculateDirectSalesVolume(userId);

  let qualifiedRank = 0;
  for (let r = 10; r >= 1; r--) {
    const req = STAR_RANKS[r];
    if (personalInvested >= req.minPersonalInvestment && directSales >= req.minDirectSales) {
      qualifiedRank = r;
      break;
    }
  }

  if (user.starRank !== qualifiedRank) {
    user.starRank = qualifiedRank;
    user.markModified('binaryLegs');
  user.markModified('wallet');
  await user.save();
  }

  const rankInfo = STAR_RANKS[qualifiedRank] || STAR_RANKS[0];

  // Requirements for the NEXT rank
  const nextRank = Math.min(10, qualifiedRank + 1);
  const nextReq = STAR_RANKS[nextRank] || STAR_RANKS[10];
  const nextRankNeeded = Math.max(0, nextReq.minDirectSales - directSales);
  const nextRankPersonalNeeded = Math.max(0, nextReq.minPersonalInvestment - personalInvested);

  return {
    ...rankInfo,
    rank: qualifiedRank,
    directSalesVolume: directSales,
    personalInvested,
    nextRankNeeded,
    nextRankPersonalNeeded,
    targetVolume: nextReq.minDirectSales,
    minPersonalRequired: nextReq.minPersonalInvestment,
  };
}

/**
 * Propagate package investment volume up the binary placement tree
 */
async function addBinaryVolume(childUserId, amount) {
  let currentUser = await User.findById(childUserId);
  if (!currentUser || !currentUser.binaryParent) return;

  let parentId = currentUser.binaryParent;
  let childLeg = currentUser.binaryPosition;

  while (parentId) {
    const parent = await User.findById(parentId);
    if (!parent) break;

    if (childLeg === 'A') {
      parent.binaryLegs.legACurrent += amount;
      parent.binaryLegs.legATotal += amount;
    } else if (childLeg === 'B') {
      parent.binaryLegs.legBCurrent += amount;
      parent.binaryLegs.legBTotal += amount;
    }

    await parent.save();
    try {
      await evaluateUserStarRank(parent._id);
      // Volume remains in PENDING AT 23:59:59 throughout the day.
      // Settle occurs strictly when clock reaches 23:59:59 daily.
    } catch (evalErr) {
      console.warn(`[Star Rank Eval Warning for parent ${parent.username}]:`, evalErr.message);
    }

    currentUser = parent;
    parentId = parent.binaryParent;
    childLeg = parent.binaryPosition;
  }
}

/**
 * Run daily 23:59:59 binary settlement
 */
async function runDailyBinarySettlement() {
  console.log('[Mongoose Binary Settlement]: Running 23:59:59 daily binary settlement calculation...');
  const users = await User.find({
    'binaryLegs.legACurrent': { $gte: 1000 },
    'binaryLegs.legBCurrent': { $gte: 1000 },
  });

  let settledCount = 0;
  for (const user of users) {
    try {
      const res = await executeUserDailyBinarySettlement(user._id);
      if (res && res.settled) {
        settledCount += (res.pairsPaid || 1);
        console.log(`[Daily 23:59:59 Settlement]: Auto-settled @${user.username} (+${res.rewardUsd} USDT, ${res.pairsPaid} pair(s) paid, ${res.pairsConfiscated} confiscated)`);
      }
    } catch (err) {
      console.error(`[Daily 23:59:59 Settlement Error for @${user.username}]:`, err.message);
    }
  }

  console.log(`[Mongoose Binary Settlement]: 23:59:59 daily settlement complete. Settled ${settledCount} pair(s).`);
  return { success: true, settledMiners: settledCount };
}

/**
 * Schedule automated cron for daily 23:59 settlement
 */
function scheduleDailyBinarySettlement(callback) {
  const checkIntervalMs = 60 * 1000; // Check every minute
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() === 59) {
      console.log('[Mongoose Binary Scheduler]: 23:59 reached. Triggering settlement...');
      if (typeof callback === 'function') {
        try {
          await callback();
        } catch (e) {
          console.error('[Mongoose Settlement Callback Error]:', e);
        }
      } else {
        await runDailyBinarySettlement();
      }
    }
  }, checkIntervalMs);
}

/**
 * Place a user into the binary placement tree
 * STRICT RULE: Only users who have purchased a mining service package can be placed.
 */
async function placeUserInBinary(userId, targetParentId, preferredPosition = 'A') {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  // Check mining package purchase qualification
  const hasPurchased = (user.wallet?.totalInvested || 0) > 0;
  if (!hasPurchased) {
    throw new Error('Placement rejected: Only users who have purchased a mining service package can be placed in the binary tree.');
  }

  let targetParent = await User.findById(targetParentId);
  if (!targetParent) throw new Error('Target parent not found');

  // If user was previously assigned somewhere, clean up old parent links
  if (user.binaryParent) {
    const oldParent = await User.findById(user.binaryParent);
    if (oldParent) {
      if (oldParent.binaryLeftChild && oldParent.binaryLeftChild.toString() === user._id.toString()) {
        oldParent.binaryLeftChild = null;
        await oldParent.save();
      }
      if (oldParent.binaryRightChild && oldParent.binaryRightChild.toString() === user._id.toString()) {
        oldParent.binaryRightChild = null;
        await oldParent.save();
      }
    }
  }

  let slotFound = false;
  let finalParent = targetParent;
  let finalPos = preferredPosition === 'B' ? 'B' : 'A';

  // Check requested slot
  if (finalPos === 'A' && !targetParent.binaryLeftChild) {
    slotFound = true;
  } else if (finalPos === 'B' && !targetParent.binaryRightChild) {
    slotFound = true;
  }

  // Spillover if requested slot is occupied
  if (!slotFound) {
    let curr = targetParent;
    while (!slotFound) {
      if (finalPos === 'A') {
        if (!curr.binaryLeftChild) {
          finalParent = curr;
          slotFound = true;
        } else {
          curr = await User.findById(curr.binaryLeftChild);
          if (!curr) break;
        }
      } else {
        if (!curr.binaryRightChild) {
          finalParent = curr;
          slotFound = true;
        } else {
          curr = await User.findById(curr.binaryRightChild);
          if (!curr) break;
        }
      }
    }
  }

  if (!finalParent) {
    throw new Error('Unable to find an open placement node in chosen leg.');
  }

  user.binaryParent = finalParent._id;
  user.binaryPosition = finalPos;
  user.markModified('binaryLegs');
  user.markModified('wallet');
  await user.save();

  if (finalPos === 'A') {
    finalParent.binaryLeftChild = user._id;
  } else {
    finalParent.binaryRightChild = user._id;
  }
  await finalParent.save();

  // If user already invested amount prior to placement, propagate volume up
  if ((user.wallet?.totalInvested || 0) > 0) {
    await addBinaryVolume(user._id, user.wallet.totalInvested);
  }

  return {
    placedUnder: finalParent.username,
    position: finalPos,
  };
}

/**
 * Execute Daily 23:59 Binary Pairing Settlement for a single user (called on-demand or by real-time countdown timer)
 */
async function executeUserDailyBinarySettlement(userId) {
  const user = await User.findById(userId);
  if (!user) return { success: false, message: 'User not found' };

  // Strict Daily Idempotency Check: Prevent duplicate settlement on the same calendar day
  const todayKey = new Date().toISOString().slice(0, 10);
  if (user.binaryLegs?.lastSettledDate === todayKey) {
    return {
      userId: user._id,
      username: user.username,
      settled: false,
      pairsReady: 0,
      pairsPaid: 0,
      pairsConfiscated: 0,
      confiscatedVolume: 0,
      rewardUsd: 0,
      message: `User @${user.username} has already been settled for today (${todayKey}). Next binary pairing settlement is at 23:59 tomorrow.`,
    };
  }

  const starInfo = await evaluateUserStarRank(userId);
  const legACurr = user.binaryLegs?.legACurrent || 0;
  const legBCurr = user.binaryLegs?.legBCurrent || 0;
  const legABefore = legACurr;
  const legBBefore = legBCurr;

  const pairsReady = Math.min(Math.floor(legACurr / 1000), Math.floor(legBCurr / 1000));

  if (pairsReady < 1) {
    return {
      userId: user._id,
      username: user.username,
      settled: false,
      pairsReady: 0,
      pairsPaid: 0,
      pairsConfiscated: 0,
      confiscatedVolume: 0,
      rewardUsd: 0,
      starRank: starInfo.rank,
      starName: starInfo.name,
      message: 'No pairing ready (requires at least 1,000 USDT on both Leg A and Leg B).',
    };
  }

  const isQualified = (user.wallet?.totalInvested || 0) > 0;
  if (!isQualified) {
    return {
      userId: user._id,
      username: user.username,
      settled: false,
      pairsReady,
      pairsPaid: 0,
      pairsConfiscated: 0,
      confiscatedVolume: 0,
      rewardUsd: 0,
      starRank: starInfo.rank,
      starName: starInfo.name,
      message: 'User has ready pairs but is not qualified for MLM commissions (requires mining service purchase).',
    };
  }

  if (starInfo.rank < 1) {
    return {
      userId: user._id,
      username: user.username,
      settled: false,
      pairsReady,
      pairsPaid: 0,
      pairsConfiscated: 0,
      confiscatedVolume: 0,
      rewardUsd: 0,
      starRank: starInfo.rank,
      starName: starInfo.name,
      message: `User has ${pairsReady} pairs ready, but requires 1-Star rank (at least 1,000 USDT direct sales volume) for daily binary pairing.`,
    };
  }

  const maxPairsAllowed = starInfo.maxDailyPairs || 1;
  const pairsToPay = Math.min(pairsReady, maxPairsAllowed);
  const pairsToConfiscate = Math.max(0, pairsReady - pairsToPay);

  const rewardUsd = pairsToPay * 100;
  const confiscatedBonusValue = pairsToConfiscate * 100;
  const confiscatedVolume = pairsToConfiscate * 1000;

  const totalVolumeToDeduct = pairsReady * 1000;
  user.binaryLegs.legACurrent = Math.max(0, legACurr - totalVolumeToDeduct);
  user.binaryLegs.legBCurrent = Math.max(0, legBCurr - totalVolumeToDeduct);
  user.binaryLegs.pairsCount = (user.binaryLegs.pairsCount || 0) + pairsToPay;
  user.binaryLegs.lastSettledAt = new Date();
  user.binaryLegs.lastSettledDate = new Date().toISOString().slice(0, 10);

  if (rewardUsd > 0) {
    user.wallet.usdBalance = (user.wallet.usdBalance || 0) + rewardUsd;
    user.wallet.totalBinaryEarned = (user.wallet.totalBinaryEarned || 0) + rewardUsd;

    await Transaction.create({
      userId: user._id,
      type: 'BINARY_PAIRING_BONUS',
      amount: rewardUsd,
      currency: 'USDT',
      description: `Daily 23:59 Binary Pairing (${starInfo.name}): ${pairsToPay} pair (${pairsToPay * 1000} USDT volume) matched (10% reward = ${rewardUsd} USDT)`,
      metadata: {
        pairsMatched: pairsToPay,
        pairsPaid: pairsToPay,
        pairsReady,
        pairsConfiscated: pairsToConfiscate,
        rewardUsd,
        legABefore,
        legBBefore,
        legAAfter: user.binaryLegs.legACurrent,
        legBAfter: user.binaryLegs.legBCurrent,
        starRank: starInfo.rank,
        starName: starInfo.name,
        settlementTime: '23:59',
      },
    });
  }

  if (pairsToConfiscate > 0) {
    user.wallet.totalBinaryConfiscated = (user.wallet.totalBinaryConfiscated || 0) + confiscatedBonusValue;

    await Transaction.create({
      userId: user._id,
      type: 'BINARY_PAIRING_CONFISCATED',
      amount: confiscatedBonusValue,
      currency: 'USDT',
      description: `${starInfo.name} Rule: ${pairsToConfiscate} pairing (${confiscatedVolume} USDT volume, ${confiscatedBonusValue} USDT reward) confiscated by system at 23:59 (Limit: ${maxPairsAllowed} pair/day)`,
      metadata: {
        pairsMatched: 0,
        pairsConfiscated: pairsToConfiscate,
        confiscatedVolume,
        confiscatedBonusValue,
        pairsReady,
        starRank: starInfo.rank,
        starName: starInfo.name,
        settlementTime: '23:59',
      },
    });
  }

  user.markModified('binaryLegs');
  user.markModified('wallet');
  await user.save();

  return {
    userId: user._id,
    username: user.username,
    settled: true,
    pairsReady,
    pairsPaid: pairsToPay,
    pairsConfiscated: pairsToConfiscate,
    confiscatedVolume,
    rewardUsd,
    starRank: starInfo.rank,
    starName: starInfo.name,
    message: `Settlement complete: ${pairsToPay} pair paid (+${rewardUsd} USDT)${pairsToConfiscate > 0 ? `, ${pairsToConfiscate} pair (${confiscatedVolume} USDT volume) confiscated.` : '.'}`,
  };
}

/**
 * Continuous real-time auto-settlement for all qualified users
 */
async function runAutoBinarySettlement() {
  try {
    const users = await User.find({
      'binaryLegs.legACurrent': { $gte: 1000 },
      'binaryLegs.legBCurrent': { $gte: 1000 },
    });

    let settledCount = 0;
    for (const user of users) {
      try {
        const isQual = Number(user.wallet?.totalInvested || 0) > 0;
        const star = await evaluateUserStarRank(user._id);
        if (isQual && star.rank >= 1) {
          const res = await executeUserDailyBinarySettlement(user._id);
          if (res && res.settled) {
            settledCount += (res.pairsPaid || 1);
          }
        }
      } catch (err) {
        console.error(`[Auto Binary Settle Error for @${user.username}]:`, err.message);
      }
    }
    if (settledCount > 0) {
      console.log(`[Auto Binary Settlement Engine]: Successfully auto-settled ${settledCount} pairing(s).`);
    }
    return { success: true, settledCount };
  } catch (err) {
    console.error('[runAutoBinarySettlement error]:', err.message);
    return { success: false, error: err.message };
  }
}

let isSettlingBinary = false;

/**
 * Check and auto-execute daily 23:59 binary settlement when conditions match.
 * Tracks execution state persistently via SystemSetting to ensure zero missed runs.
 */
async function checkAndTriggerDailySettlement() {
  if (isSettlingBinary) return;

  try {
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    let setting = null;
    try {
      setting = await SystemSetting.findOne({ key: 'LAST_BINARY_SETTLEMENT_DATE' });
    } catch (dbErr) {
      // SystemSetting might not be initialized yet
    }

    const lastSettledDate = setting?.value || '';

    // Strict condition: Server time must reach 23:59:00 - 23:59:59 window before daily settlement executes
    const is2359Window = (now.getHours() === 23 && now.getMinutes() >= 59);

    if (is2359Window && lastSettledDate !== dateKey) {
      isSettlingBinary = true;
      console.log(`[Daily 23:59:59 Automated Settlement]: 23:59:59 reached. Auto-implementing daily settlement for ${dateKey}...`);

      const summary = await runDailyBinarySettlement();

      // Persist the executed settlement date
      try {
        if (setting) {
          setting.value = dateKey;
          await setting.save();
        } else {
          await SystemSetting.create({
            key: 'LAST_BINARY_SETTLEMENT_DATE',
            value: dateKey,
            description: 'Last executed automated daily 23:59 binary settlement date key',
          });
        }
      } catch (saveErr) {
        console.warn('[Daily Settlement Setting Save Warning]:', saveErr.message);
      }

      console.log(`[Daily 23:59:59 Automated Settlement]: Auto-settlement complete (${summary.settledMiners || 0} pairs settled, zero manual clicks required).`);
    }
  } catch (err) {
    console.error('[Automated Settlement Scheduler Error]:', err.message);
  } finally {
    isSettlingBinary = false;
  }
}

/**
 * 100% Automated Daily Settlement Scheduler (auto-triggers daily, zero manual click required)
 */
function startAutoBinarySettlementScheduler() {
  const CHECK_INTERVAL_MS = 5 * 1000; // Check every 5 seconds

  // Catch-up on boot if server was offline/rebooted across the 23:59 threshold
  setTimeout(() => {
    checkAndTriggerDailySettlement();
  }, 2000);

  setInterval(() => {
    checkAndTriggerDailySettlement();
  }, CHECK_INTERVAL_MS);

  console.log('[Mongoose Binary Engine]: 100% Automated Daily Settlement Scheduler active (auto-triggers at 23:59 daily, zero manual click required).');
}

module.exports = {
  STAR_RANKS,
  evaluateUserStarRank,
  calculateDirectSalesVolume,
  addBinaryVolume,
  placeUserInBinary,
  runDailyBinarySettlement,
  scheduleDailyBinarySettlement,
  executeUserDailyBinarySettlement,
  runAutoBinarySettlement,
  startAutoBinarySettlementScheduler,
};

