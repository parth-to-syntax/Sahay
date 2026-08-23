const express = require('express');
const bamboohrRoutes = require('./bamboohr.routes');
const slackRoutes = require('./slack.routes');
const syncRoutes = require('./sync.routes');
const googleCalendarRoutes = require('./googleCalendar.routes');
const dbRoutes = require('./db.routes');
const ingestRoutes = require('./ingest.routes');
const memoryRoutes = require('./memory.routes');
const intelligenceRoutes = require('./intelligence.routes');

const router = express.Router();

router.use('/bamboohr', bamboohrRoutes);
router.use('/slack', slackRoutes);
router.use('/sync', syncRoutes);
router.use('/calendar/google', googleCalendarRoutes);
router.use('/db', dbRoutes);
router.use('/ingest', ingestRoutes);
router.use('/memory', memoryRoutes);
router.use('/intelligence', intelligenceRoutes);

module.exports = router;
