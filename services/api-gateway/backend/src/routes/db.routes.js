const express = require('express');

const { connectMongo, mongoStatus } = require('../db/mongo');

const router = express.Router();

router.get('/health', async (_req, res, next) => {
  try {
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
