const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema(
  {
    orgId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() }
  },
  { collection: 'organizations' }
);

module.exports = mongoose.model('Organization', OrganizationSchema);
