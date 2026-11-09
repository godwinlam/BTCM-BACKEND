const express = require('express');
const router = express.Router();
const {
  getBalance,
  getTransactions,
  transfer,
  requestWithdrawal,
  submitDeposit,
  getDepositConfig,
  getDepositInfo,
  lookupRecipient,
  getUserDeposits,
} = require('../controllers/walletController');
const { protect } = require('../middleware/auth');

router.get('/balance', protect, getBalance);
router.get('/transactions', protect, getTransactions);
router.post('/transfer', protect, transfer);
router.post('/withdraw', protect, requestWithdrawal);
router.post('/deposit', protect, submitDeposit);
router.get('/deposit-config', getDepositConfig);
router.get('/deposit-info', protect, getDepositInfo || getDepositConfig);
router.get('/recipient-lookup', protect, lookupRecipient);
router.get('/my-deposits', protect, getUserDeposits);

module.exports = router;

