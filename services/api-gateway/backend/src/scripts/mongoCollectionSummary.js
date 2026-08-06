/* eslint-disable no-console */

const mongoose = require('mongoose');

const { loadConfig } = require('../shared/config');
const { connectMongo, mongoStatus } = require('../db/mongo');

loadConfig();

function toIso(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return String(value);
  }
}

async function safeEstimatedCount(db, name) {
  try {
    return await db.collection(name).estimatedDocumentCount();
  } catch {
    try {
      return await db.collection(name).countDocuments({});
    } catch {
      return null;
    }
  }
}

async function safeOrgCount(db, name, orgId) {
  if (!orgId) return null;
  try {
    return await db.collection(name).countDocuments({ orgId });
  } catch {
    return null;
  }
}

async function main() {
  const orgId = process.env.ORG_ID || process.env.DEFAULT_ORG_ID || 'demo';

  const conn = await connectMongo();
  const st = mongoStatus();

  if (!conn?.connected) {
    throw new Error(`MongoDB not connected (${conn?.reason || 'UNKNOWN'})`);
  }

  const db = mongoose.connection.db;
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();

  const rows = [];
  for (const c of collections) {
    const name = c?.name;
    if (!name) continue;
    if (name.startsWith('system.')) continue;

    // eslint-disable-next-line no-await-in-loop
    const total = await safeEstimatedCount(db, name);

    // eslint-disable-next-line no-await-in-loop
    const orgCount = await safeOrgCount(db, name, orgId);

    rows.push({ name, total, orgId, orgCount });
  }

  rows.sort((a, b) => {
    const at = typeof a.total === 'number' ? a.total : -1;
    const bt = typeof b.total === 'number' ? b.total : -1;
    if (bt !== at) return bt - at;
    return a.name.localeCompare(b.name);
  });

  const nonEmpty = rows.filter((r) => (r.total || 0) > 0);
  const empty = rows.filter((r) => (r.total || 0) === 0);

  const report = {
    generatedAt: new Date().toISOString(),
    mongo: {
      name: st.name,
      host: st.host,
      state: st.state
    },
    orgId,
    totals: {
      collections: rows.length,
      nonEmpty: nonEmpty.length,
      empty: empty.length
    },
    collections: rows
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error('[mongoCollectionSummary] failed:', err?.message || err);
  process.exit(1);
});
