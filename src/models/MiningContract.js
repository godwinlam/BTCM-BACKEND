const mongoose = require('mongoose');

const miningContractSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tier: {
      type: Number,
      required: true,
    },
    packageTier: {
      type: Number,
      default: function () {
        return this.tier;
      },
    },
    packageName: {
      type: String,
      required: true,
    },
    hashrate: {
      type: String,
      required: true,
    },
    hashrateThs: {
      type: Number,
      default: function () {
        return parseFloat(this.hashrate) || 0;
      },
    },
    priceUsd: {
      type: Number,
      required: true,
    },
    costUsd: {
      type: Number,
      default: function () {
        return this.priceUsd;
      },
    },
    dailyBtcYield: {
      type: Number,
      required: true,
    },
    dailyBtcReward: {
      type: Number,
      default: function () {
        return this.dailyBtcYield;
      },
    },
    minDailyBtcYield: {
      type: Number,
      default: function () {
        return this.dailyBtcYield;
      },
    },
    maxDailyBtcYield: {
      type: Number,
      default: function () {
        return this.dailyBtcYield;
      },
    },
    maxDays: {
      type: Number,
      default: 1500, // 1500 days total
    },
    daysRemaining: {
      type: Number,
      default: 1500,
    },
    daysCompleted: {
      type: Number,
      default: 0,
    },
    daysPassed: {
      type: Number,
      default: 0,
    },
    totalBtcHarvested: {
      type: Number,
      default: 0,
    },
    totalBtcMined: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'COMPLETED', 'EXPIRED', 'PENDING'],
      default: 'ACTIVE',
      index: true,
    },
    startDate: {
      type: Date,
      default: Date.now,
    },
    purchasedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: function () {
        const d = new Date();
        d.setDate(d.getDate() + 1500);
        return d;
      },
    },
    lastHarvestAt: {
      type: Date,
      default: null,
    },
    lastYieldAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

miningContractSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('MiningContract', miningContractSchema);
