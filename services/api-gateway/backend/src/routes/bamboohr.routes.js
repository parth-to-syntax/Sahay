const express = require('express');
const {
  getMetaFields,
  getEmployeeDirectory,
  getEmployeeById
} = require('../connectors/bamboohr/bamboohrClient');
const bamboohrSchemaRoutes = require('./bamboohr.schema.routes');

const router = express.Router();

router.get('/meta/fields', async (_req, res, next) => {
  try {
    const data = await getMetaFields();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/employees/directory', async (_req, res, next) => {
  try {
    const data = await getEmployeeDirectory();
    // Avoid returning full directory if huge; still okay for dev.
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/employees/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fields } = req.query;
    const data = await getEmployeeById(id, fields);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

router.use('/schema', bamboohrSchemaRoutes);

module.exports = router;
