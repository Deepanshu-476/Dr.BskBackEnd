const express = require('express');
const router = express.Router();
const FacebookSettings = require('../models/FacebookSettings');

// Get all Facebook configurations
router.get('/', async (req, res) => {
  try {
    const settings = await FacebookSettings.find().sort({ createdAt: -1 });
    // Mask access token for security
    const maskedSettings = settings.map(s => {
      const obj = s.toObject();
      obj.accessToken = s.accessToken ? '********' : '';
      return obj;
    });
    res.json({ success: true, data: maskedSettings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get active pixel ID (public/publicly accessible for frontend)
router.get('/active', async (req, res) => {
  try {
    const activeSetting = await FacebookSettings.findOne({ isActive: true });
    res.json({
      success: true,
      pixelId: activeSetting ? activeSetting.pixelId : (process.env.FACEBOOK_PIXEL_ID || '4397582790565563')
    });
  } catch (error) {
    res.json({ success: false, pixelId: process.env.FACEBOOK_PIXEL_ID || '4397582790565563' });
  }
});

// Create new configuration
router.post('/', async (req, res) => {
  try {
    const { label, pixelId, accessToken, isActive } = req.body;
    if (!label || !pixelId || !accessToken) {
      return res.status(400).json({ success: false, message: "Label, Pixel ID and Access Token are required" });
    }

    if (isActive) {
      // Deactivate all others
      await FacebookSettings.updateMany({}, { isActive: false });
    }

    const count = await FacebookSettings.countDocuments();

    const newSetting = await FacebookSettings.create({
      label,
      pixelId,
      accessToken,
      isActive: count === 0 ? true : !!isActive // first one is active by default
    });

    res.json({ success: true, message: "Configuration created successfully", data: newSetting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update configuration
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { label, pixelId, accessToken, isActive } = req.body;

    const setting = await FacebookSettings.findById(id);
    if (!setting) {
      return res.status(404).json({ success: false, message: "Configuration not found" });
    }

    if (label !== undefined) setting.label = label;
    if (pixelId !== undefined) setting.pixelId = pixelId;
    if (accessToken !== undefined && accessToken !== '********') {
      setting.accessToken = accessToken;
    }

    if (isActive) {
      // Deactivate all others
      await FacebookSettings.updateMany({ _id: { $ne: id } }, { isActive: false });
      setting.isActive = true;
    }

    await setting.save();
    res.json({ success: true, message: "Configuration updated successfully", data: setting });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Toggle Active status
router.put('/:id/toggle-active', async (req, res) => {
  try {
    const { id } = req.params;
    const setting = await FacebookSettings.findById(id);
    if (!setting) {
      return res.status(404).json({ success: false, message: "Configuration not found" });
    }

    // Set all others to false
    await FacebookSettings.updateMany({ _id: { $ne: id } }, { isActive: false });
    
    // Set this one to true
    setting.isActive = true;
    await setting.save();

    res.json({ success: true, message: "Pixel activated successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete configuration
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const setting = await FacebookSettings.findById(id);
    if (!setting) {
      return res.status(404).json({ success: false, message: "Configuration not found" });
    }

    const wasActive = setting.isActive;
    await FacebookSettings.findByIdAndDelete(id);

    if (wasActive) {
      // Set the next one as active if exists
      const nextSetting = await FacebookSettings.findOne();
      if (nextSetting) {
        nextSetting.isActive = true;
        await nextSetting.save();
      }
    }

    res.json({ success: true, message: "Configuration deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
