const User = require('../models/User');
const Transaction = require('../models/Transaction');
const {
  placeUserInBinary,
  evaluateUserStarRank,
  runDailyBinarySettlement,
  executeUserDailyBinarySettlement,
} = require('../services/binaryService');

/**
 * Helper: ISO and countdown to next day 00:00:00 settlement cycle
 */
function getNextSettlementDetails() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const diffMs = tomorrow.getTime() - now.getTime();
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  return {
    nextSettlementAt: tomorrow.toISOString(),
    countdownText: `${hours}h ${minutes}m`,
    msRemaining: diffMs,
  };
}

/**
 * Get network summary stats
 */
const getSummary = async (req, res) => {
  try {
    let user = await User.findById(req.user._id);

    const directCount = await User.countDocuments({ sponsor: user._id });
    const teamCount = await countTotalBinaryDownlines(user._id);
    let starInfo = await evaluateUserStarRank(user._id);
    let isQualified = Number(user.wallet?.totalInvested || 0) > 0;

    // Check Auto-Implementation Rule:
    // When { ✓ QUALIFIED FOR 10% PAIRING } is achieved, auto implement binary settlement on next day.
    const todayKey = new Date().toISOString().slice(0, 10);
    const legACurr = user.binaryLegs?.legACurrent || 0;
    const legBCurr = user.binaryLegs?.legBCurrent || 0;
    const pairsReadyNow = Math.min(Math.floor(legACurr / 1000), Math.floor(legBCurr / 1000));
    const isSettledToday = user.binaryLegs?.lastSettledDate === todayKey;
    const isAchievedToday = user.binaryLegs?.pairsAchievedDate === todayKey;

    if (isQualified && starInfo.rank >= 1 && pairsReadyNow >= 1 && !isSettledToday && !isAchievedToday) {
      try {
        console.log(`[Auto Next-Day Binary Settlement]: Auto-settling @${user.username} on next day cycle...`);
        await executeUserDailyBinarySettlement(user._id);
        user = await User.findById(req.user._id);
        starInfo = await evaluateUserStarRank(user._id);
        isQualified = Number(user.wallet?.totalInvested || 0) > 0;
      } catch (autoErr) {
        console.error(`[Auto Settle getSummary Error for @${user.username}]:`, autoErr.message);
      }
    }

    const settlementDetails = getNextSettlementDetails();

    const leftLeg = {
      currentVolume: user.binaryLegs?.legACurrent || 0,
      totalVolume: user.binaryLegs?.legATotal || 0,
      progressToNext1000: ((user.binaryLegs?.legACurrent || 0) % 1000) / 10,
    };

    const rightLeg = {
      currentVolume: user.binaryLegs?.legBCurrent || 0,
      totalVolume: user.binaryLegs?.legBTotal || 0,
      progressToNext1000: ((user.binaryLegs?.legBCurrent || 0) % 1000) / 10,
    };

    const nextPairNeeded = {
      legA: Math.max(0, 1000 - leftLeg.currentVolume),
      legB: Math.max(0, 1000 - rightLeg.currentVolume),
    };

    const totalPairsReady = Math.min(
      Math.floor(leftLeg.currentVolume / 1000),
      Math.floor(rightLeg.currentVolume / 1000)
    );

    const pendingPaidPairs = starInfo.rank >= 1 ? Math.min(totalPairsReady, starInfo.maxDailyPairs) : 0;
    const pendingConfiscatedPairs = starInfo.rank >= 1 ? Math.max(0, totalPairsReady - pendingPaidPairs) : 0;
    const pendingConfiscatedVolume = pendingConfiscatedPairs * 1000;
    const pendingBonusEarned = pendingPaidPairs * 100;

    const starRanking = {
      rank: starInfo.rank,
      name: starInfo.name,
      badge: starInfo.badge,
      personalInvested: starInfo.personalInvested,
      minPersonalRequired: starInfo.minPersonalRequired,
      directPlacementVolume: starInfo.directSalesVolume,
      targetVolume: starInfo.targetVolume,
      isOneStarQualified: starInfo.rank >= 1,
      isTwoStarQualified: starInfo.rank >= 2,
      isThreeStarQualified: starInfo.rank >= 3,
      isFourStarQualified: starInfo.rank >= 4,
      isFiveStarQualified: starInfo.rank >= 5,
      isSixStarQualified: starInfo.rank >= 6,
      isSevenStarQualified: starInfo.rank >= 7,
      isCrownQualified: starInfo.rank >= 8,
      isTwoCrownQualified: starInfo.rank >= 9,
      isThreeCrownQualified: starInfo.rank >= 10,
      volumeNeededForNextRank: starInfo.nextRankNeeded,
      personalNeededForNextRank: starInfo.nextRankPersonalNeeded || 0,
      maxDailyPairs: starInfo.maxDailyPairs,
      dailyPairCapUsdt: starInfo.maxDailyPairs * 100,
      totalPairsReady,
      pendingPaidPairs,
      pendingConfiscatedPairs,
      pendingConfiscatedVolume,
      pendingBonusEarned,
      settlementTime: 'Next Day Daily',
      lastSettledDate: user.binaryLegs?.lastSettledDate || null,
      pairsAchievedDate: user.binaryLegs?.pairsAchievedDate || null,
      canAutoSettle: isQualified && starInfo.rank >= 1 && totalPairsReady >= 1 && user.binaryLegs?.lastSettledDate !== todayKey && (!user.binaryLegs?.pairsAchievedDate || user.binaryLegs?.pairsAchievedDate !== todayKey),
      nextSettlementAt: settlementDetails.nextSettlementAt,
      countdown: settlementDetails.countdownText,
      msRemaining: settlementDetails.msRemaining,
      ruleText:
        starInfo.rank >= 10
          ? '3 Crown User Rule: Min purchased 100,000 USDT mining service and total sales volume ≥ 100,000,000 USDT from below placement tree gives BINARY PAIRING 18 times only per day (settled daily on next day cycle). Excess pairings beyond 18 are confiscated by system.'
          : starInfo.rank === 9
          ? '2 Crown User Rule: Min purchased 60,000 USDT mining service and total sales volume ≥ 50,000,000 USDT from below placement tree gives BINARY PAIRING 15 times only per day (settled daily on next day cycle). Excess pairings beyond 15 are confiscated by system.'
          : starInfo.rank === 8
          ? 'Crown User Rule: Min purchased 30,000 USDT mining service and total sales volume ≥ 10,000,000 USDT from below placement tree gives BINARY PAIRING 13 times only per day (settled daily on next day cycle). Excess pairings beyond 13 are confiscated by system.'
          : starInfo.rank === 7
          ? '7 Star User Rule: Min purchased 30,000 USDT mining service and total sales volume ≥ 5,000,000 USDT from below placement tree gives BINARY PAIRING 11 times only per day (settled daily on next day cycle). Excess pairings beyond 11 are confiscated by system.'
          : starInfo.rank === 6
          ? '6 Star User Rule: Min purchased 10,000 USDT mining service and total sales volume ≥ 1,000,000 USDT from below placement tree gives BINARY PAIRING 9 times only per day (settled daily on next day cycle). Excess pairings beyond 9 are confiscated by system.'
          : starInfo.rank === 5
          ? '5 Star User Rule: Min purchased 5,000 USDT mining service and total sales volume ≥ 100,000 USDT from direct placement tree gives BINARY PAIRING 7 times only per day (settled daily on next day cycle). Excess pairings beyond 7 are confiscated by system.'
          : starInfo.rank === 4
          ? '4 Star User Rule: Min purchased 5,000 USDT mining service and total sales volume ≥ 50,000 USDT from direct placement tree gives BINARY PAIRING 6 times only per day (settled daily on next day cycle). Excess pairings beyond 6 are confiscated by system.'
          : starInfo.rank === 3
          ? '3 Star User Rule: Min purchased 1,000 USDT mining service and total sales volume ≥ 10,000 USDT from direct placement tree gives BINARY PAIRING 4 times only per day (settled daily on next day cycle). Excess pairings beyond 4 are confiscated by system.'
          : starInfo.rank === 2
          ? '2 Star User Rule: Min purchased 300 USDT mining service and total sales volume ≥ 2,000 USDT from direct placement tree gives BINARY PAIRING 2 times only per day (settled daily on next day cycle). Excess pairings beyond 2 are confiscated by system.'
          : '1 Star User Rule: Direct placement tree sales volume ≥ 1,000 USDT gives BINARY PAIRING 1 time only per day (settled daily on next day cycle). Excess pairings (e.g. 2nd 1,000) are confiscated by system.',
    };

    const summaryPayload = {
      referralCode: user.referralCode,
      directSponsoredCount: directCount,
      totalTeamCount: teamCount,
      legACurrent: user.binaryLegs?.legACurrent || 0,
      legBCurrent: user.binaryLegs?.legBCurrent || 0,
      legATotal: user.binaryLegs?.legATotal || 0,
      legBTotal: user.binaryLegs?.legBTotal || 0,
      pairsCount: user.binaryLegs?.pairsCount || 0,
      lastSettledDate: user.binaryLegs?.lastSettledDate || null,
      pairsAchievedDate: user.binaryLegs?.pairsAchievedDate || null,
      starRank: user.starRank,
      starBadge: user.starBadge,
      starIcon: user.starIcon,
      isStarQualified: user.isStarQualified,
      totalBinaryEarned: user.wallet?.totalBinaryEarned || 0,
      totalDirectEarned: user.wallet?.totalDirectEarned || 0,
      totalBinaryConfiscated: user.wallet?.totalBinaryConfiscated || 0,
      starRanking,
    };

    return res.status(200).json({
      success: true,
      summary: summaryPayload,
      directCount,
      leftLeg,
      rightLeg,
      pairsCount: user.binaryLegs?.pairsCount || 0,
      totalBinaryBonus: user.wallet?.totalBinaryEarned || 0,
      totalDirectBonus: user.wallet?.totalDirectEarned || 0,
      totalBinaryConfiscated: user.wallet?.totalBinaryConfiscated || 0,
      nextPairNeeded,
      isQualified,
      starRanking,
      settlement: settlementDetails,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Helper: Count total binary downlines recursively
 */
async function countTotalBinaryDownlines(userId) {
  const children = await User.find({ binaryParent: userId }).select('_id');
  let count = children.length;
  for (const child of children) {
    count += await countTotalBinaryDownlines(child._id);
  }
  return count;
}

/**
 * Get Binary Tree data structure up to specified depth
 */
const getTree = async (req, res) => {
  try {
    const depth = parseInt(req.query.depth || '4', 10);
    let rootId = req.query.rootId || req.query.userId || req.user._id;

    // Support querying by username as well as ObjectId
    if (rootId && typeof rootId === 'string' && !rootId.match(/^[0-9a-fA-F]{24}$/)) {
      const u = await User.findOne({ username: rootId.toLowerCase().trim() }).select('_id');
      if (u) rootId = u._id;
    }

    const buildTree = async (nodeId, currentDepth) => {
      if (!nodeId || currentDepth > depth) return null;

      const node = await User.findById(nodeId)
        .select('username fullName referralCode starRank binaryPosition binaryLegs binaryLeftChild binaryRightChild wallet.totalInvested')
        .lean();

      if (!node) return null;

      const leftChild = node.binaryLeftChild ? await buildTree(node.binaryLeftChild, currentDepth + 1) : null;
      const rightChild = node.binaryRightChild ? await buildTree(node.binaryRightChild, currentDepth + 1) : null;
      const totalInvested = node.wallet?.totalInvested || 0;

      return {
        id: node._id,
        _id: node._id,
        username: node.username,
        fullName: node.fullName || node.username,
        referralCode: node.referralCode,
        starRank: node.starRank,
        binaryPosition: node.binaryPosition,
        personalInvested: totalInvested,
        totalInvested,
        isQualified: totalInvested > 0,
        legACurrent: node.binaryLegs?.legACurrent || 0,
        legBCurrent: node.binaryLegs?.legBCurrent || 0,
        legATotal: node.binaryLegs?.legATotal || 0,
        legBTotal: node.binaryLegs?.legBTotal || 0,
        pairsCount: node.binaryLegs?.pairsCount || 0,
        left: leftChild,
        right: rightChild,
        leftChild,
        rightChild,
      };
    };

    const tree = await buildTree(rootId, 1);
    return res.status(200).json({ success: true, tree });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get direct sponsored downlines list
 */
const getReferrals = async (req, res) => {
  try {
    const sponsorId = req.user._id;
    const downlines = await User.find({ sponsor: sponsorId })
      .populate('binaryParent', 'username fullName')
      .select('username fullName email referralCode starRank binaryPosition wallet createdAt binaryParent')
      .sort({ createdAt: -1 });

    const enriched = await Promise.all(
      downlines.map(async (d) => {
        const bonusTx = await Transaction.aggregate([
          { $match: { userId: sponsorId, sourceUserId: d._id, type: 'DIRECT_REFERRAL_BONUS' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);

        const totalInvested = d.wallet?.totalInvested || 0;
        const isPlaced = Boolean(d.binaryParent);

        // Determine leg under sponsor
        let legUnderSponsor = null;
        if (isPlaced) {
          const parentId = d.binaryParent._id ? d.binaryParent._id.toString() : d.binaryParent.toString();
          if (parentId === sponsorId.toString()) {
            legUnderSponsor = d.binaryPosition;
          } else {
            let curr = await User.findById(parentId).select('binaryParent binaryPosition');
            while (curr) {
              const currParentId = curr.binaryParent ? curr.binaryParent.toString() : null;
              if (currParentId === sponsorId.toString()) {
                legUnderSponsor = curr.binaryPosition;
                break;
              }
              if (!currParentId) break;
              curr = await User.findById(currParentId).select('binaryParent binaryPosition');
            }
          }
        }

        const parentUsername = d.binaryParent && typeof d.binaryParent === 'object' && d.binaryParent.username
          ? d.binaryParent.username
          : null;

        return {
          ...d.toObject(),
          id: d._id,
          _id: d._id,
          binaryParentId: d.binaryParent ? (d.binaryParent._id || d.binaryParent) : null,
          binaryParent: parentUsername ? { username: parentUsername } : null,
          directBonusEarned: bonusTx.length > 0 ? bonusTx[0].total : 0,
          totalInvested,
          isPlaced,
          isQualifiedForPlacement: totalInvested > 0,
          legUnderSponsor: legUnderSponsor || (isPlaced ? d.binaryPosition : null),
        };
      })
    );

    return res.status(200).json({ success: true, referrals: enriched });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Place a qualified user into the binary placement tree
 * STRICT RULE: Only users who have purchased a mining service package can be placed.
 */
const placeMember = async (req, res) => {
  try {
    const { memberUsername, parentUsername, leg } = req.body;

    if (!memberUsername || !parentUsername || !leg) {
      return res.status(400).json({ success: false, message: 'Please provide member, parent and leg (A or B)' });
    }

    if (!['A', 'B'].includes(leg)) {
      return res.status(400).json({ success: false, message: 'Leg must be A (Left) or B (Right)' });
    }

    const member = await User.findOne({ username: memberUsername.toLowerCase().trim() });
    if (!member) {
      return res.status(404).json({ success: false, message: `Member @${memberUsername} not found` });
    }

    // Qualification check
    const hasPurchased = (member.wallet?.totalInvested || 0) > 0;
    if (!hasPurchased) {
      return res.status(400).json({
        success: false,
        message: `Placement rejected: Only users who have purchased a mining service package can be placed in the binary placement tree. @${member.username} has 0 USDT active packages.`,
      });
    }

    const parent = await User.findOne({ username: parentUsername.toLowerCase().trim() });
    if (!parent) {
      return res.status(404).json({ success: false, message: `Parent @${parentUsername} not found` });
    }

    const result = await placeUserInBinary(member._id, parent._id, leg);

    return res.status(200).json({
      success: true,
      message: `Successfully placed @${member.username} under @${result.placedUnder} on Leg ${result.position}`,
      result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get detailed Star Ranking profile and status
 */
const getStarRankingInfo = async (req, res) => {
  try {
    let user = await User.findById(req.user._id);

    const starInfo = await evaluateUserStarRank(req.user._id);
    const settlementDetails = getNextSettlementDetails();

    const legA = user.binaryLegs?.legACurrent || 0;
    const legB = user.binaryLegs?.legBCurrent || 0;
    const pairsReady = Math.min(Math.floor(legA / 1000), Math.floor(legB / 1000));
    const pairsPaid = starInfo.rank >= 1 ? Math.min(pairsReady, starInfo.maxDailyPairs) : 0;
    const pairsConfiscated = starInfo.rank >= 1 ? Math.max(0, pairsReady - pairsPaid) : 0;

    return res.status(200).json({
      success: true,
      starRanking: {
        ...starInfo,
        minPersonalRequired: starInfo.minPersonalRequired,
        targetVolume: starInfo.targetVolume,
        isOneStarQualified: starInfo.rank >= 1,
        isTwoStarQualified: starInfo.rank >= 2,
        isThreeStarQualified: starInfo.rank >= 3,
        isFourStarQualified: starInfo.rank >= 4,
        isFiveStarQualified: starInfo.rank >= 5,
        isSixStarQualified: starInfo.rank >= 6,
        isSevenStarQualified: starInfo.rank >= 7,
        isCrownQualified: starInfo.rank >= 8,
        isTwoCrownQualified: starInfo.rank >= 9,
        isThreeCrownQualified: starInfo.rank >= 10,
        legACurrent: legA,
        legBCurrent: legB,
        pairsReady,
        pairsPaid,
        pairsConfiscated,
        confiscatedVolume: pairsConfiscated * 1000,
        confiscatedBonusValue: pairsConfiscated * 100,
        potentialReward: pairsPaid * 100,
        totalBinaryConfiscated: user.wallet?.totalBinaryConfiscated || 0,
        nextSettlementAt: settlementDetails.nextSettlementAt,
        countdown: settlementDetails.countdownText,
        rule:
          starInfo.rank >= 10
            ? '3 Crown user gets BINARY PAIRING 18 times only per day (settled daily on next day cycle). Excess pairings beyond 18 are confiscated by system.'
            : starInfo.rank >= 9
            ? '2 Crown user gets BINARY PAIRING 15 times only per day (settled daily on next day cycle). Excess pairings beyond 15 are confiscated by system.'
            : starInfo.rank >= 8
            ? 'Crown user gets BINARY PAIRING 13 times only per day (settled daily on next day cycle). Excess pairings beyond 13 are confiscated by system.'
            : starInfo.rank >= 7
            ? '7 Star user gets BINARY PAIRING 11 times only per day (settled daily on next day cycle). Excess pairings beyond 11 are confiscated by system.'
            : starInfo.rank >= 6
            ? '6 Star user gets BINARY PAIRING 9 times only per day (settled daily on next day cycle). Excess pairings beyond 9 are confiscated by system.'
            : starInfo.rank >= 5
            ? '5 Star user gets BINARY PAIRING 7 times only per day (settled daily on next day cycle). Excess pairings beyond 7 are confiscated by system.'
            : starInfo.rank >= 4
            ? '4 Star user gets BINARY PAIRING 6 times only per day (settled daily on next day cycle). Excess pairings beyond 6 are confiscated by system.'
            : starInfo.rank === 3
            ? '3 Star user gets BINARY PAIRING 4 times only per day (settled daily on next day cycle). Excess pairings beyond 4 are confiscated by system.'
            : starInfo.rank === 2
            ? '2 Star user gets BINARY PAIRING 2 times only per day (settled daily on next day cycle). Excess pairings beyond 2 are confiscated by system.'
            : '1 Star user gets BINARY PAIRING 1 time only per day (settled daily on next day cycle). Excess pairings (e.g. 2nd 1,000) are confiscated by system.',
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Settle daily binary pairing (supports on-demand trigger and next-day auto-trigger)
 */
const settleDailyBinaryPairing = async (req, res) => {
  try {
    const { allUsers } = req.body || {};
    if (allUsers) {
      const summary = await runDailyBinarySettlement();
      return res.status(200).json({
        success: true,
        message: 'Daily binary pairing settlement executed for all users.',
        summary,
      });
    }

    const result = await executeUserDailyBinarySettlement(req.user._id);
    return res.status(200).json({
      success: true,
      message: result.settled
        ? `Settlement complete: ${result.pairsPaid} pair paid (+${result.rewardUsd} USDT)${result.pairsConfiscated > 0 ? `, ${result.pairsConfiscated} pair (${result.confiscatedVolume} USDT volume) confiscated by system.` : '.'}`
        : result.message,
      result,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getSummary,
  getTree,
  getReferrals,
  placeMember,
  getStarRankingInfo,
  settleDailyBinaryPairing,
};

