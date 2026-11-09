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
    const withdrawals = await WithdrawalRequest.find(query)
      .populate('userId', 'username email')
      .populate('reviewedBy', 'username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

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
  approveWithdrawal,
  rejectWithdrawal,
  getWithdrawalStats,
};

