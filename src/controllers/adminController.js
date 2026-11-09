const User = require('../models/User');
const MiningContract = require('../models/MiningContract');
const Transaction = require('../models/Transaction');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');

/**
 * Admin high-level system dashboard overview
 */
const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const adminsCount = await User.countDocuments({ role: 'admin' });
    const activeUsersCount = await User.countDocuments({ status: { $ne: 'SUSPENDED' } });
    const suspendedUsersCount = await User.countDocuments({ status: 'SUSPENDED' });

    const totalContracts = await MiningContract.countDocuments();
    const activeContractsCount = await MiningContract.countDocuments({ status: 'ACTIVE' });

    const pendingDepositsCount = await DepositRequest.countDocuments({ status: 'PENDING' });
    const pendingWithdrawalsCount = await WithdrawalRequest.countDocuments({ status: 'PENDING' });

    // Aggregate user financial totals
    const userStats = await User.aggregate([
      {
        $group: {
          _id: null,
          totalInvested: { $sum: '$wallet.totalInvested' },
          totalUsdBalance: { $sum: '$wallet.usdBalance' },
          totalBtcBalance: { $sum: '$wallet.btcBalance' },
          totalMiningBtcEarned: { $sum: '$wallet.totalMiningBtcEarned' },
          totalDirectBonus: { $sum: '$wallet.directReferralBonus' },
          totalBinaryBonus: { $sum: '$wallet.binaryPairingBonus' },
        },
      },
    ]);

    const stats = userStats[0] || {
      totalInvested: 0,
      totalUsdBalance: 0,
      totalBtcBalance: 0,
      totalMiningBtcEarned: 0,
      totalDirectBonus: 0,
      totalBinaryBonus: 0,
    };

    // Aggregate contract volume and harvested BTC
    const contractStats = await MiningContract.aggregate([
      {
        $group: {
          _id: null,
          totalVolumeUsd: { $sum: '$packagePriceUsd' },
          totalBtcHarvested: { $sum: '$totalMinedBtc' },
        },
      },
    ]);
    const cStats = contractStats[0] || { totalVolumeUsd: 0, totalBtcHarvested: 0 };

    return res.status(200).json({
      success: true,
      stats: {
        // Flat legacy fields for backward compatibility
        totalUsers,
        activeContractsCount,
        pendingDepositsCount,
        pendingWithdrawalsCount,
        totalInvested: stats.totalInvested,
        totalUsdBalance: stats.totalUsdBalance,
        totalBtcBalance: stats.totalBtcBalance,

        // Structured fields matching AdminStats interface
        users: {
          total: totalUsers,
          admins: adminsCount,
          active: activeUsersCount,
          suspended: suspendedUsersCount,
          totalInvestedUsdt: stats.totalInvested,
          totalUsdtInWallets: stats.totalUsdBalance,
          totalBtcInWallets: stats.totalBtcBalance,
          totalMiningBtcEarned: stats.totalMiningBtcEarned,
          totalDirectBonusPaid: stats.totalDirectBonus,
          totalBinaryBonusPaid: stats.totalBinaryBonus,
        },
        contracts: {
          total: totalContracts,
          active: activeContractsCount,
          totalVolumeUsd: cStats.totalVolumeUsd,
          totalBtcHarvested: cStats.totalBtcHarvested,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * List all users with pagination and search
 */
const listUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const search = req.query.search || '';
    const skip = (page - 1) * limit;

    const query = {};
    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { referralCode: { $regex: search, $options: 'i' } },
      ];
    }

    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .select('-password')
      .populate('sponsor', 'username')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      users,
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
 * Update user status (ACTIVE, SUSPENDED, BANNED)
 */
const updateUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['ACTIVE', 'SUSPENDED', 'BANNED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(id, { status }, { new: true }).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({ success: true, user, message: `User status changed to ${status}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Manually adjust user balance
 */
const adjustUserBalance = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency, note } = req.body;
    const num = parseFloat(amount);
    const normCurr = (currency || 'USDT').toUpperCase();

    if (isNaN(num) || num === 0) {
      return res.status(400).json({ success: false, message: 'Valid non-zero amount required' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const field = normCurr === 'BTC' ? 'btcBalance' : 'usdBalance';
    user.wallet[field] = Math.max(0, (user.wallet[field] || 0) + num);
    await user.save();

    await Transaction.create({
      userId: user._id,
      type: 'ADMIN_ADJUSTMENT',
      amount: num,
      currency: normCurr,
      description: `Admin balance adjustment: ${note || 'Manual credit/debit by administrator'}`,
      metadata: { adjustedBy: req.user.username },
    });

    return res.status(200).json({
      success: true,
      message: `Adjusted @${user.username} balance by ${num} ${normCurr}`,
      newBalance: user.wallet[field],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Review user KYC submission
 */
const reviewUserKyc = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body;

    if (!['VERIFIED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be VERIFIED or REJECTED' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.kyc) {
      user.kyc = {};
    }

    user.kyc.status = status;
    user.kyc.reviewedAt = new Date();
    user.kyc.rejectionReason = status === 'REJECTED' ? (rejectionReason || 'Document rejected by compliance officer') : '';

    await user.save();

    return res.status(200).json({
      success: true,
      user,
      message: `KYC for @${user.username} has been ${status.toLowerCase()}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get single user by id
 */
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, user });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update user details
 */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, phone, role, status, starRank, defaultPlacementLeg } = req.body;
    const update = {};
    if (fullName !== undefined) update.fullName = fullName;
    if (email !== undefined) update.email = email;
    if (phone !== undefined) update.phone = phone;
    if (role !== undefined) update.role = role;
    if (status !== undefined) update.status = status;
    if (starRank !== undefined) update.starRank = starRank;
    if (defaultPlacementLeg !== undefined) update['binaryPlacement.defaultLeg'] = defaultPlacementLeg;

    const user = await User.findByIdAndUpdate(id, { $set: update }, { new: true }).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    return res.status(200).json({ success: true, user, message: 'User updated successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Reset user password by admin
 */
const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    }
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const bcrypt = require('bcryptjs');
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    await user.save();
    return res.status(200).json({ success: true, message: `Password reset successfully for @${user.username}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Adjust user wallet (support both type: CREDIT/DEBIT and direct amount)
 */
const adjustUserWallet = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, currency, type, reason, note } = req.body;
    let num = parseFloat(amount);
    if (isNaN(num) || num === 0) {
      return res.status(400).json({ success: false, message: 'Valid non-zero amount required' });
    }
    if (type === 'DEBIT') {
      num = -Math.abs(num);
    }
    const normCurr = (currency || 'USDT').toUpperCase();
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const field = normCurr === 'BTC' ? 'btcBalance' : 'usdBalance';
    user.wallet[field] = Math.max(0, (user.wallet[field] || 0) + num);
    await user.save();

    await Transaction.create({
      userId: user._id,
      type: 'ADMIN_ADJUSTMENT',
      amount: num,
      currency: normCurr,
      description: `Admin adjustment (${type || (num >= 0 ? 'CREDIT' : 'DEBIT')}): ${reason || note || 'Manual adjustment'}`,
      metadata: { adjustedBy: req.user?.username || 'admin' },
    });

    return res.status(200).json({
      success: true,
      message: `Adjusted @${user.username} balance by ${num} ${normCurr}`,
      newBalance: user.wallet[field],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getDashboardStats,
  listUsers,
  getUserById,
  updateUser,
  updateUserStatus,
  adjustUserBalance,
  adjustUserWallet,
  resetUserPassword,
  reviewUserKyc,
};

