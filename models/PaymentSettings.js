const mongoose = require('mongoose');

const paymentSettingsSchema = new mongoose.Schema({
  codEnabled: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentSettings', paymentSettingsSchema);