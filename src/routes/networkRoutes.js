const express = require('express');
const router = express.Router();
const {
  getSummary,
  getTree,
  getReferrals,
  placeMember,
  getStarRankingInfo,
  settleDailyBinaryPairing,
} = require('../controllers/networkController');
const { protect } = require('../middleware/auth');

router.get('/summary', protect, getSummary);
router.get('/tree', protect, getTree);
router.get('/referrals', protect, getReferrals);
router.get('/star-ranking', protect, getStarRankingInfo);
router.post('/settle-daily-binary', protect, settleDailyBinaryPairing);
router.post('/place', protect, placeMember);

module.exports = router;

