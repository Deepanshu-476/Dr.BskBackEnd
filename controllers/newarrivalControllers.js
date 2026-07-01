const NewArrivalProduct = require("../models/newarrival");
const { logger } = require("../utils/logger");
const {
  applyProductPricing,
  resolvePricingTier,
} = require("../utils/productPricing");

// Create a new newArrivalProduct
exports.createNewArrivalProduct = async (req, res) => {
  try {
    const newArrivalProduct = new NewArrivalProduct(req.body);
    const savedProduct = await newArrivalProduct.save();
    logger.info(`New Arrival Product created: ${savedProduct._id}`);
    res.status(201).json(savedProduct);
  } catch (error) {
    logger.error("Error creating New Arrival Product:", error);
    res.status(400).json({ message: error.message });
  }
};

// Get all newArrivalProducts
exports.getAllNewArrivalProducts = async (req, res) => {
  try {
    const pricingTier = await resolvePricingTier(req.user);
    const products = await NewArrivalProduct.find({ deleted_at: null })
      .populate("category")
      .populate("sub_category");

    logger.info(`Fetched ${products.length} new arrival products`);
    res.status(200).json(
      products.map((product) => applyProductPricing(product, pricingTier))
    );
  } catch (error) {
    logger.error("Error fetching all New Arrival Products:", error);
    res.status(500).json({ message: error.message });
  }
};

// Get a single newArrivalProduct by ID
exports.getNewArrivalProductById = async (req, res) => {
  try {
    const pricingTier = await resolvePricingTier(req.user);
    const product = await NewArrivalProduct.findOne({
      _id: req.params.id,
      deleted_at: null,
    })
      .populate("category")
      .populate("sub_category");

    if (!product) {
      logger.warn(`New Arrival Product not found with ID: ${req.params.id}`);
      return res.status(404).json({ message: "Product not found" });
    }

    logger.info(`New Arrival Product retrieved: ${product._id}`);
    res.status(200).json(applyProductPricing(product, pricingTier));
  } catch (error) {
    logger.error(`Error fetching New Arrival Product by ID (${req.params.id}):`, error);
    res.status(500).json({ message: error.message });
  }
};

// Update a newArrivalProduct
exports.updateNewArrivalProduct = async (req, res) => {
  try {
    const updatedProduct = await NewArrivalProduct.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );

    if (!updatedProduct) {
      logger.warn(`New Arrival Product not found for update: ${req.params.id}`);
      return res.status(404).json({ message: "Product not found" });
    }

    logger.info(`New Arrival Product updated: ${updatedProduct._id}`);
    res.status(200).json(updatedProduct);
  } catch (error) {
    logger.error(`Error updating New Arrival Product (${req.params.id}):`, error);
    res.status(400).json({ message: error.message });
  }
};

// Soft delete a newArrivalProduct
exports.deleteNewArrivalProduct = async (req, res) => {
  try {
    const deletedProduct = await NewArrivalProduct.findByIdAndUpdate(
      req.params.id,
      { deleted_at: new Date() },
      { new: true }
    );

    if (!deletedProduct) {
      logger.warn(`New Arrival Product not found for deletion: ${req.params.id}`);
      return res.status(404).json({ message: "Product not found" });
    }

    logger.info(`New Arrival Product soft-deleted: ${deletedProduct._id}`);
    res.status(200).json({ message: "Product deleted successfully" });
  } catch (error) {
    logger.error(`Error deleting New Arrival Product (${req.params.id}):`, error);
    res.status(500).json({ message: error.message });
  }
};
