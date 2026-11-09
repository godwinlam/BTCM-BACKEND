const mongoose = require('mongoose');

/**
 * Connect to MongoDB using Mongoose (Standalone / Direct Host Node.js)
 */
const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/btcm_db';
  const dbName = process.env.DB_NAME || 'btcm_db';

  try {
    const conn = await mongoose.connect(uri, {
      dbName,
      serverSelectionTimeoutMS: 10000,
      autoIndex: true,
    });

    console.log(`[Mongoose Connected]: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (err) {
    console.error(`[Mongoose Connection Error]: ${err.message}`);
    console.warn(`[Mongoose Notice]: Ensure MongoDB daemon or Atlas URI is reachable at: ${uri.replace(/:([^@]+)@/, ':***@')}`);
    return null;
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('[Mongoose Event]: Connection disconnected.');
});

mongoose.connection.on('error', (err) => {
  console.error('[Mongoose Error]:', err.message);
});

module.exports = { connectDB };
