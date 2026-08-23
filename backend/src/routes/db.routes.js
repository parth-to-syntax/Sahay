const express = require('express');

const { connectMongo, mongoStatus } = require('../db/mongo');
const { isDemoMode, getDemoDbHealth } = require('../demo/demoData');

const router = express.Router();

router.get('/health', async (_req, res, next) => {
  try {
    if (isDemoMode()) {
      return res.json(getDemoDbHealth());
    }

    const before = mongoStatus();
    const conn = await connectMongo();
    const after = mongoStatus();

    res.json({
      ok: true,
      data: {
        before,
        connectAttempt: conn,
        after
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
