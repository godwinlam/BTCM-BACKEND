const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { evaluateUserStarRank } = require('../services/binaryService');

const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET || 'btcm_mongoose_jwt_secret_token_2026', {
    expiresIn: '30d',
  });
};

/**
 * Register a new miner
 */
const register = async (req, res) => {
  try {
    const {
      username,
      email,
      password,
      fullName,
      preferredLanguage,
      referralCode: inputSponsorRef,
      placementUsername,
      positionParent,
      positionUsername,
      placementLeg: inputLeg,
    } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username, email, and password' });
    }

    const normUsername = username.toLowerCase().trim();
    const normEmail = email.toLowerCase().trim();

    // Check existing
    const existing = await User.findOne({
      $or: [{ username: normUsername }, { email: normEmail }],
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Username or email already registered' });
    }

    // Resolve sponsor
    let sponsorUser = null;
    if (inputSponsorRef) {
      sponsorUser = await User.findOne({ referralCode: inputSponsorRef.toUpperCase().trim() });
    }
    if (!sponsorUser) {
      // Default to root admin or top miner
      sponsorUser = await User.findOne({ role: 'admin' });
    }

    // Generate unique referral code
    const newRefCode = 'BTC' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // STRICT BUSINESS RULE: Only a new user who has purchased a mining service package can be placed in the binary placement tree.
    // At registration time, the user is created under their sponsor with unplaced status (binaryParent = null, binaryPosition = null).
    const validLangs = ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'ru'];
    const chosenLang = validLangs.includes(preferredLanguage) ? preferredLanguage : 'en';

    const newUser = new User({
      username: normUsername,
      email: normEmail,
      password,
      fullName: fullName || normUsername,
      preferredLanguage: chosenLang,
      referralCode: newRefCode,
      sponsor: sponsorUser ? sponsorUser._id : null,
      binaryParent: null,
      binaryPosition: null,
    });

    await newUser.save();

    const token = generateToken(newUser._id);
    const populated = await User.findById(newUser._id)
      .populate('sponsor', 'username referralCode')
      .populate('binaryParent', 'username')
      .select('-password');

    return res.status(201).json({
      success: true,
      token,
      user: populated,
      message: 'Account created successfully. User must purchase a mining package to be placed into the binary placement tree.',
    });
  } catch (error) {
    console.error('[Register Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Login miner
 */
const login = async (req, res) => {
  try {
    const { loginId, username, password } = req.body;
    const identifier = (loginId || username || '').toLowerCase().trim();

    if (!identifier || !password) {
      return res.status(400).json({ success: false, message: 'Please provide username/email and password' });
    }

    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password' });
    }

    if (user.status === 'BANNED' || user.status === 'SUSPENDED') {
      return res.status(403).json({ success: false, message: `Account is ${user.status.toLowerCase()}` });
    }

    const starInfo = await evaluateUserStarRank(user._id);
    const token = generateToken(user._id);

    const populated = await User.findById(user._id)
      .populate('sponsor', 'username referralCode')
      .populate('binaryParent', 'username')
      .populate('binaryLeftChild', 'username')
      .populate('binaryRightChild', 'username')
      .select('-password');

    return res.status(200).json({
      success: true,
      token,
      user: populated,
    });
  } catch (error) {
    console.error('[Login Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get current profile
 */
const getMe = async (req, res) => {
  try {
    await evaluateUserStarRank(req.user._id);

    const populated = await User.findById(req.user._id)
      .populate('sponsor', 'username referralCode')
      .populate('binaryParent', 'username')
      .populate('binaryLeftChild', 'username')
      .populate('binaryRightChild', 'username')
      .select('-password');

    if (!populated) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    return res.status(200).json({
      success: true,
      user: populated,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update authenticated user profile
 */
const updateProfile = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      country,
      address,
      bio,
      btcPayoutAddress,
      usdtPayoutAddress,
      usdtTrc20PayoutAddress,
      usdtErc20PayoutAddress,
      usdcPayoutAddress,
      defaultPlacementLeg,
      preferredLanguage,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (email && email.toLowerCase().trim() !== user.email) {
      const emailTaken = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
      if (emailTaken) {
        return res.status(400).json({ success: false, message: 'Email address already in use by another miner' });
      }
      user.email = email.toLowerCase().trim();
    }

    if (fullName !== undefined) user.fullName = fullName;
    if (phone !== undefined) user.phone = phone;
    if (country !== undefined) user.country = country;
    if (address !== undefined) user.address = address;
    if (bio !== undefined) user.bio = bio;
    if (btcPayoutAddress !== undefined) user.btcPayoutAddress = btcPayoutAddress;

    // Payout addresses
    if (usdtTrc20PayoutAddress !== undefined) user.usdtTrc20PayoutAddress = usdtTrc20PayoutAddress;
    if (usdtErc20PayoutAddress !== undefined) user.usdtErc20PayoutAddress = usdtErc20PayoutAddress;
    if (usdcPayoutAddress !== undefined) user.usdcPayoutAddress = usdcPayoutAddress;
    if (usdtPayoutAddress !== undefined) {
      user.usdtPayoutAddress = usdtPayoutAddress;
      if (!user.usdtTrc20PayoutAddress) user.usdtTrc20PayoutAddress = usdtPayoutAddress;
    }

    if (['A', 'B', 'AUTO'].includes(defaultPlacementLeg)) {
      user.defaultPlacementLeg = defaultPlacementLeg;
    }

    const validLangs = ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'ru'];
    if (preferredLanguage && validLangs.includes(preferredLanguage)) {
      user.preferredLanguage = preferredLanguage;
    }

    await user.save();

    const populated = await User.findById(user._id)
      .populate('sponsor', 'username referralCode')
      .populate('binaryParent', 'username')
      .populate('binaryLeftChild', 'username')
      .populate('binaryRightChild', 'username')
      .select('-password');

    return res.status(200).json({
      success: true,
      user: populated,
      message: 'Profile updated successfully',
    });
  } catch (error) {
    console.error('[Update Profile Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update password
 */
const updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Please provide both current and new password' });
    }

    const user = await User.findById(req.user._id);
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Incorrect current password' });
    }

    user.password = newPassword;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Submit KYC verification request
 */
const submitKyc = async (req, res) => {
  try {
    const { documentType, documentNumber, frontImageUrl, backImageUrl, selfieImageUrl } = req.body;

    if (!documentType || !documentNumber) {
      return res.status(400).json({ success: false, message: 'Document type and document number are required.' });
    }

    if (!frontImageUrl) {
      return res.status(400).json({ success: false, message: 'Proof of Identity (Front photo) is required.' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.kyc = {
      status: 'PENDING',
      documentType,
      documentNumber: documentNumber.trim(),
      frontImageUrl: frontImageUrl || '',
      backImageUrl: backImageUrl || '',
      selfieImageUrl: selfieImageUrl || '',
      submittedAt: new Date(),
      reviewedAt: null,
      rejectionReason: '',
    };

    await user.save();

    const populated = await User.findById(user._id)
      .populate('sponsor', 'username referralCode')
      .populate('binaryParent', 'username')
      .populate('binaryLeftChild', 'username')
      .populate('binaryRightChild', 'username')
      .select('-password');

    return res.status(200).json({
      success: true,
      user: populated,
      message: 'KYC identity documents submitted successfully for compliance verification.',
    });
  } catch (error) {
    console.error('[Submit KYC Error]:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Update user language preference
 */
const updateLanguage = async (req, res) => {
  try {
    const { language } = req.body;
    const valid = ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'es', 'ru'];
    if (!valid.includes(language)) {
      return res.status(400).json({ success: false, message: 'Invalid language code. Supported: en, zh-TW, zh-CN, ja, ko, es, ru' });
    }
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    user.preferredLanguage = language;
    await user.save();
    return res.status(200).json({
      success: true,
      preferredLanguage: user.preferredLanguage,
      message: 'Language preference saved successfully',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  register,
  login,
  getMe,
  updateProfile,
  updatePassword,
  submitKyc,
  updateLanguage,
};

