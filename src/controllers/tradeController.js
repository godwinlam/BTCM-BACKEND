const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { fetchCurrentBtcPrice } = require('../services/btcPriceService');

const MIN_BUY_USDT = 10;
const MIN_SELL_BTC = 0.00005;
const PLATFORM_FEE_PERCENT = 2.0; // 2.00% Platform Trading Fee

/**
 * Get current live trading quote and limits
 */
const getTradeQuote = async (req, res) => {
  try {
    const priceData = await fetchCurrentBtcPrice();
    let wallet = null;

    if (req.user && req.user._id) {
      const user = await User.findById(req.user._id).select('wallet');
      if (user) {
        wallet = {
          usdBalance: user.wallet.usdBalance || 0,
          btcBalance: user.wallet.btcBalance || 0,
        };
      }
    }

    return res.status(200).json({
      success: true,
      price: priceData.price,
      change24h: priceData.change24h,
      high24h: priceData.high24h,
      low24h: priceData.low24h,
      timestamp: priceData.timestamp,
      source: priceData.source,
      minBuyUsdt: MIN_BUY_USDT,
      minSellBtc: MIN_SELL_BTC,
      feePercentage: PLATFORM_FEE_PERCENT, // 2% platform fee
      wallet,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Execute Instant BUY or SELL trade
 */
const executeTrade = async (req, res) => {
  try {
    const { action, amount } = req.body;
    const normAction = (action || '').toUpperCase().trim();
    const tradeAmount = parseFloat(amount);

    if (!['BUY', 'SELL'].includes(normAction)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trade action. Must be BUY or SELL.',
      });
    }

    if (isNaN(tradeAmount) || tradeAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid trade amount greater than zero.',
      });
    }

    // Get guaranteed fresh live BTC market price
    const priceData = await fetchCurrentBtcPrice();
    const livePrice = priceData.price;

    if (!livePrice || livePrice <= 0) {
      return res.status(500).json({
        success: false,
        message: 'Unable to retrieve live Bitcoin market price. Please try again shortly.',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.wallet = user.wallet || {};
    user.wallet.usdBalance = user.wallet.usdBalance || 0;
    user.wallet.btcBalance = user.wallet.btcBalance || 0;

    let transactionRecord;
    let resultSummary;

    if (normAction === 'BUY') {
      // User spends USDT to acquire BTC
      if (tradeAmount < MIN_BUY_USDT) {
        return res.status(400).json({
          success: false,
          message: `Minimum BUY amount is ${MIN_BUY_USDT} USDT`,
        });
      }

      if (user.wallet.usdBalance < tradeAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient USDT balance. Available: $${user.wallet.usdBalance.toFixed(2)} USDT, Requested: $${tradeAmount.toFixed(2)} USDT`,
        });
      }

      const feeUsdt = Number((tradeAmount * (PLATFORM_FEE_PERCENT / 100)).toFixed(2));
      const netUsdtToTrade = Number((tradeAmount - feeUsdt).toFixed(2));
      const btcAcquired = Number((netUsdtToTrade / livePrice).toFixed(8));
      if (btcAcquired <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Calculated BTC output is too small. Please increase USDT amount.',
        });
      }

      // Execute atomic balance update: deduct full tradeAmount, credit net BTC
      user.wallet.usdBalance = Number((user.wallet.usdBalance - tradeAmount).toFixed(2));
      user.wallet.btcBalance = Number((user.wallet.btcBalance + btcAcquired).toFixed(8));
      await user.save();

      // Record transaction ledger
      transactionRecord = await Transaction.create({
        userId: user._id,
        type: 'BUY_BTC',
        amount: btcAcquired,
        currency: 'BTC',
        description: `Bought ₿${btcAcquired.toFixed(8)} BTC with $${tradeAmount.toFixed(2)} USDT (incl. 2% fee of $${feeUsdt.toFixed(2)} USDT) @ $${livePrice.toLocaleString()}/BTC`,
        status: 'COMPLETED',
        metadata: {
          action: 'BUY',
          usdtSpent: tradeAmount,
          feeUsdt,
          feePercentage: PLATFORM_FEE_PERCENT,
          netUsdt: netUsdtToTrade,
          btcReceived: btcAcquired,
          executionPrice: livePrice,
          timestamp: new Date(),
        },
      });

      resultSummary = {
        action: 'BUY',
        spentCurrency: 'USDT',
        spentAmount: tradeAmount,
        feeUsdt,
        feePercentage: PLATFORM_FEE_PERCENT,
        receivedCurrency: 'BTC',
        receivedAmount: btcAcquired,
        executionPrice: livePrice,
        description: `Successfully purchased ₿${btcAcquired.toFixed(8)} BTC with $${tradeAmount.toFixed(2)} USDT (2% fee: $${feeUsdt.toFixed(2)} USDT).`,
      };
    } else {
      // User sells BTC to receive USDT
      if (tradeAmount < MIN_SELL_BTC) {
        return res.status(400).json({
          success: false,
          message: `Minimum SELL amount is ${MIN_SELL_BTC} BTC`,
        });
      }

      if (user.wallet.btcBalance < tradeAmount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient BTC balance. Available: ₿${user.wallet.btcBalance.toFixed(8)} BTC, Requested: ₿${tradeAmount.toFixed(8)} BTC`,
        });
      }

      const grossUsdt = Number((tradeAmount * livePrice).toFixed(2));
      const feeUsdt = Number((grossUsdt * (PLATFORM_FEE_PERCENT / 100)).toFixed(2));
      const netUsdtAcquired = Number((grossUsdt - feeUsdt).toFixed(2));

      if (netUsdtAcquired <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Calculated USDT output is too small. Please increase BTC amount.',
        });
      }

      // Execute atomic balance update: deduct full tradeAmount BTC, credit net USDT
      user.wallet.btcBalance = Number((user.wallet.btcBalance - tradeAmount).toFixed(8));
      user.wallet.usdBalance = Number((user.wallet.usdBalance + netUsdtAcquired).toFixed(2));
      await user.save();

      // Record transaction ledger
      transactionRecord = await Transaction.create({
        userId: user._id,
        type: 'SELL_BTC',
        amount: netUsdtAcquired,
        currency: 'USDT',
        description: `Sold ₿${tradeAmount.toFixed(8)} BTC for $${netUsdtAcquired.toFixed(2)} USDT (after 2% fee of $${feeUsdt.toFixed(2)} USDT) @ $${livePrice.toLocaleString()}/BTC`,
        status: 'COMPLETED',
        metadata: {
          action: 'SELL',
          btcSold: tradeAmount,
          grossUsdt,
          feeUsdt,
          feePercentage: PLATFORM_FEE_PERCENT,
          usdtReceived: netUsdtAcquired,
          executionPrice: livePrice,
          timestamp: new Date(),
        },
      });

      resultSummary = {
        action: 'SELL',
        spentCurrency: 'BTC',
        spentAmount: tradeAmount,
        grossUsdt,
        feeUsdt,
        feePercentage: PLATFORM_FEE_PERCENT,
        receivedCurrency: 'USDT',
        receivedAmount: netUsdtAcquired,
        executionPrice: livePrice,
        description: `Successfully sold ₿${tradeAmount.toFixed(8)} BTC for $${netUsdtAcquired.toFixed(2)} USDT (2% fee: $${feeUsdt.toFixed(2)} USDT).`,
      };
    }

    return res.status(200).json({
      success: true,
      message: resultSummary.description,
      wallet: {
        usdBalance: user.wallet.usdBalance,
        btcBalance: user.wallet.btcBalance,
      },
      trade: resultSummary,
      transaction: transactionRecord,
    });
  } catch (error) {
    console.error('Trade Execution Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Trade execution failed. Please try again.',
    });
  }
};

/**
 * Get user trade transaction history
 */
const getTradeHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '20', 10);
    const skip = (page - 1) * limit;

    const query = {
      userId: req.user._id,
      type: { $in: ['BUY_BTC', 'SELL_BTC', 'TRADE_SWAP'] },
    };

    const total = await Transaction.countDocuments(query);
    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    return res.status(200).json({
      success: true,
      trades: transactions,
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

module.exports = {
  getTradeQuote,
  executeTrade,
  getTradeHistory,
};

