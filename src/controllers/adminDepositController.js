const DepositRequest = require('../models/DepositRequest');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

/**
 * List deposit requests with status filter & pagination
 */
const listDeposits = async (req, res) => {
  try {
    const status = req.query.status || 'ALL';
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const query = {};
    if (status !== 'ALL') {
      query.status = status;
    }

    const total = await DepositRequest.countDocuments(query);
    const rawDeposits = await DepositRequest.find(query)
      .populate('userId', 'username email fullName wallet totalInvested starRank')
      .populate('reviewedBy', 'username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const deposits = rawDeposits.map((d) => {
      const obj = d.toObject ? d.toObject() : d;
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
        depositAddress: obj.depositAddress || '',
        reviewedBy: obj.reviewedBy?.username || obj.reviewedBy || null,
        processedByAdmin: obj.reviewedBy?.username || obj.processedByAdmin || null,
        processedAt: obj.reviewedAt || obj.processedAt || null,
        rejectionReason: obj.adminNotes || obj.rejectionReason || '',
      };
    });

    return res.status(200).json({
      success: true,
      deposits,
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
 * Get detailed deposit request by ID with user history
 */
const getDepositById = async (req, res) => {
  try {
    const { id } = req.params;
    const deposit = await DepositRequest.findById(id)
      .populate('userId', 'username email fullName role wallet totalInvested starRank')
      .populate('reviewedBy', 'username');

    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found' });
    }

    const userHistory = await DepositRequest.find({
      userId: deposit.userId?._id || deposit.userId,
      _id: { $ne: deposit._id },
    })
      .sort({ createdAt: -1 })
      .limit(10);

    const userDepositHistory = userHistory.map((h) => ({
      id: h._id.toString(),
      _id: h._id.toString(),
      amount: h.amount,
      currency: h.currency,
      network: h.network,
      status: h.status,
      txHash: h.txHash,
      createdAt: h.createdAt,
    }));

    const u = deposit.userId;
    const strId = deposit._id.toString();
    const formatted = {
      ...deposit.toObject(),
      id: strId,
      _id: strId,
      userId: u?._id ? u._id.toString() : deposit.userId,
      username: u?.username || 'user',
      email: u?.email || '',
      fullName: u?.fullName || '',
      depositAddress: deposit.depositAddress || '',
      reviewedBy: deposit.reviewedBy?.username || null,
      processedByAdmin: deposit.reviewedBy?.username || null,
      processedAt: deposit.reviewedAt || null,
      rejectionReason: deposit.adminNotes || '',
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
      userDepositHistory,
    };

    return res.status(200).json({ success: true, deposit: formatted });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Approve deposit request and credit user balance
 */
const approveDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    const deposit = await DepositRequest.findById(id);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found' });
    }

    if (deposit.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Deposit is already ${deposit.status.toLowerCase()}` });
    }

    const user = await User.findById(deposit.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Associated user not found' });
    }

    // Credit user balance
    const field = deposit.currency === 'BTC' ? 'btcBalance' : 'usdBalance';
    user.wallet[field] = (user.wallet[field] || 0) + deposit.amount;
    await user.save();

    deposit.status = 'APPROVED';
    deposit.adminNotes = adminNotes || deposit.adminNotes;
    deposit.reviewedBy = req.user._id;
    deposit.reviewedAt = new Date();
    await deposit.save();

    await Transaction.create({
      userId: user._id,
      type: 'WALLET_DEPOSIT',
      amount: deposit.amount,
      currency: deposit.currency,
      description: `Wallet deposit of ${deposit.amount} ${deposit.currency} approved`,
      metadata: { depositRequestId: deposit._id, txHash: deposit.txHash, network: deposit.network },
      status: 'COMPLETED',
    });

    return res.status(200).json({
      success: true,
      deposit,
      message: `Deposit of ${deposit.amount} ${deposit.currency} approved and credited to @${user.username}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Reject deposit request
 */
const rejectDeposit = async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    const deposit = await DepositRequest.findById(id);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit request not found' });
    }

    if (deposit.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Deposit is already ${deposit.status.toLowerCase()}` });
    }

    deposit.status = 'REJECTED';
    deposit.adminNotes = adminNotes || 'Invalid transaction proof or rejected by administrator';
    deposit.reviewedBy = req.user._id;
    deposit.reviewedAt = new Date();
    await deposit.save();

    return res.status(200).json({
      success: true,
      deposit,
      message: 'Deposit request rejected',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get deposit overview stats
 */
const getDepositStats = async (req, res) => {
  try {
    const agg = await DepositRequest.aggregate([
      {
        $group: {
          _id: { status: '$status', currency: '$currency' },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
    ]);

    const stats = {
      pending: { count: 0, totalUsdt: 0, totalBtc: 0, totalUsdc: 0 },
      approved: { count: 0, totalUsdt: 0, totalBtc: 0, totalUsdc: 0 },
      rejected: { count: 0, totalUsdt: 0, totalBtc: 0, totalUsdc: 0 },
      total: { count: 0, totalUsdt: 0, totalBtc: 0, totalUsdc: 0 },
      byCurrency: {
        USDT: { count: 0, amount: 0 },
        BTC: { count: 0, amount: 0 },
        USDC: { count: 0, amount: 0 },
      },
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
      } else if (curr === 'USDC') {
        target.totalUsdc += amt;
        stats.total.totalUsdc += amt;
      } else {
        target.totalUsdt += amt;
        stats.total.totalUsdt += amt;
      }
      stats.total.count += count;

      if (stats.byCurrency[curr]) {
        stats.byCurrency[curr].count += count;
        stats.byCurrency[curr].amount += amt;
      }
    });

    return res.status(200).json({
      success: true,
      stats,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get deposit config for admin
 */
const getDepositConfig = async (req, res) => {
  const { getDepositConfig: walletDepositConfig } = require('./walletController');
  return walletDepositConfig(req, res);
};

/**
 * Update deposit addresses / instructions
 */
const updateDepositConfig = async (req, res) => {
  try {
    const SystemSetting = require('../models/SystemSetting');
    const { currency, address, network, instructions } = req.body;
    const curr = (currency || 'USDT').toLowerCase();

    if (address) {
      await SystemSetting.findOneAndUpdate(
        { key: `${curr}_deposit_address` },
        { key: `${curr}_deposit_address`, value: address, description: `${curr.toUpperCase()} Deposit Address` },
        { upsert: true, new: true }
      );
    }
    if (network) {
      await SystemSetting.findOneAndUpdate(
        { key: `${curr}_deposit_network` },
        { key: `${curr}_deposit_network`, value: network, description: `${curr.toUpperCase()} Deposit Network` },
        { upsert: true, new: true }
      );
    }
    if (instructions) {
      await SystemSetting.findOneAndUpdate(
        { key: `${curr}_deposit_instructions` },
        { key: `${curr}_deposit_instructions`, value: instructions, description: `${curr.toUpperCase()} Deposit Instructions` },
        { upsert: true, new: true }
      );
    }

    return res.status(200).json({
      success: true,
      message: `${curr.toUpperCase()} deposit configuration updated successfully`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  listDeposits,
  getDepositById,
  approveDeposit,
  rejectDeposit,
  getDepositStats,
  getDepositConfig,
  updateDepositConfig,
};

