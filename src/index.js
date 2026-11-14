const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mongoose = require('mongoose');
const { connectDB } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const miningRoutes = require('./routes/miningRoutes');
const networkRoutes = require('./routes/networkRoutes');
const walletRoutes = require('./routes/walletRoutes');
const tradeRoutes = require('./routes/tradeRoutes');
const adminRoutes = require('./routes/adminRoutes');

const {
  scheduleDailyBinarySettlement,
  runDailyBinarySettlement,
  startAutoBinarySettlementScheduler,
} = require('./services/binaryService');
const { startAutoYieldScheduler, runAutoDailyYield } = require('./services/miningYieldService');

const app = express();
const PORT = process.env.PORT || 5000;

// Connect to MongoDB via Mongoose
connectDB();

// Middleware
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/mining', miningRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/admin', adminRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const state = mongoose.connection.readyState;
  const stateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

  res.status(200).json({
    status: 'online',
    system: 'Bitcoin Mining & Binary MLM System (Mongoose Edition)',
    database: 'MongoDB + Mongoose ODM',
    databaseState: stateMap[state] || 'unknown',
    timestamp: new Date().toISOString(),
    supportedTiers: [100, 300, 1000, 5000, 10000, 30000],
    rules: {
      directReferralBonus: '10% one-time reward on service purchases',
      binaryPairingBonus: '10% reward per 1,000 pair (100 USDT) for qualified Star & Crown users, auto-settled daily on next day cycle',
      contractLifecycle: '1,500 days per ASIC mining package contract',
      yieldWarmup: '48h hardware warm-up rule active before daily yields commence',
    },
  });
});

// Root welcome endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to BTCM Mongoose Backend API',
    health: '/api/health',
    version: '1.0.0',
  });
});

// API 404 fallback - ensure API always returns JSON, never HTML
app.use('/api', (req, res) => {
  res.status(404).json({
    success: false,
    message: `API endpoint not found: ${req.method} ${req.originalUrl}`,
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Mongoose Server Error]:', err.stack);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 BTCM Mongoose Backend running on port ${PORT}`);
  console.log(`🍃 Database: MongoDB + Mongoose ODM`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`⭐ Star Ranking & Next Day Daily Binary Settlement active`);
  console.log(`⚡ Automated System { Mine Daily Yield } active (48h warm-up)`);
  console.log(`=======================================================`);

  // Initialize automated background { Mine Daily Yield } scheduler
  startAutoYieldScheduler();

  // Initialize automated next day daily binary settlement scheduler (tracks LAST_BINARY_SETTLEMENT_DATE)
  startAutoBinarySettlementScheduler();
});

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection]:', reason);
});

module.exports = { app, server };

