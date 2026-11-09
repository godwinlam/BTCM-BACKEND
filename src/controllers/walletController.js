const User = require('../models/User');
const Transaction = require('../models/Transaction');
const DepositRequest = require('../models/DepositRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const SystemSetting = require('../models/SystemSetting');

/**
 * Get wallet balance
 */
const getBalance = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('wallet');
    return res.status(200).json({ success: true, wallet: user.wallet });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get transaction ledger with pagination & filter
 */
const getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const filter = req.query.filter || 'ALL';
    const skip = (page - 1) * limit;

    const query = { userId: req.user._id };

    if (filter === 'TRANSFER') {
      query.type = { $in: ['TRANSFER_IN', 'TRANSFER_OUT'] };
    } else if (filter === 'WITHDRAWAL') {
      query.type = { $in: ['WITHDRAWAL', 'WITHDRAWAL_REFUND'] };
    }

    const total = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sourceUserId', 'username');

    return res.status(200).json({
      success: true,
      transactions,
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
 * Peer-to-peer internal transfer
 */
const transfer = async (req, res) => {
  try {
    const { amount, currency, note } = req.body;
    const targetRecipient = (req.body.recipient || req.body.recipientUsername || '').toLowerCase().trim();
    const numAmount = parseFloat(amount);
    const normCurrency = (currency || 'USDT').toUpperCase();

    if (!targetRecipient || isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide recipient username/email and a valid amount' });
    }

    const sender = await User.findById(req.user._id);
    const recipient = await User.findOne({
      $or: [
        { username: targetRecipient },
        { email: targetRecipient },
        { referralCode: targetRecipient.toUpperCase() },
      ],
    });

    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Recipient miner not found' });
    }

    if (recipient._id.equals(sender._id)) {
      return res.status(400).json({ success: false, message: 'Cannot transfer funds to yourself' });
    }

    // Balance check
    const balanceField = normCurrency === 'BTC' ? 'btcBalance' : 'usdBalance';
    if ((sender.wallet[balanceField] || 0) < numAmount) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${normCurrency} balance. Available: ${sender.wallet[balanceField]} ${normCurrency}`,
      });
    }

    // Deduct from sender & credit to recipient
    sender.wallet[balanceField] -= numAmount;
    recipient.wallet[balanceField] = (recipient.wallet[balanceField] || 0) + numAmount;

    await sender.save();
    await recipient.save();

    // Transactions
    await Transaction.create({
      userId: sender._id,
      type: 'TRANSFER_OUT',
      amount: -numAmount,
      currency: normCurrency,
      description: `Transferred ${numAmount} ${normCurrency} to @${recipient.username}${note ? ` (${note})` : ''}`,
      metadata: { recipientUsername: recipient.username, recipientId: recipient._id, note },
    });

    await Transaction.create({
      userId: recipient._id,
      type: 'TRANSFER_IN',
      amount: numAmount,
      currency: normCurrency,
      description: `Received ${numAmount} ${normCurrency} from @${sender.username}${note ? ` (${note})` : ''}`,
      sourceUserId: sender._id,
      metadata: { senderUsername: sender.username, senderId: sender._id, note },
    });

    return res.status(200).json({
      success: true,
      message: `Successfully transferred ${numAmount} ${normCurrency} to @${recipient.username}`,
      newBalance: sender.wallet[balanceField],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Submit withdrawal request
 */
const requestWithdrawal = async (req, res) => {
  try {
    const { amount, currency, network } = req.body;
    const targetAddress = (req.body.payoutAddress || req.body.destinationAddress || '').trim();
    const numAmount = parseFloat(amount);
    const normCurrency = (currency || 'USDT').toUpperCase();

    if (isNaN(numAmount) || numAmount <= 0 || !targetAddress) {
      return res.status(400).json({ success: false, message: 'Valid withdrawal amount and payout address are required' });
    }

    const user = await User.findById(req.user._id);
    const balanceField = normCurrency === 'BTC' ? 'btcBalance' : 'usdBalance';

    if ((user.wallet[balanceField] || 0) < numAmount) {
      return res.status(400).json({ success: false, message: `Insufficient ${normCurrency} balance` });
    }

    // Fixed or percentage network fee
    const fee = normCurrency === 'BTC' ? 0.0002 : 1.0;
    const netAmount = Math.max(0, numAmount - fee);

    // Deduct balance immediately
    user.wallet[balanceField] -= numAmount;
    await user.save();

    const request = await WithdrawalRequest.create({
      userId: user._id,
      amount: numAmount,
      currency: normCurrency,
      network: network || (normCurrency === 'BTC' ? 'Bitcoin Native SegWit' : 'TRC20'),
      payoutAddress: targetAddress,
      fee,
      netAmount,
      status: 'PENDING',
    });

    await Transaction.create({
      userId: user._id,
      type: 'WITHDRAWAL',
      amount: -numAmount,
      currency: normCurrency,
      description: `Withdrawal request for ${numAmount} ${normCurrency} to ${targetAddress}`,
      metadata: { withdrawalRequestId: request._id, fee, netAmount, network },
      status: 'PENDING',
    });

    return res.status(201).json({
      success: true,
      request,
      message: 'Withdrawal request submitted for review',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Submit deposit transaction hash
 */
const submitDeposit = async (req, res) => {
  try {
    const { amount, currency, network, txHash } = req.body;
    const numAmount = parseFloat(amount);

    if (isNaN(numAmount) || numAmount <= 0 || !txHash) {
      return res.status(400).json({ success: false, message: 'Deposit amount and transaction hash (TxHash) are required' });
    }

    const existingHash = await DepositRequest.findOne({ txHash: txHash.trim() });
    if (existingHash) {
      return res.status(400).json({ success: false, message: 'This transaction hash has already been submitted' });
    }

    const deposit = await DepositRequest.create({
      userId: req.user._id,
      amount: numAmount,
      currency: (currency || 'USDT').toUpperCase(),
      network: network || 'TRC20',
      txHash: txHash.trim(),
      status: 'PENDING',
    });

    return res.status(201).json({
      success: true,
      deposit,
      message: 'Deposit request received. Your balance will be credited upon admin confirmation.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get deposit addresses configuration / instructions
 */
const getDepositConfig = async (req, res) => {
  try {
    const settings = await SystemSetting.find({
      key: {
        $in: [
          'usdt_deposit_address',
          'usdt_deposit_network',
          'usdt_deposit_instructions',
          'btc_deposit_address',
          'btc_deposit_network',
          'btc_deposit_instructions',
          'usdc_deposit_address',
          'usdc_deposit_network',
          'usdc_deposit_instructions',
        ],
      },
    });

    const configMap = {};
    settings.forEach((s) => {
      configMap[s.key] = s.value;
    });

    const currencies = {
      USDT: {
        currency: 'USDT',
        symbol: '₮',
        name: 'Tether USD',
        network: configMap.usdt_deposit_network || 'TRC20 (Tron Network)',
        depositAddress: configMap.usdt_deposit_address || 'TXv2nE8gQ6R4mN9kY7bL1jF5cW3pA8sD6Z',
        instructions: configMap.usdt_deposit_instructions || 'Transfer USDT only via TRC20 network. Once sent, submit your transaction hash (TxHash) below for prompt verification and balance credit.',
        minDeposit: 10,
        decimals: 2,
      },
      BTC: {
        currency: 'BTC',
        symbol: '₿',
        name: 'Bitcoin',
        network: configMap.btc_deposit_network || 'BTC (Native SegWit Network)',
        depositAddress: configMap.btc_deposit_address || 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
        instructions: configMap.btc_deposit_instructions || 'Transfer BTC directly to this Native SegWit address. Minimum deposit is 0.0001 BTC. Once sent, submit your transaction hash (TxHash) below.',
        minDeposit: 0.0001,
        decimals: 8,
      },
      USDC: {
        currency: 'USDC',
        symbol: '$',
        name: 'USD Coin',
        network: configMap.usdc_deposit_network || 'ERC20 (Ethereum Network)',
        depositAddress: configMap.usdc_deposit_address || '0x71C836642F4A4E3302293515456275153A649319',
        instructions: configMap.usdc_deposit_instructions || 'Transfer USDC only via ERC20 network. Once sent, submit your transaction hash (TxHash) below for prompt verification and balance credit.',
        minDeposit: 10,
        decimals: 2,
      },
    };

    return res.status(200).json({
      success: true,
      depositAddress: currencies.USDT.depositAddress,
      network: currencies.USDT.network,
      instructions: currencies.USDT.instructions,
      currencies,
      config: {
        usdtDepositAddress: currencies.USDT.depositAddress,
        usdtNetwork: currencies.USDT.network,
        btcDepositAddress: currencies.BTC.depositAddress,
        usdcDepositAddress: currencies.USDC.depositAddress,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Look up recipient miner by username, email, or referral code
 */
const lookupRecipient = async (req, res) => {
  try {
    const { query: searchTerm } = req.query;
    if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim() === '') {
      return res.status(400).json({ success: false, message: 'Search term is required' });
    }

    const clean = searchTerm.trim().replace(/^@+/, '').toLowerCase();
    const targetUser = await User.findOne({
      $or: [
        { username: clean },
        { email: clean },
        { referralCode: clean.toUpperCase() },
      ],
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: `No user found matching "${searchTerm}"` });
    }

    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: 'You cannot transfer to your own account' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: targetUser._id,
        _id: targetUser._id,
        username: targetUser.username,
        fullName: targetUser.fullName || targetUser.username,
        referralCode: targetUser.referralCode,
        starRank: targetUser.starRank,
        isStarQualified: targetUser.isStarQualified,
        starBadge: targetUser.starBadge,
        starIcon: targetUser.starIcon,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get user's deposit request history
 */
const getUserDeposits = async (req, res) => {
  try {
    const deposits = await DepositRequest.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(25)
      .lean();

    const formatted = deposits.map((d) => ({
      id: d._id,
      _id: d._id,
      amount: d.amount,
      currency: d.currency,
      network: d.network,
      txHash: d.txHash,
      status: d.status,
      adminNotes: d.adminNotes || '',
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    }));

    return res.status(200).json({
      success: true,
      deposits: formatted,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getBalance,
  getTransactions,
  transfer,
  requestWithdrawal,
  submitDeposit,
  getDepositConfig,
  getDepositInfo: getDepositConfig,
  lookupRecipient,
  getUserDeposits,
};

