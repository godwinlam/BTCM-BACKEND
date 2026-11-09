const express = require('express');
const router = express.Router();
const {
  getPackages,
  getActiveContracts,
  purchasePackage,
  harvestDailyYield,
  getMineBestInfo,
  getLiveBtcPrice,
} = require('../controllers/miningController');
const { protect } = require('../middleware/auth');

router.get('/btc-price', getLiveBtcPrice);
router.get('/minebest-info', getMineBestInfo);
router.get('/packages', getPackages);
router.get('/contracts', protect, getActiveContracts);
router.get('/my-contracts', protect, getActiveContracts);
router.post('/purchase', protect, purchasePackage);
router.post('/harvest', protect, harvestDailyYield);
router.post('/auto-payout', protect, harvestDailyYield);

module.exports = router;

