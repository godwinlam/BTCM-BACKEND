# BTCM Mongoose Backend Database

A complete MongoDB + Mongoose backend implementation for the Bitcoin Mining Investment & 10% Binary Placement MLM platform.

---

## 🏗 Architecture & Stack
- **Runtime**: Node.js & Express.js
- **Database**: MongoDB with Mongoose ODM
- **Geospatial**: 2dsphere GeoJSON indexes for Mining Datacenter locations
- **Security**: JWT Authentication & Bcrypt password hashing
- **Automation**: Real-time hourly ASIC yield payouts + 23:59 daily binary settlement engine

---

## 📂 Project Structure
```
backend/
├── package.json               # Dependencies and scripts (Pure Node.js, No Docker required)
├── .env.example               # Environment template
├── .env                       # Local environment variables (MongoDB Atlas / Local URI)
└── src/
    ├── index.js               # Express server entry point & schedulers
    ├── seed.js                # Initial database seed script
    ├── config/
    │   └── db.js              # Mongoose connection & event handlers
    ├── models/                # Mongoose Schemas & Models
    │   ├── User.js            # Miner profile, wallet, binary legs, star ranks, addresses
    │   ├── MiningPackage.js   # 1,500-day enterprise ASIC contracts
    │   ├── MiningContract.js  # User-purchased active mining rigs
    │   ├── Transaction.js     # Dual ledger (USDT & BTC)
    │   ├── DepositRequest.js  # Proof-of-transfer deposit verification
    │   ├── WithdrawalRequest.js# Crypto withdrawal requests & refunds
    │   ├── Datacenter.js      # GeoJSON geospatial datacenter clusters
    │   └── SystemSetting.js   # Global platform configuration
    ├── middleware/
    │   └── auth.js            # JWT protection & admin-only guards
    ├── services/
    │   ├── binaryService.js   # 10% binary pairing, star ranking, volume propagation
    │   └── miningYieldService.js # 48h warm-up rule & automated daily BTC yield payouts
    ├── controllers/
    │   ├── authController.js
    │   ├── miningController.js
    │   ├── networkController.js
    │   ├── walletController.js
    │   ├── adminController.js
    │   ├── adminDepositController.js
    │   └── adminWithdrawalController.js
    └── routes/
        ├── authRoutes.js
        ├── miningRoutes.js
        ├── networkRoutes.js
        ├── walletRoutes.js
        └── adminRoutes.js
```

---

## ⚡ Core Business Rules Implemented
1. **10% Direct Referral Bonus**:
   - Sponsors receive an instant 10% reward upon downline ASIC package purchase.
2. **10% Binary Pairing Bonus**:
   - 10% payout (100 USDT per 1,000 Leg A & Leg B pairing volume) settled daily at 23:59.
   - Pairing cap governed by Star Ranking (1-Star to 3-Crown).
   - Excess volume beyond rank daily caps is confiscated by the system.
3. **1,500-Day ASIC Mining Lifecycle**:
   - Contracts run for 1,500 days with automated daily BTC yield distributions.
   - 48-hour hardware initialization warm-up period before payouts start.
4. **Multi-Currency Payout Addresses**:
   - Dedicated fields for Bitcoin Native, Tether TRC20, Tether ERC20, and USD Coin (USDC).
   - Full residential/postal address support in miner profiles.

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Set MONGODB_URI=mongodb://localhost:27017/btcm_db
```

### 3. Seed Database
```bash
npm run seed
```

### 4. Run the Server
```bash
# Development (with nodemon)
npm run dev

# Production
npm start
```

### 5. Health Check
Navigate to `http://localhost:5000/api/health`

