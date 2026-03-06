const express = require('express');
const router = express.Router();
const PaymentSettings = require('../models/PaymentSettings');

// Get payment settings
router.get('/cash-on-delivery', async (req, res) => {
  try {
    let settings = await PaymentSettings.findOne();

    if (!settings) {
      settings = await PaymentSettings.create({ codEnabled: true });
    }

    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update COD status
router.put('/Updated-COD', async (req, res) => {
  try {
    const { codEnabled } = req.body;

    let settings = await PaymentSettings.findOne();

    if (!settings) {
      settings = await PaymentSettings.create({ codEnabled });
    } else {
      settings.codEnabled = codEnabled;
      await settings.save();
    }

    res.json({ success: true, message: "Payment settings updated", data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;