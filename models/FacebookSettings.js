const mongoose = require('mongoose');

const facebookSettingsSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    default: 'Primary Pixel'
  },
  pixelId: {
    type: String,
    required: true
  },
  accessToken: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.model('FacebookSettings', facebookSettingsSchema);
