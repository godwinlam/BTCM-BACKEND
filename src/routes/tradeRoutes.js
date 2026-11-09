const express = require('express');
const router = express.Router();
const {
  getTradeQuote,
  executeTrade,
  getTradeHistory,
} = require('../controllers/tradeController');
const { protect } = require('../middleware/auth');

// Optional auth for quote to display wallet if logged in, but public can also view live price & limits
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return protect(req, res, next);
  }
  next();
};

router.get('/quote', optionalAuth, getTradeQuote);
router.post('/swap', protect, executeTrade);
router.get('/history', protect, getTradeHistory);

module.exports = router;

