const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        'DIRECT_REFERRAL_BONUS',
        'BINARY_PAIRING_BONUS',
        'BINARY_PAIRING_CONFISCATED',
        'MINING_YIELD',
        'WALLET_DEPOSIT',
        'PACKAGE_PURCHASE',
        'TRANSFER_IN',
        'TRANSFER_OUT',
        'WITHDRAWAL',
        'WITHDRAWAL_REFUND',
        'ADMIN_ADJUSTMENT',
        'BUY_BTC',
        'SELL_BTC',
        'TRADE_SWAP',
      ],
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      required: true,
      enum: ['USDT', 'BTC', 'USDC'],
      default: 'USDT',
    },
    description: {
      type: String,
      default: '',
    },
    sourceUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['COMPLETED', 'PENDING', 'REJECTED'],
      default: 'COMPLETED',
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);

