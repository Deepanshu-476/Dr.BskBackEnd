const mongoose = require('mongoose');

const paymentSettingsSchema = new mongoose.Schema({
  codEnabled: {
    type: Boolean,
    default: true
  },
  razorpayKeyId: {
    type: String,
    default: ''
  },
  razorpayKeySecret: {
    type: String,
    default: ''
  },
  razorpayWebhookSecret: {
    type: String,
    default: ''
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentSettings', paymentSettingsSchema);