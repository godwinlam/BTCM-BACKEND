const mongoose = require('mongoose');

const miningPackageSchema = new mongoose.Schema(
  {
    tier: {
      type: Number,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    tagline: {
      type: String,
      default: '',
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
      default: 1500, // 1,500-day enterprise contract lifecycle
    },
    durationDays: {
      type: Number,
      default: 1500,
    },
    estimatedDailyUsd: {
      type: Number,
      default: 0,
    },
    efficiency: {
      type: String,
      default: '29.5 J/TH',
    },
    badge: {
      type: String,
      default: 'ASIC RIG',
    },
    datacenterName: {
      type: String,
      default: '',
    },
    latitude: {
      type: Number,
      default: 0,
    },
    longitude: {
      type: Number,
      default: 0,
    },
    description: {
      type: String,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

module.exports = mongoose.model('MiningPackage', miningPackageSchema);
