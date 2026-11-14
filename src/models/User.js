const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
    },
    fullName: {
      type: String,
      default: '',
      trim: true,
    },
    referralCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    sponsor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    binaryParent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    binaryPosition: {
      type: String,
      enum: ['A', 'B', null], // A = Left, B = Right
      default: null,
    },
    binaryLeftChild: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    binaryRightChild: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    defaultPlacementLeg: {
      type: String,
      enum: ['A', 'B', 'AUTO'],
      default: 'A',
    },
    binaryLegs: {
      legACurrent: { type: Number, default: 0 },
      legBCurrent: { type: Number, default: 0 },
      legATotal: { type: Number, default: 0 },
      legBTotal: { type: Number, default: 0 },
      pairsCount: { type: Number, default: 0 },
      lastSettledAt: { type: Date, default: null },
      lastSettledDate: { type: String, default: null },
      pairsAchievedDate: { type: String, default: null },
    },
    wallet: {
      usdBalance: { type: Number, default: 0 },
      btcBalance: { type: Number, default: 0 },
      totalDirectEarned: { type: Number, default: 0 },
      totalBinaryEarned: { type: Number, default: 0 },
      totalMiningBtcEarned: { type: Number, default: 0 },
      totalInvested: { type: Number, default: 0 },
      totalBinaryConfiscated: { type: Number, default: 0 },
    },
    starRank: {
      type: Number,
      default: 0,
      min: 0,
      max: 10, // 0 to 7 Star, 8=Crown, 9=2 Crown, 10=3 Crown
    },
    preferredLanguage: {
      type: String,
      enum: ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'ru'],
      default: 'en',
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
    country: {
      type: String,
      default: '',
      trim: true,
    },
    address: {
      type: String,
      default: '',
      trim: true,
    },
    bio: {
      type: String,
      default: '',
      trim: true,
    },
    btcPayoutAddress: {
      type: String,
      default: '',
      trim: true,
    },
    usdtPayoutAddress: {
      type: String,
      default: '',
      trim: true,
    },
    usdtTrc20PayoutAddress: {
      type: String,
      default: '',
      trim: true,
    },
    usdtErc20PayoutAddress: {
      type: String,
      default: '',
      trim: true,
    },
    usdcPayoutAddress: {
      type: String,
      default: '',
      trim: true,
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'SUSPENDED', 'BANNED'],
      default: 'ACTIVE',
    },
    kyc: {
      status: {
        type: String,
        enum: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'],
        default: 'UNVERIFIED',
      },
      documentType: {
        type: String,
        enum: ['PASSPORT', 'NATIONAL_ID', 'DRIVING_LICENSE', ''],
        default: '',
      },
      documentNumber: {
        type: String,
        default: '',
        trim: true,
      },
      frontImageUrl: {
        type: String,
        default: '',
      },
      backImageUrl: {
        type: String,
        default: '',
      },
      selfieImageUrl: {
        type: String,
        default: '',
      },
      submittedAt: {
        type: Date,
        default: null,
      },
      reviewedAt: {
        type: Date,
        default: null,
      },
      rejectionReason: {
        type: String,
        default: '',
      },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// 2dsphere index for location queries
userSchema.index({ location: '2dsphere' });
userSchema.index({ sponsor: 1 });
userSchema.index({ binaryParent: 1 });

// Password hashing middleware
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Virtual: Star badges and descriptions
userSchema.virtual('starBadge').get(function () {
  const r = this.starRank || 0;
  if (r >= 10) return '👑👑👑 3 CROWN';
  if (r === 9) return '👑👑 2 CROWN';
  if (r === 8) return '👑 CROWN';
  if (r === 7) return '★★★★★★★ 7 STAR';
  if (r === 6) return '★★★★★★ 6 STAR';
  if (r === 5) return '★★★★★ 5 STAR';
  if (r === 4) return '★★★★ 4 STAR';
  if (r === 3) return '★★★ 3 STAR';
  if (r === 2) return '★★ 2 STAR';
  if (r === 1) return '★ 1 STAR';
  return null;
});

userSchema.virtual('starIcon').get(function () {
  const r = this.starRank || 0;
  if (r >= 10) return '👑👑👑';
  if (r === 9) return '👑👑';
  if (r === 8) return '👑';
  if (r === 7) return '⭐⭐⭐⭐⭐⭐⭐';
  if (r === 6) return '⭐⭐⭐⭐⭐⭐';
  if (r === 5) return '⭐⭐⭐⭐⭐';
  if (r === 4) return '⭐⭐⭐⭐';
  if (r === 3) return '⭐⭐⭐';
  if (r === 2) return '⭐⭐';
  if (r === 1) return '⭐';
  return null;
});

userSchema.virtual('isStarQualified').get(function () {
  return (this.starRank || 0) >= 1;
});

module.exports = mongoose.model('User', userSchema);

