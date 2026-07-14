const express = require('express');
const router = express.Router();
const PaymentSettings = require('../models/PaymentSettings');
const EmailSettings = require('../models/EmailSettings');

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

// Get email settings
router.get('/email-settings', async (req, res) => {
  try {
    let settings = await EmailSettings.findOne();

    if (!settings) {
      settings = await EmailSettings.create({});
    }

    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update email settings
router.put('/email-settings', async (req, res) => {
  try {
    const { senderEmail, senderPassword, ownerEmail } = req.body;

    let settings = await EmailSettings.findOne();

    if (!settings) {
      settings = await EmailSettings.create({ senderEmail, senderPassword, ownerEmail });
    } else {
      if (senderEmail !== undefined) settings.senderEmail = senderEmail;
      if (senderPassword !== undefined) settings.senderPassword = senderPassword;
      if (ownerEmail !== undefined) settings.ownerEmail = ownerEmail;
      await settings.save();
    }

    res.json({ success: true, message: "Email settings updated", data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Test email configuration
router.post('/email-settings/test', async (req, res) => {
  try {
    const settings = await EmailSettings.findOne();
    if (!settings || !settings.senderEmail || !settings.senderPassword || !settings.ownerEmail) {
      return res.status(400).json({ success: false, message: "Please save all configuration fields first before testing" });
    }

    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: settings.senderEmail,
        pass: settings.senderPassword
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: {
        name: 'Dr BSK System Test',
        address: settings.senderEmail
      },
      to: settings.ownerEmail,
      subject: 'Dr BSK Portal - SMTP Configuration Test',
      html: `
        <h3>SMTP Configuration Test Succeeded!</h3>
        <p>This is a test email sent from the Dr BSK Healthcare portal admin panel.</p>
        <p>If you received this email, it means your SMTP configuration details are correct and working perfectly.</p>
        <p><strong>Sender Email:</strong> ${settings.senderEmail}</p>
        <p><strong>Owner Notification Email:</strong> ${settings.ownerEmail}</p>
        <p style="color: #777; font-size: 12px; margin-top: 20px;">Sent at: ${new Date().toLocaleString()}</p>
      `,
      text: `SMTP Configuration Test Succeeded!
This is a test email sent from the Dr BSK Healthcare portal admin panel.
If you received this email, it means your SMTP configuration details are correct and working perfectly.
Sender Email: ${settings.senderEmail}
Owner Notification Email: ${settings.ownerEmail}
Sent at: ${new Date().toLocaleString()}`
    };

    console.log(`Sending SMTP test email from ${settings.senderEmail} to ${settings.ownerEmail}...`);
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ SMTP test email sent successfully: ${info.messageId}`);

    res.json({ success: true, message: "Test email sent successfully", messageId: info.messageId });
  } catch (error) {
    console.error("❌ SMTP test email failed:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get Razorpay credentials
router.get('/razorpay-credentials', async (req, res) => {
  try {
    let settings = await PaymentSettings.findOne();
    if (!settings) {
      settings = await PaymentSettings.create({ codEnabled: true });
    }
    res.json({
      success: true,
      data: {
        razorpayKeyId: settings.razorpayKeyId || '',
        razorpayKeySecret: settings.razorpayKeySecret ? '********' : '',
        razorpayWebhookSecret: settings.razorpayWebhookSecret ? '********' : ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update Razorpay credentials
router.put('/razorpay-credentials', async (req, res) => {
  try {
    const { razorpayKeyId, razorpayKeySecret, razorpayWebhookSecret } = req.body;
    let settings = await PaymentSettings.findOne();
    if (!settings) {
      settings = new PaymentSettings({ codEnabled: true });
    }

    if (razorpayKeyId !== undefined) settings.razorpayKeyId = razorpayKeyId;
    if (razorpayKeySecret !== undefined && razorpayKeySecret !== '********') {
      settings.razorpayKeySecret = razorpayKeySecret;
    }
    if (razorpayWebhookSecret !== undefined && razorpayWebhookSecret !== '********') {
      settings.razorpayWebhookSecret = razorpayWebhookSecret;
    }

    await settings.save();
    res.json({
      success: true,
      message: "Razorpay credentials updated successfully",
      data: {
        razorpayKeyId: settings.razorpayKeyId || '',
        razorpayKeySecret: settings.razorpayKeySecret ? '********' : '',
        razorpayWebhookSecret: settings.razorpayWebhookSecret ? '********' : ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;