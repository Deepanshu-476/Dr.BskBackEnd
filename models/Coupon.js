const mongoose = require('mongoose');
const { generateBskId } = require("../utils/bskIds");

const couponSchema = new mongoose.Schema({
  publicId: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    default: () => generateBskId("CPN")
  },
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  type: {
    type: String,
    enum: ['percentage', 'fixed'],
    required: true
  },
  value: {
    type: Number,
    required: true,
    min: 0
  },
  minPurchase: {
    type: Number,
    default: 0,
    min: 0
  },
  maxDiscount: {
    type: Number,
    min: 0
  },
  validFrom: {
    type: Date,
    required: true
  },
  validTo: {
    type: Date,
    required: true
  },
  usageLimit: {
    type: Number,
    min: 1
  },
  usageCount: {
    type: Number,
    default: 0,
    min: 0
  },
  applicableProducts: {
    type: String,
    enum: ['all', 'specific'],
    default: 'all'
  },
  selectedProducts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  }],
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
couponSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Method to check if coupon is valid
couponSchema.methods.isValid = function() {
  const now = new Date();
  return (
    this.status === 'active' &&
    this.validFrom <= now &&
    this.validTo >= now &&
    (!this.usageLimit || this.usageCount < this.usageLimit)
  );
};

// Method to calculate discount
couponSchema.methods.calculateDiscount = function(originalPrice) {
  let discountAmount = 0;
  
  if (this.type === 'percentage') {
    discountAmount = (originalPrice * this.value) / 100;
    if (this.maxDiscount) {
      discountAmount = Math.min(discountAmount, this.maxDiscount);
    }
  } else {
    discountAmount = this.value;
  }
  
  return Math.min(discountAmount, originalPrice);
};

module.exports = mongoose.model('Coupon', couponSchema);
