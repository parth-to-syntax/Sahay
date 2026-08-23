const express = require('express');
const { getMetaFields, getEmployeeDirectory } = require('../connectors/bamboohr/bamboohrClient');
const { compareSchema } = require('../features/bamboohrSchema/schemaCompare');
const searchRoutes = require('./bamboohr.schema.search.routes');

const router = express.Router();

// Returns what BambooHR can likely provide for your desired HRMS schema fields.
router.get('/compare', async (_req, res, next) => {
  try {
    const [metaFields, directoryData] = await Promise.all([
      getMetaFields(),
      getEmployeeDirectory()
    ]);

    const report = compareSchema({ metaFields, directoryData });

    res.json({ ok: true, data: report });
  } catch (err) {
    next(err);
  }
});

router.use('/', searchRoutes);

module.exports = router;
