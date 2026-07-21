const mongoose = require('mongoose');

const paymentSettingsSchema = new mongoose.Schema({
  codEnabled: {
    type: Boolean,
<<<<<<< HEAD
    default: false
=======
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
>>>>>>> c94560aca631df18c0f446a666a85ac46884135b
  }
}, { timestamps: true });

module.exports = mongoose.model('PaymentSettings', paymentSettingsSchema);
