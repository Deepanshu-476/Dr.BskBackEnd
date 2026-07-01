const mongoose = require('mongoose');
const { generateBskId } = require("../utils/bskIds");

const wholesalePartnerSchema = new mongoose.Schema({
  publicId: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    default: () => generateBskId("WS")
  },
  companyName: { type: String },
  website: { type: String },
  gstNumber: { type: String, minlength: 15 },
  phone: { type: String },
  street: { type: String },
  city: { type: String },
  state: { type: String },
  zipcode: { type: String },
  country: { type: String },
  billingEmail: { type: String, trim: true, lowercase: true },
  password: { type: String },
  status: { type: String, default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('WholesalePartner', wholesalePartnerSchema);
