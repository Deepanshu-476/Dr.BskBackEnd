const mongoose = require('mongoose');

const emailSettingsSchema = new mongoose.Schema({
  senderEmail: {
    type: String,
    default: 'drbskhealthcare@gmail.com'
  },
  senderPassword: {
    type: String,
    default: 'yxnykcgxwtslcdtl'
  },
  ownerEmail: {
    type: String,
    default: 'himanshujangra0633@gmail.com'
  }
}, { timestamps: true });

module.exports = mongoose.model('EmailSettings', emailSettingsSchema);
