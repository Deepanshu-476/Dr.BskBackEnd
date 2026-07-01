const WholesalePartner = require("../models/wholeSale"); // make sure the path is correct
const { logger } = require("../utils/logger");
// const bcrypt = require('bcrypt');
const bcrypt = require("bcryptjs");


// Create a new Wholesale Partnerconst bcrypt = require('bcrypt');

exports.createWholesalePartner = async (req, res) => {
  try {
    const data = {
      ...req.body,
      billingEmail: String(req.body.billingEmail || "").trim().toLowerCase(),
      phone: String(req.body.phone || "").trim()
    };

    const existingPartner = await WholesalePartner.findOne({
      $or: [
        { billingEmail: data.billingEmail },
        ...(data.phone ? [{ phone: data.phone }] : [])
      ]
    });
    if (existingPartner) {
      return res.status(409).json({
        success: false,
        message: "Wholesale partner is already registered"
      });
    }

    // Hash the password before saving
    if (data.password) {
      const saltRounds = 10;
      data.password = await bcrypt.hash(data.password, saltRounds);
    }

    const partner = new WholesalePartner(data);
    await partner.save();

    logger.info("Created new Wholesale Partner", { id: partner._id });
    return res.status(201).json({ success: true, data: partner });
  } catch (error) {
    logger.error("Error creating Wholesale Partner", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
};


exports.getAllWholesalePartners = async (req, res) => {
  try {
    const partners = await WholesalePartner.find();
    logger.info(`Fetched ${partners.length} Wholesale Partners`);
    return res.status(200).json({ success: true, data: partners });
  } catch (error) {
    logger.error("Error fetching all Wholesale Partners", { error: error.message });
    return res.status(500).json({ success: false, error: error.message });
  }
};

// Get a single Wholesale Partner by ID
exports.getWholesalePartnerById = async (id) => {
  try {
    const partner = await WholesalePartner.findById(id);
    if (!partner) {
      logger.warn("Wholesale Partner not found", { id });
      return { success: false, error: 'Wholesale Partner not found' };
    }
    logger.info("Fetched Wholesale Partner by ID", { id });
    return { success: true, data: partner };
  } catch (error) {
    logger.error("Error fetching Wholesale Partner by ID", { id, error: error.message });
    return { success: false, error: error.message };
  }
};

// Update a Wholesale Partner by ID// Update a Wholesale Partner by ID
exports.updateWholesalePartner = async (req, res) => {
  try {
    const { id } = req.params; // Get ID from URL parameters
    const updates = req.body;  // Get update data from request body

    const partner = await WholesalePartner.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true
    });

    if (!partner) {
      logger.warn("Wholesale Partner to update not found", { id });
      return res.status(404).json({ success: false, error: 'Wholesale Partner not found' });
    }

    logger.info("Updated Wholesale Partner", { id });
    return res.status(200).json({ success: true, data: partner });
  } catch (error) {
    logger.error("Error updating Wholesale Partner", { error: error.message, id: req.params.id });
    return res.status(500).json({ success: false, error: error.message });
  }
};


// Delete a Wholesale Partner by ID
exports.deleteWholesalePartner = async (id) => {
  try {
    const result = await WholesalePartner.findByIdAndDelete(id);
    if (!result) {
      logger.warn("Wholesale Partner to delete not found", { id });
      return { success: false, error: 'Wholesale Partner not found' };
    }
    logger.info("Deleted Wholesale Partner", { id });
    return { success: true, message: 'Wholesale Partner deleted successfully' };
  } catch (error) {
    logger.error("Error deleting Wholesale Partner", { id, error: error.message });
    return { success: false, error: error.message };
  }
};
