const mongoose = require('mongoose');

let isConnecting = false;

function getMongoUri() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  return uri && String(uri).trim() !== '' ? String(uri).trim() : null;
}

async function connectMongo() {
  const uri = getMongoUri();
  if (!uri) return { connected: false, reason: 'MONGODB_URI_NOT_SET' };

  if (mongoose.connection.readyState === 1) {
    return { connected: true, name: mongoose.connection.name, host: mongoose.connection.host };
  }

  if (isConnecting) {
    // Wait briefly for the in-flight connection attempt.
    await new Promise((r) => setTimeout(r, 200));
    return { connected: mongoose.connection.readyState === 1, name: mongoose.connection.name };
  }

  isConnecting = true;
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000
    });

    return { connected: true, name: mongoose.connection.name, host: mongoose.connection.host };
  } finally {
    isConnecting = false;
  }
}

function mongoStatus() {
  const uriSet = Boolean(getMongoUri());
  const readyState = mongoose.connection.readyState;
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return {
    uriSet,
    readyState,
    state: states[readyState] || 'unknown',
    name: mongoose.connection.name || null,
    host: mongoose.connection.host || null
  };
}

module.exports = {
  connectMongo,
  mongoStatus
};
