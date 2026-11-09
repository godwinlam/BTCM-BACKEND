const mongoose = require('mongoose');

const datacenterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
    },
    country: {
      type: String,
      required: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    hashrateThs: {
      type: Number,
      required: true,
    },
    activeMiners: {
      type: Number,
      default: 0,
    },
    energySource: {
      type: String,
      default: '100% Renewable',
    },
    pue: {
      type: Number,
      default: 1.05,
    },
    status: {
      type: String,
      enum: ['OPERATIONAL', 'MAINTENANCE', 'OFFLINE'],
      default: 'OPERATIONAL',
    },
  },
  {
    timestamps: true,
  }
);

datacenterSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Datacenter', datacenterSchema);

