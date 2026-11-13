const WithdrawalRequest = require('../models/WithdrawalRequest');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

/**
 * List withdrawal requests with status filter & pagination
 */
const listWithdrawals = async (req, res) => {
  try {
    const status = req.query.status || 'ALL';
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const query = {};
    if (status !== 'ALL') {
      query.status = status;
    }

    const total = await WithdrawalRequest.countDocuments(query);
    const rawWithdrawals = await WithdrawalRequest.find(query)
      .populate('userId', 'username email fullName wallet totalInvested starRank')
      .populate('reviewedBy', 'username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const withdrawals = rawWithdrawals.map((w) => {
      const obj = w.toObject ? w.toObject() : w;
      const strId = obj._id ? obj._id.toString() : String(obj.id || '');
      const u = obj.userId;
      return {
        ...obj,
        id: strId,
        _id: strId,
        userId: u?._id ? u._id.toString() : (u || ''),
        username: u?.username || obj.username || 'user',
        email: u?.email || obj.email || '',
        fullName: u?.fullName || obj.fullName || '',
        destinationAddress: obj.payoutAddress || obj.destinationAddress || '',
        reviewedBy: obj.reviewedBy?.username || obj.reviewedBy || null,
        processedByAdmin: obj.reviewedBy?.username || obj.processedByAdmin || null,
        processedAt: obj.reviewedAt || obj.processedAt || null,
        rejectionReason: obj.adminNotes || obj.rejectionReason || '',
      };
    });

    return res.status(200).json({
      success: true,
      withdrawals,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get detailed withdrawal request by ID with user history
 */
const getWithdrawalById = async (req, res) => {
  try {
    const { id } = req.params;
    const withdrawal = await WithdrawalRequest.findById(id)
      .populate('userId', 'username email fullName role wallet totalInvested starRank')
      .populate('reviewedBy', 'username');

    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    const userHistory = await WithdrawalRequest.find({
      userId: withdrawal.userId?._id || withdrawal.userId,
      _id: { $ne: withdrawal._id },
    })
      .sort({ createdAt: -1 })
      .limit(10);

    const userWithdrawalHistory = userHistory.map((h) => ({
      id: h._id.toString(),
      _id: h._id.toString(),
      amount: h.amount,
      currency: h.currency,
      network: h.network,
      status: h.status,
      txHash: h.txHash,
      payoutAddress: h.payoutAddress,
      createdAt: h.createdAt,
    }));

    const u = withdrawal.userId;
    const strId = withdrawal._id.toString();
    const formatted = {
      ...withdrawal.toObject(),
      id: strId,
      _id: strId,
      userId: u?._id ? u._id.toString() : withdrawal.userId,
      username: u?.username || 'user',
      email: u?.email || '',
      fullName: u?.fullName || '',
      destinationAddress: withdrawal.payoutAddress,
      reviewedBy: withdrawal.reviewedBy?.username || null,
      processedByAdmin: withdrawal.reviewedBy?.username || null,
      processedAt: withdrawal.reviewedAt || null,
      rejectionReason: withdrawal.adminNotes || '',
      user: u ? {
        id: u._id.toString(),
        username: u.username,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        usdBalance: u.wallet?.usdBalance || 0,
        btcBalance: u.wallet?.btcBalance || 0,
        totalInvested: u.totalInvested || 0,
        starRank: u.starRank || 0,
      } : null,
      userWithdrawalHistory,
    };

    return res.status(200).json({ success: true, withdrawal: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Approve withdrawal request (mark sent on blockchain)
 */
const approveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { txHash, adminNotes } = req.body;

    const withdrawal = await WithdrawalRequest.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    if (withdrawal.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Withdrawal is already ${withdrawal.status.toLowerCase()}` });
    }

    withdrawal.status = 'APPROVED';
    withdrawal.txHash = txHash || withdrawal.txHash;
    withdrawal.adminNotes = adminNotes || withdrawal.adminNotes;
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    await withdrawal.save();

    // Update matching transaction status to COMPLETED
    await Transaction.findOneAndUpdate(
      { 'metadata.withdrawalRequestId': withdrawal._id },
      { status: 'COMPLETED', 'metadata.txHash': withdrawal.txHash }
    );

    return res.status(200).json({
      success: true,
      withdrawal,
      message: `Withdrawal of ${withdrawal.amount} ${withdrawal.currency} approved`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Reject withdrawal request and refund balance to miner
 */
const rejectWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    const withdrawal = await WithdrawalRequest.findById(id);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
    }

    if (withdrawal.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Withdrawal is already ${withdrawal.status.toLowerCase()}` });
    }

    const user = await User.findById(withdrawal.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Associated user not found' });
    }

    // Refund deducted balance
    const field = withdrawal.currency === 'BTC' ? 'btcBalance' : 'usdBalance';
    user.wallet[field] = (user.wallet[field] || 0) + withdrawal.amount;
    await user.save();

    withdrawal.status = 'REJECTED';
    withdrawal.adminNotes = adminNotes || 'Rejected by administrator; funds refunded to wallet.';
    withdrawal.reviewedBy = req.user._id;
    withdrawal.reviewedAt = new Date();
    await withdrawal.save();

    // Record WITHDRAWAL_REFUND transaction with positive amount (+)
    await Transaction.create({
      userId: user._id,
      type: 'WITHDRAWAL_REFUND',
      amount: withdrawal.amount,
      currency: withdrawal.currency,
      description: `Withdrawal refund: ${withdrawal.amount} ${withdrawal.currency} credited back to wallet`,
      metadata: { withdrawalRequestId: withdrawal._id, reason: withdrawal.adminNotes },
      status: 'COMPLETED',
    });

    return res.status(200).json({
      success: true,
      withdrawal,
      message: `Withdrawal rejected and ${withdrawal.amount} ${withdrawal.currency} refunded to @${user.username}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get withdrawal overview stats
 */
const getWithdrawalStats = async (req, res) => {
  try {
    const agg = await WithdrawalRequest.aggregate([
      {
        $group: {
          _id: { status: '$status', currency: '$currency' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const stats = {
      pending: { count: 0, totalUsdt: 0, totalBtc: 0 },
      approved: { count: 0, totalUsdt: 0, totalBtc: 0 },
      completed: { count: 0, totalUsdt: 0, totalBtc: 0 },
      rejected: { count: 0, totalUsdt: 0, totalBtc: 0 },
      total: { count: 0, totalUsdt: 0, totalBtc: 0 },
    };

    agg.forEach((item) => {
      const st = (item._id?.status || '').toLowerCase();
      const curr = item._id?.currency || 'USDT';
      const count = item.count || 0;
      const amt = item.totalAmount || 0;

      const target = stats[st] || stats.pending;
      target.count += count;
      if (curr === 'BTC') {
        target.totalBtc += amt;
        stats.total.totalBtc += amt;
      } else {
        target.totalUsdt += amt;
        stats.total.totalUsdt += amt;
      }
      stats.total.count += count;
    });

    return res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  listWithdrawals,
  getWithdrawalById,
  approveWithdrawal,
  rejectWithdrawal,
  getWithdrawalStats,
};

