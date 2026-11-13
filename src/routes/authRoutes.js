const express = require('express');
const router = express.Router();
const { register, login, getMe, updateProfile, updatePassword, submitKyc, updateLanguage } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/language', protect, updateLanguage);
router.put('/password', protect, updatePassword);
router.post('/kyc', protect, submitKyc);

module.exports = router;

