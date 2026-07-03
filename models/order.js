const mongoose = require('mongoose');
const { generateBskId } = require("../utils/bskIds");

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    default: () => generateBskId("O")
  },
  // userId can be ObjectId for registered users OR string for guest users
  userId: {
    type: mongoose.Schema.Types.Mixed, // Changed from ObjectId to Mixed
    required: true
  },
  userEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  userName: {
    type: String,
    required: true,
    trim: true
  },
  email: { // Add email field for better tracking
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  items: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Product'
      },
      name: {
        type: String,
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: 1
      },
      price: {
        type: Number,
        required: true,
        min: 0
      },
      // Add media field to store product images
      media: [{
        url: String,
        type: {
          type: String,
          enum: ['image', 'video']
        }
      }],
      category: String,
      description: String
    }
  ],
  address: {
    type: String,
    required: true,
    trim: true
  },
  shippingAddress: {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipcode: { type: String, trim: true },
    country: { type: String, trim: true, default: 'India' }
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  
  // COD specific fields
  baseAmount: {
    type: Number,
    default: 0
  },
  codCharge: {
    type: Number,
    default: 0
  },

  // Guest user flag
  isGuest: {
    type: Boolean,
    default: false
  },

  // Payment method
  paymentMethod: {
    type: String,
    enum: ['online', 'cod'],
    default: 'online'
  },

  // Razorpay integration
  razorpayOrderId: {
    type: String,
    unique: true,
    sparse: true
  },

  // Payment information
  paymentInfo: {
    paymentId: { type: String, default: null },
    amount: { type: Number, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'created', 'authorized', 'captured', 'failed', 'refunded', 'cod'],
      default: 'created'
    },
    displayStatus: { type: String, default: null }, // ✅ ADD THIS LINE - For frontend display
    method: { type: String, default: null },
    capturedAt: { type: Date },
    failedAt: { type: Date },
    updatedAt: { type: Date, default: Date.now }
  },

  // Refund information
  refundInfo: {
    refundId: { type: String, default: null },
    amount: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ['none', 'initiated', 'processed', 'failed'],
      default: 'none'
    },
    reason: { type: String, trim: true },
    initiatedAt: { type: Date },
    processedAt: { type: Date },
    failedAt: { type: Date },
    estimatedSettlement: { type: Date },
    speed: {
      type: String,
      enum: ['normal', 'optimum'],
      default: 'optimum'
    }
  },

  // Order status
  status: {
    type: String,
    enum: ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Refunded'],
    default: 'Pending'
  },

  // Cancellation details
  cancelReason: { type: String, trim: true },
  cancelledBy: {
    type: String,
    enum: ['admin', 'user', 'system']
  },
  cancelledAt: { type: Date },

  // Delivery tracking
  trackingNumber: { type: String, default: null },
  courierName: { type: String, default: null },
  shippingInfo: {
    provider: { type: String, default: null },
    status: {
      type: String,
      enum: ['not_created', 'created', 'failed'],
      default: 'not_created'
    },
    awb: { type: String, default: null },
    pickupId: { type: String, default: null },
    pickupError: { type: String, default: null },
    error: { type: String, default: null },
    createdAt: { type: Date },
    lastAttemptAt: { type: Date }
  },
  expectedDelivery: { type: Date },
  deliveredAt: { type: Date },

  // Email status
  emailSent: { type: Boolean, default: false },
  emailSentAt: { type: Date },
  emailError: { type: String }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ 'paymentInfo.paymentId': 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ userEmail: 1 });
orderSchema.index({ email: 1 });
orderSchema.index({ isGuest: 1 });
orderSchema.index({ createdAt: -1 });
orderSchema.index({ 'paymentInfo.status': 1 });
orderSchema.index({ paymentMethod: 1 });

// Virtual for payment status display
orderSchema.virtual('paymentStatusDisplay').get(function () {
  // Check if displayStatus is set (from admin manual update)
  if (this.paymentInfo?.displayStatus) {
    return this.paymentInfo.displayStatus;
  }
  
  const status = this.paymentInfo?.status || 'created';
  switch (status) {
    case 'captured': return 'Paid';
    case 'cod': return 'COD';
    case 'authorized': return 'Authorized (Pending Capture)';
    case 'failed': return 'Payment Failed';
    case 'pending': return 'Payment Pending';
    case 'created': return 'Payment Initiated';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
});

// Virtual for refund status display
orderSchema.virtual('refundStatusDisplay').get(function () {
  const status = this.refundInfo?.status || 'none';
  switch (status) {
    case 'none': return 'No Refund';
    case 'initiated': return 'Refund Initiated';
    case 'processed': return 'Refund Processed';
    case 'failed': return 'Refund Failed';
    default: return status.charAt(0).toUpperCase() + status.slice(1);
  }
});

// Virtual for estimated settlement display
orderSchema.virtual('estimatedSettlementDisplay').get(function () {
  if (!this.refundInfo?.estimatedSettlement) return null;

  const now = new Date();
  const settlement = new Date(this.refundInfo.estimatedSettlement);
  const diffTime = settlement - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays <= 0) return 'Should be settled by now';
  if (diffDays === 1) return 'Expected by tomorrow';
  return `Expected in ${diffDays} days`;
});

// Virtual to check if user is guest
orderSchema.virtual('isGuestUser').get(function () {
  return this.isGuest || (typeof this.userId === 'string' && this.userId.startsWith('guest_'));
});

// Virtual to get user type
orderSchema.virtual('userType').get(function () {
  if (this.isGuest || (typeof this.userId === 'string' && this.userId.startsWith('guest_'))) {
    return 'Guest';
  }
  return 'Registered';
});

// Virtual to get payment status for frontend
orderSchema.virtual('frontendPaymentStatus').get(function () {
  if (this.paymentMethod === 'cod') {
    return 'COD';
  }
  
  if (this.paymentInfo?.displayStatus) {
    return this.paymentInfo.displayStatus;
  }
  
  const status = this.paymentInfo?.status;
  if (status === 'captured') return 'Paid';
  if (status === 'pending') return 'Pending';
  if (status === 'authorized') return 'Authorized';
  if (status === 'failed') return 'Failed';
  
  return 'Pending';
});

// Pre-save validation and status management
orderSchema.pre('save', function (next) {
  if (!this.orderId) {
    this.orderId = generateBskId("O");
  }

  // Auto-detect guest user
  if (typeof this.userId === 'string' && this.userId.startsWith('guest_')) {
    this.isGuest = true;
  }

  // Calculate items total
  const itemsTotal = this.items.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0);

  // For COD orders: itemsTotal + codCharge should equal totalAmount
  // For non-COD orders: itemsTotal should equal totalAmount
  if (this.paymentMethod === 'cod') {
    // Set baseAmount if not set
    if (!this.baseAmount || this.baseAmount === 0) {
      this.baseAmount = itemsTotal;
    }
    
    // Set codCharge if not set
    if (!this.codCharge || this.codCharge === 0) {
      this.codCharge = this.totalAmount - itemsTotal;
    }
    
    // Set paymentInfo displayStatus for COD
    if (this.paymentInfo && !this.paymentInfo.displayStatus) {
      this.paymentInfo.displayStatus = 'COD';
    }
    if (this.paymentInfo && (!this.paymentInfo.status || this.paymentInfo.status === 'created')) {
      this.paymentInfo.status = 'cod';
    }
    
    const expectedTotal = itemsTotal + (this.codCharge || 0);
    
    // Log for debugging
    console.log("COD Order validation:", {
      itemsTotal: itemsTotal,
      baseAmount: this.baseAmount,
      codCharge: this.codCharge,
      totalAmount: this.totalAmount,
      expectedTotal: expectedTotal,
      difference: Math.abs(this.totalAmount - expectedTotal)
    });
    
    // Allow small rounding differences
    if (Math.abs(this.totalAmount - expectedTotal) > 1) {
      console.warn(`COD total amount mismatch: items=${itemsTotal}, cod=${this.codCharge}, expected=${expectedTotal}, got=${this.totalAmount}`);
      // Don't throw error for COD orders, just log warning
    }
  } else {
    // For non-COD orders, validate strictly
    if (Math.abs(this.totalAmount - itemsTotal) > 0.01) {
      return next(new Error(`Total amount mismatch: expected ${itemsTotal}, got ${this.totalAmount}`));
    }
    
    // Set paymentInfo displayStatus for online orders
    if (this.paymentInfo && !this.paymentInfo.displayStatus) {
      if (this.paymentInfo.status === 'captured') {
        this.paymentInfo.displayStatus = 'Paid';
      } else if (this.paymentInfo.status === 'pending') {
        this.paymentInfo.displayStatus = 'Pending';
      } else if (this.paymentInfo.status === 'authorized') {
        this.paymentInfo.displayStatus = 'Authorized';
      } else if (this.paymentInfo.status === 'failed') {
        this.paymentInfo.displayStatus = 'Failed';
      }
    }
  }

  // Handle status changes
  if (this.isModified('status')) {
    const now = new Date();
    
    if (this.status === 'Cancelled' && !this.cancelledAt) {
      this.cancelledAt = now;
      if (!this.cancelledBy) this.cancelledBy = 'user';
    }
    
    if (this.status === 'Delivered' && !this.deliveredAt) {
      this.deliveredAt = now;
    }
  }

  // Update payment timestamps
  if (this.isModified('paymentInfo.status')) {
    const now = new Date();
    const paymentStatus = this.paymentInfo.status;
    
    if (paymentStatus === 'captured' && !this.paymentInfo.capturedAt) {
      this.paymentInfo.capturedAt = now;
      // Auto update order status to Confirmed when payment is captured
      if (this.status === 'Pending') {
        this.status = 'Confirmed';
      }
      // Set displayStatus
      this.paymentInfo.displayStatus = 'Paid';
    } else if (paymentStatus === 'failed' && !this.paymentInfo.failedAt) {
      this.paymentInfo.failedAt = now;
      this.paymentInfo.displayStatus = 'Failed';
    } else if (paymentStatus === 'cod') {
      this.paymentInfo.displayStatus = 'COD';
    }
    this.paymentInfo.updatedAt = now;
  }

  // Update refund timestamps
  if (this.isModified('refundInfo.status')) {
    const now = new Date();
    const refundStatus = this.refundInfo.status;
    
    if (refundStatus === 'initiated' && !this.refundInfo.initiatedAt) {
      this.refundInfo.initiatedAt = now;
    } else if (refundStatus === 'processed' && !this.refundInfo.processedAt) {
      this.refundInfo.processedAt = now;
    } else if (refundStatus === 'failed' && !this.refundInfo.failedAt) {
      this.refundInfo.failedAt = now;
    }
  }

  next();
});

// Pre-validate to ensure either ObjectId or guest string
orderSchema.pre('validate', function (next) {
  // Check if userId is valid
  if (!this.userId) {
    return next(new Error('userId is required'));
  }

  // Check if it's a valid ObjectId or guest string
  if (typeof this.userId === 'string') {
    if (this.userId.startsWith('guest_')) {
      // Valid guest ID
      next();
    } else if (mongoose.Types.ObjectId.isValid(this.userId)) {
      // Valid ObjectId string
      this.userId = new mongoose.Types.ObjectId(this.userId);
      next();
    } else {
      return next(new Error('Invalid userId format'));
    }
  } else if (this.userId instanceof mongoose.Types.ObjectId) {
    // Valid ObjectId
    next();
  } else {
    return next(new Error('userId must be either ObjectId or guest string'));
  }
});

// Static methods
orderSchema.statics.findPaymentIssues = function () {
  return this.find({
    $or: [
      { 'paymentInfo.status': 'failed' },
      { 'paymentInfo.status': 'authorized', createdAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
    ]
  });
};

orderSchema.statics.findPendingRefunds = function () {
  return this.find({
    status: 'Cancelled',
    'paymentInfo.status': 'captured',
    'refundInfo.status': { $in: ['none', 'initiated'] }
  });
};

orderSchema.statics.findGuestOrders = function () {
  return this.find({
    $or: [
      { isGuest: true },
      { userId: /^guest_/ }
    ]
  });
};

orderSchema.statics.findByEmail = function (email) {
  return this.find({
    $or: [
      { email: email },
      { userEmail: email }
    ]
  }).sort({ createdAt: -1 });
};

orderSchema.statics.findCODOrders = function () {
  return this.find({
    paymentMethod: 'cod'
  }).sort({ createdAt: -1 });
};

// Instance method to check if user can modify order
orderSchema.methods.canModify = function (userId) {
  if (this.isGuest) {
    return this.userId === userId;
  }
  return this.userId.toString() === userId.toString();
};

// Instance method to get order summary
orderSchema.methods.getSummary = function () {
  return {
    orderId: this.orderId,
    internalId: this._id,
    totalAmount: this.totalAmount,
    status: this.status,
    paymentStatus: this.paymentInfo.status,
    paymentDisplayStatus: this.frontendPaymentStatus,
    paymentMethod: this.paymentMethod,
    itemsCount: this.items.length,
    createdAt: this.createdAt,
    userType: this.userType,
    email: this.email,
    isCOD: this.paymentMethod === 'cod',
    codCharge: this.codCharge || 0
  };
};

// Instance method to calculate COD total
orderSchema.methods.calculateCODTotal = function () {
  const itemsTotal = this.items.reduce((total, item) => {
    return total + (item.price * item.quantity);
  }, 0);
  
  return {
    itemsTotal: itemsTotal,
    codCharge: this.codCharge || 0,
    total: itemsTotal + (this.codCharge || 0)
  };
};

module.exports = mongoose.model('Order', orderSchema);
