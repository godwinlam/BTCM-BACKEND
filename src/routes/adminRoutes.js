const express = require('express');
const router = express.Router();
const {
  getDashboardStats,
  listUsers,
  getUserById,
  updateUser,
  updateUserStatus,
  adjustUserBalance,
  adjustUserWallet,
  resetUserPassword,
  reviewUserKyc,
} = require('../controllers/adminController');
const {
  listDeposits,
  getDepositById,
  approveDeposit,
  rejectDeposit,
  getDepositStats,
  getDepositConfig,
  updateDepositConfig,
} = require('../controllers/adminDepositController');
const {
  listWithdrawals,
  getWithdrawalById,
  approveWithdrawal,
  rejectWithdrawal,
  getWithdrawalStats,
} = require('../controllers/adminWithdrawalController');
const { protect, adminOnly } = require('../middleware/auth');

// All admin routes protected
router.use(protect, adminOnly);

// Stats & Users
router.get('/stats', getDashboardStats);
router.get('/users', listUsers);
router.get('/users/:id', getUserById);
router.put('/users/:id', updateUser);
router.put('/users/:id/status', updateUserStatus);
router.post('/users/:id/balance', adjustUserBalance);
router.post('/users/:id/adjust-wallet', adjustUserWallet);
router.post('/users/:id/reset-password', resetUserPassword);
router.put('/users/:id/kyc', reviewUserKyc);

// Deposits Management
router.get('/deposits/stats', getDepositStats);
router.get('/deposits/config', getDepositConfig);
router.put('/deposits/config', updateDepositConfig);
router.get('/deposits', listDeposits);
router.get('/deposits/:id', getDepositById);
router.post('/deposits/:id/approve', approveDeposit);
router.post('/deposits/:id/reject', rejectDeposit);

// Withdrawals Management
router.get('/withdrawals/stats', getWithdrawalStats);
router.get('/withdrawals', listWithdrawals);
router.get('/withdrawals/:id', getWithdrawalById);
router.post('/withdrawals/:id/approve', approveWithdrawal);
router.post('/withdrawals/:id/reject', rejectWithdrawal);

module.exports = router;

