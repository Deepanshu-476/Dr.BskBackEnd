const express = require('express');
const router = express.Router();
const Order = require('../models/order');
const Admin = require('../models/admin');
const Product = require('../models/product');
const WholesalePartner = require('../models/wholeSale');
const { optionalToken } = require('../middlewares/authMiddlewares');
const {
  applyProductPricing,
  resolvePricingTier,
} = require('../utils/productPricing');
const { logger } = require("../utils/logger");
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { getEmailLocalPart, isUsefulCustomerName, pickCustomerName } = require('../utils/customerName');
const { createShipmentAndPickup } = require('../services/delhiveryService');

const EmailSettings = require('../models/EmailSettings');
const PaymentSettings = require('../models/PaymentSettings');

// Helper to get the correct Razorpay instance dynamically from settings
const getRazorpay = async () => {
  try {
    let settings = await PaymentSettings.findOne();
    if (!settings) {
      settings = await PaymentSettings.create({});
    }

    const keyId = settings.razorpayKeyId || process.env.RAZORPAY_KEY_ID;
    const keySecret = settings.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.warn("⚠️ Razorpay credentials not configured in settings or environment!");
    }

    const instance = new Razorpay({
      key_id: keyId || 'placeholder_id',
      key_secret: keySecret || 'placeholder_secret',
    });

    return { instance, keyId, keySecret, settings };
  } catch (error) {
    console.error("Error creating dynamic Razorpay instance:", error);
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID || 'placeholder_id',
      key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
    });
    return {
      instance,
      keyId: process.env.RAZORPAY_KEY_ID || 'placeholder_id',
      keySecret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
      settings: null
    };
  }
};

// Helper to get dynamic transporter and settings
const getDynamicTransporter = async () => {
  try {
    let settings = await EmailSettings.findOne();
    if (!settings) {
      settings = await EmailSettings.create({});
    }
    
    const smtpUser = settings.senderEmail || process.env.SMTP_USER || 'drbskhealthcare@gmail.com';
    const smtpPass = settings.senderPassword || process.env.SMTP_PASS || 'yxnykcgxwtslcdtl';
    
    console.log("Creating dynamic transporter with email:", smtpUser);
    
    const dynamicTransporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: smtpUser,
        pass: smtpPass
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    
    return { transporter: dynamicTransporter, settings };
  } catch (error) {
    console.error("Error creating dynamic transporter, falling back to env:", error);
    const fallbackTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    return { 
      transporter: fallbackTransporter, 
      settings: { 
        senderEmail: process.env.SMTP_USER, 
        ownerEmail: 'himanshujangra0633@gmail.com' 
      } 
    };
  }
};

// Function to send order confirmation email dynamically
const sendOrderConfirmationEmailDynamic = async (order, userEmail, userName, newUserDetails = null) => {
  try {
    const { transporter: dynamicTransporter, settings } = await getDynamicTransporter();
    const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;
    const senderEmail = settings.senderEmail || 'drbskhealthcare@gmail.com';
    const ownerEmail = settings.ownerEmail || 'himanshujangra0633@gmail.com';

    let accountSectionText = '';
    if (newUserDetails && newUserDetails.isNew) {
      accountSectionText = `
YOUR ACCOUNT HAS BEEN CREATED!
We have automatically created an account for you using the email you provided at checkout.
Username/Email: ${userEmail}
Password: ${newUserDetails.password}
You can log in and check your order details. We recommend changing your password after logging in.
----------------------------------------
      `;
    } else {
      accountSectionText = `
ACCOUNT DETAILS
Your order is linked to your account: ${userEmail}.
You can log in to check order status and history.
----------------------------------------
      `;
    }

    const mailOptions = {
      from: {
        name: process.env.STORE_NAME || 'Dr BSK Healthcare',
        address: senderEmail
      },
      to: userEmail,
      subject: `Order Confirmation #${displayOrderId} - ${process.env.STORE_NAME || 'Dr BSK Healthcare'}`,
      html: generateOrderEmailTemplate(order, { email: userEmail, name: userName }, newUserDetails),
      text: `
Order Confirmation #${displayOrderId}

Dear ${userName || 'Customer'},

Thank you for your order! We have received your order and it is being processed.

${accountSectionText}

ORDER DETAILS:
Order ID: ${displayOrderId}
Order Date: ${new Date(order.createdAt).toLocaleString()}
Status: ${order.status}
Total Amount: ₹${parseFloat(order.totalAmount).toFixed(2)}

SHIPPING ADDRESS:
${userName || 'Customer'}
${order.address}
Phone: ${order.phone}
Email: ${userEmail}

ORDER ITEMS:
${order.items.map(item => `- ${item.name} x ${item.quantity}: ₹${parseFloat(item.price).toFixed(2)} each`).join('\n')}

Total: ₹${parseFloat(order.totalAmount).toFixed(2)}

Thank you for shopping with us!

Best regards,
${process.env.STORE_NAME || 'Dr BSK Healthcare Team'}
      `
    };

    console.log(`Sending order confirmation email to customer: ${userEmail}`);
    const info = await dynamicTransporter.sendMail(mailOptions);
    console.log(`✅ Order confirmation email sent to customer: ${info.messageId}`);

    // Send order notification email to owner
    try {
      console.log(`Sending order notification email to owner: ${ownerEmail}`);
      const ownerMailOptions = {
        from: {
          name: 'Dr BSK System Alert',
          address: senderEmail
        },
        to: ownerEmail,
        subject: `New Order Alert: #${displayOrderId}`,
        html: (() => {
          const { getOwnerOrderTemplate } = require('../utils/emailTemplates');
          return getOwnerOrderTemplate(order, { email: userEmail, name: userName });
        })(),
        text: `
NEW ORDER ALERT: #${displayOrderId}

Customer Name: ${userName || 'Customer'}
Customer Email: ${userEmail}
Customer Phone: ${order.phone}
Shipping Address: ${order.address}
Payment Method: ${order.paymentMethod}

Order Items:
${order.items.map(item => `- ${item.name} x ${item.quantity}: ₹${parseFloat(item.price).toFixed(2)} each`).join('\n')}

Total Amount: ₹${parseFloat(order.totalAmount).toFixed(2)}
        `
      };
      const ownerInfo = await dynamicTransporter.sendMail(ownerMailOptions);
      console.log(`✅ Order notification email sent to owner: ${ownerInfo.messageId}`);
    } catch (ownerError) {
      console.error('❌ Error sending order notification to owner:', ownerError);
    }
    
    return {
      success: true,
      messageId: info.messageId,
      email: userEmail
    };
  } catch (error) {
    console.error('❌ Error sending order confirmation email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
// Function to send order status update email dynamically
const sendStatusUpdateEmail = async (order, userEmail, userName) => {
  try {
    const { transporter: dynamicTransporter, settings } = await getDynamicTransporter();
    const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;
    const senderEmail = settings.senderEmail || 'drbskhealthcare@gmail.com';

    let statusText = '';
    let statusDescription = '';
    let statusColor = '#3b82f6'; // blue

    switch (order.status) {
      case 'Confirmed':
        statusText = 'Confirmed';
        statusDescription = 'Your order has been confirmed by our team and is ready for packaging.';
        statusColor = '#10b981'; // green
        break;
      case 'Processing':
        statusText = 'Processing';
        statusDescription = 'Our pharmacists are processing your healthcare products and packaging them securely.';
        statusColor = '#f59e0b'; // orange
        break;
      case 'Shipped':
        statusText = 'Shipped';
        statusDescription = 'Your package is on its way! We have dispatched it with our shipping partner.';
        statusColor = '#8b5cf6'; // purple
        break;
      case 'Delivered':
        statusText = 'Delivered';
        statusDescription = 'Hooray! Your order has been delivered. Thank you for choosing Dr BSK Healthcare!';
        statusColor = '#10b981'; // green
        break;
      case 'Cancelled':
        statusText = 'Cancelled';
        statusDescription = `Your order has been cancelled. Reason: ${order.cancelReason || 'Cancelled by admin'}.`;
        statusColor = '#ef4444'; // red
        break;
      default:
        statusText = order.status;
        statusDescription = `Your order status is updated to ${order.status}.`;
        statusColor = '#3b82f6';
    }

    const mailOptions = {
      from: {
        name: process.env.STORE_NAME || 'Dr BSK Healthcare',
        address: senderEmail
      },
      to: userEmail,
      subject: `Order Status Update #${displayOrderId}: ${statusText} - Dr BSK Healthcare`,
      html: (() => {
        const { getStatusUpdateTemplate } = require('../utils/emailTemplates');
        return getStatusUpdateTemplate(order, { email: userEmail, name: userName }, statusText, statusDescription, statusColor);
      })(),
      text: `
Order Status Update: ${statusText}

Dear ${userName || 'Customer'},

The status of your order #${displayOrderId} has been updated to: ${statusText}.

${statusDescription}

ORDER DETAILS:
Order ID: ${displayOrderId}
Payment Method: ${order.paymentMethod || 'Online'}
Total Amount: ₹${parseFloat(order.totalAmount).toFixed(2)}

Thank you for choosing Dr BSK Healthcare!
      `
    };

    console.log(`Sending order status update email to: ${userEmail}`);
    const info = await dynamicTransporter.sendMail(mailOptions);
    console.log(`%. Order status update email sent to customer: ${info.messageId}`);
    return { success: true };
  } catch (error) {
    console.error('❌ Error sending order status update email:', error);
    return { success: false, error: error.message };
  }
};



const createDelhiveryShipmentForOrder = async (order) => {
  try {
    const delivery = await createShipmentAndPickup(order);
    if (delivery.skipped) return order;

    order.trackingNumber = delivery.waybill;
    order.courierName = 'Delhivery';
    order.shippingInfo = {
      provider: 'Delhivery',
      status: 'created',
      awb: delivery.waybill,
      pickupId: delivery.pickupId,
      pickupError: delivery.pickupError,
      error: null,
      createdAt: new Date(),
      lastAttemptAt: new Date()
    };
    await order.save();
    console.log(`Delhivery shipment created. AWB: ${delivery.waybill}`);
  } catch (error) {
    const message = error.response?.data?.error ||
      error.response?.data?.detail ||
      error.message ||
      'Delhivery shipment creation failed';
    console.error('Delhivery shipment creation failed:', message);
    order.shippingInfo = {
      provider: 'Delhivery',
      status: 'failed',
      error: String(message).slice(0, 500),
      lastAttemptAt: new Date()
    };
    await order.save();
  }
  return order;
};

// Debug middleware
router.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', JSON.stringify(req.body, null, 2));
  }
  next();
});

// Validate environment variables (warn only since settings can be in database)
if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn("⚠️ Razorpay credentials not found in environment variables. Ensure they are configured in the Admin settings dashboard.");
} else {
  console.log("✅ Fallback Razorpay credentials loaded from env:", {
    keyId: `${process.env.RAZORPAY_KEY_ID.substring(0, 10)}...`
  });
}

// Initialize fallback Razorpay instance
let razorpayInstance;
try {
  razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'placeholder_id',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'placeholder_secret',
  });
  console.log("✅ Fallback Razorpay instance created successfully");
} catch (initError) {
  console.error("❌ Failed to initialize fallback Razorpay:", initError.message);
}

const parseProductVariants = (raw) => {
  try {
    let value = raw;
    if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
      value = JSON.parse(value[0]);
    } else if (typeof value === 'string') {
      value = JSON.parse(value);
    }
    if (Array.isArray(value) && Array.isArray(value[0])) value = value.flat();
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
};

const toPositivePaise = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0;
};

const firstPositivePaise = (...values) => {
  for (const value of values) {
    const paise = toPositivePaise(value);
    if (paise) return paise;
  }
  return 0;
};

const resolveMagicPricingTier = async (userId, requestedTier) => {
  if (requestedTier !== 'wholesale' || !/^[a-f\d]{24}$/i.test(String(userId || ''))) {
    return 'consumer';
  }

  const partner = await WholesalePartner.findOne({
    _id: userId,
    status: { $regex: /^(approved|active)$/i }
  }).select('_id').lean();
  return partner ? 'wholesale' : 'consumer';
};

const buildCanonicalMagicCart = async (requestedItems, userId, requestedTier) => {
  if (!Array.isArray(requestedItems) || requestedItems.length === 0 || requestedItems.length > 50) {
    throw new Error('A valid cart is required');
  }

  const pricingTier = await resolveMagicPricingTier(userId, requestedTier);
  const ids = [...new Set(requestedItems.map(item => String(item?.productId || '')))];
  if (ids.some(id => !/^[a-f\d]{24}$/i.test(id))) {
    throw new Error('Cart contains an invalid product');
  }

  const products = await Product.find({
    _id: { $in: ids },
    deleted_at: null
  }).lean();
  const byId = new Map(products.map(product => [String(product._id), product]));

  const items = requestedItems.map((requestedItem) => {
    const product = byId.get(String(requestedItem.productId));
    if (!product) throw new Error('A product in your cart is no longer available');

    const quantity = Number.parseInt(requestedItem.quantity, 10);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new Error(`Invalid quantity for ${product.name || 'product'}`);
    }

    const variants = parseProductVariants(product.quantity);
    const requestedVariant = String(requestedItem.variant || requestedItem.variantId || '').trim();
    const variant = variants.find(candidate =>
      [candidate?._id, candidate?.label].some(value =>
        value !== undefined && String(value).trim() === requestedVariant
      )
    ) || (requestedVariant === 'Standard Pack' || !requestedVariant ? variants[0] : null);

    if (variants.length > 0 && !variant) {
      throw new Error(`Selected variant for ${product.name} is no longer available`);
    }
    const inStock = variant
      ? (typeof variant.in_stock === 'string'
        ? variant.in_stock.toLowerCase() === 'yes'
        : variant.in_stock !== false)
      : String(product.stock || '').toLowerCase() !== 'out of stock';
    if (!inStock) throw new Error(`${product.name} is out of stock`);

    const pricePaise = pricingTier === 'wholesale'
      ? firstPositivePaise(variant?.retail_price, product.retail_price)
      : firstPositivePaise(
          variant?.final_price,
          product.consumer_price,
          variant?.retail_price,
          product.retail_price
        );
    if (!pricePaise) throw new Error(`Price is not configured for ${product.name}`);

    const mrpPaise = Math.max(
      pricePaise,
      firstPositivePaise(variant?.mrp, product.mrp) || pricePaise
    );
    const imageUrl = getRazorpayImageUrl(product.media?.[0]?.url);

    return {
      productId: String(product._id),
      name: String(product.name || '').trim(),
      quantity,
      price: pricePaise / 100,
      mrp: mrpPaise / 100,
      variant: String(variant?.label || requestedVariant || 'Standard Pack'),
      description: String(product.description || product.name || '').trim().slice(0, 256),
      ...(imageUrl ? { imageUrl } : {})
    };
  });

  return {
    items,
    pricingTier,
    amountInPaise: items.reduce(
      (total, item) => total + Math.round(item.price * 100) * item.quantity,
      0
    )
  };
};

const createMagicCheckoutToken = (payload) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
};

const verifyMagicCheckoutToken = (token) => {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) throw new Error('Invalid checkout token');
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(encoded)
    .digest();
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw new Error('Invalid checkout token');
  }
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload?.orderId || !Array.isArray(payload.items) || !payload.expiresAt) {
    throw new Error('Invalid checkout token');
  }
  if (Date.now() > payload.expiresAt) throw new Error('Checkout session has expired');
  return payload;
};

// Email transporter setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

const enrichOrderCustomerNames = async (orders) => {
  const userIds = [
    ...new Set(
      orders
        .map(order => order.userId)
        .filter(userId => typeof userId === 'string' && !userId.startsWith('guest_') && /^[a-f\d]{24}$/i.test(userId))
    )
  ];

  const emails = [
    ...new Set(
      orders
        .map(order => (order.userEmail || order.email || '').toLowerCase())
        .filter(Boolean)
    )
  ];

  const [usersById, usersByEmail] = await Promise.all([
    userIds.length ? Admin.find({ _id: { $in: userIds } }).select('name email').lean() : [],
    emails.length ? Admin.find({ email: { $in: emails } }).select('name email').lean() : []
  ]);

  const byId = new Map(usersById.map(user => [String(user._id), user]));
  const byEmail = new Map(usersByEmail.map(user => [String(user.email || '').toLowerCase(), user]));

  return orders.map(order => {
    const email = order.userEmail || order.email || '';
    const emailKey = String(email).toLowerCase();
    const idProfile = byId.get(String(order.userId));
    const emailProfile = byEmail.get(emailKey);
    const profile =
      emailProfile ||
      (String(idProfile?.email || '').toLowerCase() === emailKey ? idProfile : null);
    const profileName = profile?.name;
    if (isUsefulCustomerName(profileName, email) && !isUsefulCustomerName(order.userName, email)) {
      return { ...order, userName: profileName };
    }
    if (!isUsefulCustomerName(order.userName, email)) {
      return { ...order, userName: getEmailLocalPart(email) || 'Customer' };
    }
    return order;
  });
};

// Email template function
const generateOrderEmailTemplate = (order, user, newUserDetails = null) => {
  const { getCustomerOrderTemplate } = require('../utils/emailTemplates');
  return getCustomerOrderTemplate(order, user, newUserDetails);
};

// Function to send order confirmation email
const sendOrderConfirmationEmail = async (order, userEmail, userName) => {
  try {
    const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;
    const mailOptions = {
      from: {
        name: process.env.STORE_NAME || 'Your Store',
        address: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@yourstore.com'
      },
      to: userEmail,
      subject: `Order Confirmation #${displayOrderId} - ${process.env.STORE_NAME || 'Your Store'}`,
      html: generateOrderEmailTemplate(order, { email: userEmail, name: userName }),
      text: `
Order Confirmation #${displayOrderId}

Dear ${userName || 'Customer'},

Thank you for your order! We have received your order and it is being processed.

ORDER DETAILS:
Order ID: ${displayOrderId}
Order Date: ${new Date(order.createdAt).toLocaleString()}
Status: ${order.status}
Total Amount: ₹${order.totalAmount.toFixed(2)}

SHIPPING ADDRESS:
${userName || 'Customer'}
${order.address}
Phone: ${order.phone}
Email: ${userEmail}

ORDER ITEMS:
${order.items.map(item => `- ${item.name} x ${item.quantity}: ₹${item.price.toFixed(2)} each`).join('\n')}

Total: ₹${order.totalAmount.toFixed(2)}

Your order will be shipped soon. You will receive another email with tracking information once your order is dispatched.

For any questions, please contact our customer support.

Thank you for shopping with us!

Best regards,
${process.env.STORE_NAME || 'Your Store Team'}
${process.env.STORE_URL || 'https://yourstore.com'}
      `
    };

    console.log(`Sending order confirmation email to: ${userEmail}`);
    
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Order confirmation email sent: ${info.messageId}`);
    
    return {
      success: true,
      messageId: info.messageId,
      email: userEmail
    };
  } catch (error) {
    console.error('❌ Error sending order confirmation email:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Helper function to process media URLs
const processMediaUrl = (url) => {
  if (!url) return '';
  
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  
  const cleanUrl = url.startsWith('/') ? url.substring(1) : url;
  const baseUrl = "https://drbskhealthcare.com";
  const baseWithoutTrailingSlash = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  
  return `${baseWithoutTrailingSlash}/${cleanUrl}`;
};

const getRazorpayImageUrl = (url) => {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return '';

  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
      if (!publicBaseUrl || !publicBaseUrl.startsWith('https://')) return '';

      return encodeURI(
        `${publicBaseUrl.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
      );
    }

    return url.startsWith('https://') ? encodeURI(url.trim()) : '';
  } catch (_) {
    return '';
  }
};

// ==================== MONTHLY ORDER TOTALS API - NEW ====================
// Get monthly order totals for revenue chart
router.get('/monthly-order-totals', async (req, res) => {
  console.log("=== FETCHING MONTHLY ORDER TOTALS ===");
  console.log("Timestamp:", new Date().toISOString());
  
  try {
    // Aggregate orders by month
    const monthlyTotals = await Order.aggregate([
      {
        $match: {
          // Sirf confirmed/completed orders count karo
          $or: [
            { status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered'] } },
            { 'paymentInfo.status': 'captured' },
            { 
              $and: [
                { paymentMethod: 'cod' },
                { status: { $ne: 'Cancelled' } } // COD orders jo cancel nahi hue
              ]
            }
          ]
        }
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          totalRevenue: { $sum: "$totalAmount" },
          orderCount: { $sum: 1 },
          codOrders: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "cod"] }, 1, 0]
            }
          },
          onlineOrders: {
            $sum: {
              $cond: [{ $eq: ["$paymentMethod", "online"] }, 1, 0]
            }
          },
          cancelledOrders: {
            $sum: {
              $cond: [{ $eq: ["$status", "Cancelled"] }, 1, 0]
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          month: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: {
                  if: { $lt: ["$_id.month", 10] },
                  then: { $concat: ["0", { $toString: "$_id.month" }] },
                  else: { $toString: "$_id.month" }
                }
              }
            ]
          },
          total: { $round: ["$totalRevenue", 2] },
          orderCount: 1,
          codOrders: 1,
          onlineOrders: 1,
          cancelledOrders: 1,
          averageOrderValue: {
            $round: [{ $divide: ["$totalRevenue", "$orderCount"] }, 2]
          }
        }
      },
      {
        $sort: { month: 1 } // Oldest to newest
      }
    ]);

    console.log(`✅ Found ${monthlyTotals.length} months of data`);
    
    if (monthlyTotals.length > 0) {
      console.log("Sample data:", monthlyTotals[0]);
    }

    // Agar koi data nahi hai to empty array bhejo
    if (monthlyTotals.length === 0) {
      return res.status(200).json([]);
    }

    res.status(200).json(monthlyTotals);

  } catch (error) {
    console.error("❌ Error fetching monthly order totals:", error);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: "Failed to fetch monthly order totals",
      error: error.message
    });
  }
});

// ==================== UPDATE PAYMENT STATUS API ====================
router.put('/orders/:orderId/payment-status', async (req, res) => {
  const { orderId } = req.params;
  const { paymentStatus, displayStatus } = req.body;

  console.log("=== UPDATE PAYMENT STATUS ===");
  console.log("Order ID:", orderId);
  console.log("Payment Status:", paymentStatus);

  try {
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Map frontend status to backend status
    let backendStatus = paymentStatus;
    let actualDisplayStatus = displayStatus || paymentStatus;
    
    if (paymentStatus === 'Paid') {
      backendStatus = 'captured';
    } else if (paymentStatus === 'COD') {
      backendStatus = 'cod';
      actualDisplayStatus = 'COD';
    } else if (paymentStatus === 'Pending') {
      backendStatus = 'pending';
    }

    // Initialize paymentInfo if not exists
    if (!order.paymentInfo) {
      order.paymentInfo = {};
    }

    // Update payment info
    order.paymentInfo.status = backendStatus;
    order.paymentInfo.displayStatus = actualDisplayStatus;
    order.paymentInfo.updatedAt = new Date();
    
    // Set payment method for COD
    if (actualDisplayStatus === 'COD' || paymentStatus === 'COD') {
      order.paymentMethod = 'cod';
    }

    // If payment status is set to 'captured' (Paid), update order status to Confirmed
    if (backendStatus === 'captured' && order.status === 'Pending') {
      order.status = 'Confirmed';
      console.log("Order status updated to Confirmed");
    }

    await order.save();

    console.log("✅ Payment status updated successfully");

    res.status(200).json({
      success: true,
      message: "Payment status updated successfully",
      paymentInfo: order.paymentInfo
    });

  } catch (error) {
    console.error("❌ Error updating payment status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update payment status",
      error: error.message
    });
  }
});

// ==================== CAPTURE PAYMENT API ====================
router.post('/capturePayment/:orderId', async (req, res) => {
  const { orderId } = req.params;

  console.log("=== CAPTURE PAYMENT ===");
  console.log("Order ID:", orderId);

  try {
    const order = await Order.findById(orderId);
    
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    // Check if payment needs capture
    if (order.paymentInfo?.status !== 'authorized') {
      return res.status(400).json({
        success: false,
        message: `Payment cannot be captured. Current status: ${order.paymentInfo?.status || 'unknown'}`
      });
    }

    const paymentId = order.paymentInfo.paymentId;
    
    if (!paymentId) {
      return res.status(400).json({
        success: false,
        message: "No payment ID found for this order"
      });
    }

    console.log("Capturing payment:", paymentId);
    
    const { instance: rzp } = await getRazorpay();
    const capturedPayment = await rzp.payments.capture(
      paymentId,
      Math.round(order.totalAmount * 100),
      { currency: "INR" }
    );

    console.log("Payment captured:", capturedPayment.id);

    // Update order payment info
    order.paymentInfo.status = 'captured';
    order.paymentInfo.displayStatus = 'Paid';
    order.paymentInfo.capturedAt = new Date();
    order.paymentInfo.updatedAt = new Date();
    
    // Update order status
    if (order.status === 'Pending') {
      order.status = 'Confirmed';
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: "Payment captured successfully",
      paymentInfo: order.paymentInfo
    });

  } catch (error) {
    console.error("❌ Error capturing payment:", error);
    
    res.status(500).json({
      success: false,
      message: "Failed to capture payment",
      error: error.message
    });
  }
});


// OPTIONAL: Get yearly summary
router.get('/yearly-summary', async (req, res) => {
  console.log("=== FETCHING YEARLY SUMMARY ===");
  
  try {
    const yearlySummary = await Order.aggregate([
      {
        $match: {
          $or: [
            { status: { $in: ['Confirmed', 'Processing', 'Shipped', 'Delivered'] } },
            { 'paymentInfo.status': 'captured' }
          ]
        }
      },
      {
        $group: {
          _id: { year: { $year: "$createdAt" } },
          totalRevenue: { $sum: "$totalAmount" },
          totalOrders: { $sum: 1 },
          averageOrderValue: { $avg: "$totalAmount" }
        }
      },
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          totalRevenue: { $round: ["$totalRevenue", 2] },
          totalOrders: 1,
          averageOrderValue: { $round: ["$averageOrderValue", 2] }
        }
      },
      { $sort: { year: -1 } }
    ]);

    console.log(`✅ Found ${yearlySummary.length} years of data`);
    res.status(200).json(yearlySummary);
  } catch (error) {
    console.error("Error fetching yearly summary:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to fetch yearly summary",
      error: error.message 
    });
  }
});

// Get orders by email
router.get('/orders/email/:email', async (req, res) => {
  const { email } = req.params;

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required"
    });
  }

  try {
    // Case-insensitive search for email
    const emailRegex = new RegExp(`^${email}$`, 'i');
    
    const orders = await Order.find({ 
      $or: [
        { email: emailRegex },
        { userEmail: emailRegex }
      ]
    })
    .populate({
      path: 'items.productId',
      model: 'Product',
      select: 'name price media category description'
    })
    .sort({ createdAt: -1 })
    .lean();

    // Process media URLs
    const processedOrders = await enrichOrderCustomerNames(orders.map(order => {
      if (order.items) {
        order.items = order.items.map(item => {
          if (item.media && Array.isArray(item.media) && item.media.length > 0) {
            item.media = item.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          } else if (item.productId && item.productId.media && Array.isArray(item.productId.media)) {
            item.productId.media = item.productId.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          }
          return item;
        });
      }
      return order;
    }));

    res.status(200).json({
      success: true,
      orders: processedOrders,
      totalCount: processedOrders.length
    });

  } catch (error) {
    console.error("Error fetching orders by email:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders by email",
      error: error.message
    });
  }
});

// Guest orders को linked करने का API
router.post('/link-guest-orders', async (req, res) => {
  const { email, userId } = req.body;

  try {
    const guestOrders = await Order.find({
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, 'i') } },
        { userEmail: { $regex: new RegExp(`^${email}$`, 'i') } }
      ],
      userId: { $exists: false }
    });

    if (guestOrders.length === 0) {
      return res.json({
        success: true,
        message: 'No guest orders found to link',
        linkedCount: 0
      });
    }

    const result = await Order.updateMany(
      { _id: { $in: guestOrders.map(order => order._id) } },
      { $set: { userId: userId, isGuest: false } }
    );

    res.json({
      success: true,
      message: `Linked ${result.modifiedCount} guest orders to your account`,
      linkedCount: result.modifiedCount
    });

  } catch (error) {
    console.error('Error linking guest orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link guest orders'
    });
  }
});

// Guest orders को logged-in user से link करने का API
router.post('/orders/link-guest-orders', async (req, res) => {
  const { email, userId } = req.body;

  console.log("=== LINKING GUEST ORDERS ===");
  console.log("Email:", email);
  console.log("User ID:", userId);

  if (!email || !userId) {
    return res.status(400).json({
      success: false,
      message: "Email and userId are required"
    });
  }

  try {
    const guestOrders = await Order.find({
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, 'i') } },
        { userEmail: { $regex: new RegExp(`^${email}$`, 'i') } }
      ],
      $or: [
        { userId: { $exists: false } },
        { userId: /^guest_/ },
        { isGuest: true }
      ]
    });

    console.log(`Found ${guestOrders.length} guest orders to link`);

    if (guestOrders.length === 0) {
      return res.json({
        success: true,
        message: 'No guest orders found to link',
        linkedCount: 0
      });
    }

    const result = await Order.updateMany(
      { _id: { $in: guestOrders.map(order => order._id) } },
      { $set: { userId: userId, isGuest: false } }
    );

    console.log(`Linked ${result.modifiedCount} guest orders`);

    res.json({
      success: true,
      message: `Linked ${result.modifiedCount} guest orders to your account`,
      linkedCount: result.modifiedCount,
      orders: guestOrders.map(order => ({
        orderId: order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`,
        internalId: order._id,
        createdAt: order.createdAt,
        totalAmount: order.totalAmount
      }))
    });

  } catch (error) {
    console.error('Error linking guest orders:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link guest orders',
      error: error.message
    });
  }
});

// Public callback configured in Razorpay Magic Checkout:
// https://drbskhealthcare.com/api/payment/shipping-info
const sendMagicCheckoutShippingInfo = async (req, res) => {
  console.log('============ MAGIC CHECKOUT SHIPPING INFO API HIT ============');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  console.log('Query:', JSON.stringify(req.query, null, 2));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  const readZipcode = (address) => (
    address?.zipcode ||
    address?.zip_code ||
    address?.postal_code ||
    address?.pincode ||
    address?.pin_code ||
    address?.zip ||
    address?.pin ||
    ''
  );

  const flattenObject = (value, prefix = '', output = {}) => {
    if (!value || typeof value !== 'object') return output;

    Object.entries(value).forEach(([key, nestedValue]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
        flattenObject(nestedValue, path, output);
        return;
      }
      output[path] = nestedValue;
    });

    return output;
  };

  const pickAddressFromFlatPayload = (source) => {
    const flat = flattenObject(source);
    const address = {};

    Object.entries(flat).forEach(([key, value]) => {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (['zipcode', 'postalcode', 'pincode', 'pin', 'zip'].includes(normalizedKey)) {
        address.zipcode = value;
      } else if (normalizedKey.endsWith('zipcode') || normalizedKey.endsWith('postalcode') || normalizedKey.endsWith('pincode')) {
        address.zipcode = value;
      } else if (normalizedKey.endsWith('country')) {
        address.country = value;
      } else if (normalizedKey.endsWith('id') && !address.id) {
        address.id = value;
      }
    });

    return readZipcode(address) ? address : null;
  };

  const collectBracketAddresses = (source) => {
    const collected = {};

    Object.entries(source || {}).forEach(([key, value]) => {
      const match = key.match(/^(?:addresses|shipping_address|billing_address)\[(\d+)\]\[(\w+)\]$/);
      if (!match) return;
      const [, index, field] = match;
      collected[index] = {
        ...(collected[index] || {}),
        [field]: value
      };
    });

    return Object.values(collected);
  };

  const parseAddresses = (value) => {
    if (Array.isArray(value)) return value.filter(address => address && typeof address === 'object');
    if (!value) return [];

    try {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (Array.isArray(parsed)) return parsed.filter(address => address && typeof address === 'object');
      if (parsed && typeof parsed === 'object') {
        if (readZipcode(parsed) || parsed.country || parsed.id) return [parsed];
        return Object.values(parsed).filter(address => address && typeof address === 'object');
      }
    } catch (_) {
      return [];
    }

    return [];
  };

  const parsedAddresses = [
    ...parseAddresses(req.body?.addresses),
    ...parseAddresses(req.query?.addresses),
    ...parseAddresses(req.body?.shipping_addresses),
    ...parseAddresses(req.query?.shipping_addresses),
    ...parseAddresses(req.body?.shipping_address),
    ...parseAddresses(req.query?.shipping_address),
    ...collectBracketAddresses(req.body),
    ...collectBracketAddresses(req.query),
    pickAddressFromFlatPayload(req.body),
    pickAddressFromFlatPayload(req.query)
  ].filter(address => address && typeof address === 'object');

  const addresses = (parsedAddresses.length ? parsedAddresses : [{ id: 'default', country: 'IN' }]).filter((address, index, all) => {
    const zipcode = String(readZipcode(address)).trim();
    const country = String(address?.country || 'IN').trim().toUpperCase();
    const key = zipcode ? `${zipcode}:${country}` : `${address?.id ?? index}:${country}`;
    return all.findIndex((candidate, candidateIndex) =>
      (String(readZipcode(candidate)).trim()
        ? `${String(readZipcode(candidate)).trim()}:${String(candidate?.country || 'IN').trim().toUpperCase()}`
        : `${candidate?.id ?? candidateIndex}:${String(candidate?.country || 'IN').trim().toUpperCase()}`
      ) === key
    ) === index;
  }).map((address, index) => ({
    id: String(address?.id ?? index),
    ...address,
    country: address?.country || 'IN'
  }));

  const codEnabled = await isCodEnabled();

  const makeShippingMethod = (serviceable) => ({
    id: 'standard-delivery',
    name: 'Standard Delivery',
    description: serviceable
      ? 'Free standard delivery across India'
      : 'Delivery is available only for valid Indian pincodes',
    serviceable,
    shipping_fee: 0,
    shipping_amount: 0,
    amount: 0,
    cod: codEnabled && serviceable,
    cod_fee: 0
  });

  const addressResponses = addresses.map((address, index) => {
    const zipcode = String(readZipcode(address)).trim();
    const country = String(address?.country || 'IN').trim().toUpperCase();
    const hasZipcode = zipcode.length > 0;
    const addrServiceable = ['IN', 'IND', 'INDIA'].includes(country) && (!hasZipcode || /^\d{6}$/.test(zipcode));
    const shippingMethod = makeShippingMethod(addrServiceable);

    return {
      id: String(address?.id ?? index),
      zipcode,
      country,
      serviceable: addrServiceable,
      shipping_methods: [shippingMethod],
      shipping_options: [shippingMethod],
      shipping_rate: shippingMethod
    };
  }).filter((address, index, all) => {
    const key = address.zipcode ? `${address.zipcode}:${address.country}` : `${address.id}:${address.country}`;
    return all.findIndex(candidate =>
      (candidate.zipcode ? `${candidate.zipcode}:${candidate.country}` : `${candidate.id}:${candidate.country}`) === key
    ) === index;
  });

  console.log('Parsed addresses:', JSON.stringify(addresses, null, 2));

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0'
  });

  const defaultMethod = makeShippingMethod(true);

  const responseBody = {
    addresses: addressResponses,
    shipping_methods: [defaultMethod],
    shipping_options: [defaultMethod]
  };

  console.log('Responding with status 200. Body:', JSON.stringify(responseBody, null, 2));
  console.log('================================================================');

  return res.status(200).json(responseBody);
};

router.get('/payment/shipping-info', sendMagicCheckoutShippingInfo);
router.post('/payment/shipping-info', sendMagicCheckoutShippingInfo);

// Create Razorpay Order
router.post('/createPaymentOrder', async (req, res) => {
  const {
    userId,
    items,
    address,
    phone,
    totalAmount,
    email,
    checkoutMode,
    pricingTier
  } = req.body;

  console.log("=== CREATE RAZORPAY ORDER REQUEST ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  try {
    let paymentItems = items;
    let orderTotal = Number(totalAmount);
    let resolvedPricingTier = pricingTier;

    if (checkoutMode === 'magic') {
      const canonicalCart = await buildCanonicalMagicCart(items, userId, pricingTier);
      paymentItems = canonicalCart.items;
      orderTotal = canonicalCart.amountInPaise / 100;
      resolvedPricingTier = canonicalCart.pricingTier;
    }

    // Validation
    if (!userId || !paymentItems || !Array.isArray(paymentItems) || paymentItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "User ID and items are required"
      });
    }

    if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid total amount is required"
      });
    }

    // Email validation
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email address is required"
      });
    }

    // Prepare phone number
    let formattedPhone = phone?.toString().trim() || '';
    formattedPhone = formattedPhone.replace(/^\+91/, '').replace(/^91/, '');
    
    console.log("Phone validation:", {
      original: phone,
      cleaned: formattedPhone,
      length: formattedPhone.length,
      is10Digits: /^\d{10}$/.test(formattedPhone)
    });
    
    if (formattedPhone && !/^\d{10}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be exactly 10 digits"
      });
    }
    formattedPhone = formattedPhone ? `+91${formattedPhone}` : '';

    // Check Razorpay instance
    if (!razorpayInstance) {
      console.error("Razorpay instance not initialized");
      return res.status(500).json({
        success: false,
        message: "Payment gateway not configured properly"
      });
    }

    // Calculate amount (convert to paise)
    const amountInPaise = Math.round(orderTotal * 100);
    const lineItems = paymentItems.map((item, index) => {
      const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
      const offerPrice = Math.round(Number(item.price) * 100);
      const originalPrice = Math.max(
        offerPrice,
        Math.round(Number(item.mrp || item.price) * 100)
      );

      if (!item.productId || !item.name || !Number.isFinite(offerPrice) || offerPrice <= 0) {
        throw new Error(`Invalid item at position ${index + 1}`);
      }

      const imageUrl = getRazorpayImageUrl(item.imageUrl || item.image_url);

      return {
        sku: String(item.productId),
        variant_id: String(item.variant || item.variantId || item.productId),
        price: originalPrice,
        offer_price: offerPrice,
        quantity,
        name: String(item.name).trim().slice(0, 256),
        description: String(item.description || item.name).trim().slice(0, 256),
        ...(imageUrl ? { image_url: imageUrl } : {})
      };
    });
    const lineItemsTotal = lineItems.reduce(
      (sum, item) => sum + (item.offer_price * item.quantity),
      0
    );

    if (lineItemsTotal !== amountInPaise) {
      return res.status(400).json({
        success: false,
        message: "Cart total does not match the item total"
      });
    }
    
    // Create receipt - make sure it's unique
    const receipt = `rcpt_${Date.now()}_${userId.toString().slice(-6)}`;
    
    // Create Razorpay Order with correct format
    const razorpayOrderData = {
      amount: amountInPaise,
      currency: "INR",
      receipt: receipt,
      line_items_total: lineItemsTotal,
      line_items: lineItems,
      notes: {
        userId: userId.toString(),
        ...(formattedPhone ? { phone: formattedPhone } : {}),
        ...(email ? { email } : {}),
        ...(address ? { address: String(address).slice(0, 250) } : {}),
        itemsCount: paymentItems.length.toString(),
        amount: orderTotal.toString(),
        ...(checkoutMode === 'magic' ? {
          checkoutMode: 'magic',
          pricingTier: resolvedPricingTier
        } : {})
      }
    };

    console.log("Creating Razorpay order with data:", JSON.stringify(razorpayOrderData, null, 2));

    const { instance: rzp, keyId } = await getRazorpay();
    let razorpayOrder;
    try {
      // Use async/await properly
      razorpayOrder = await rzp.orders.create(razorpayOrderData);
      console.log("✅ Razorpay order created successfully:", {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency
      });
    } catch (razorpayError) {
      console.error("❌ Razorpay error details:", {
        message: razorpayError.message,
        error: razorpayError.error,
        statusCode: razorpayError.statusCode,
        stack: razorpayError.stack
      });
      
      // Check for specific error types
      if (razorpayError.error && razorpayError.error.code === 'BAD_REQUEST_ERROR') {
        if (razorpayError.error.description === 'Authentication failed') {
          return res.status(500).json({
            success: false,
            message: "Payment gateway authentication failed. Please check Razorpay configuration.",
            error: "Authentication failed"
          });
        }
      }
      
      return res.status(500).json({
        success: false,
        message: "Failed to create payment order. Please try again.",
        error: razorpayError.message,
        details: razorpayError.error
      });
    }

    const checkoutToken = checkoutMode === 'magic'
      ? createMagicCheckoutToken({
          orderId: razorpayOrder.id,
          userId: String(userId),
          items: paymentItems,
          amountInPaise,
          pricingTier: resolvedPricingTier,
          expiresAt: Date.now() + (30 * 60 * 1000)
        })
      : null;

    // Send success response with order details
    res.status(200).json({
      success: true,
      message: "Payment order created successfully",
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt,
        line_items_total: razorpayOrder.line_items_total
      },
      key_id: keyId,
      ...(checkoutToken ? { checkoutToken } : {})
    });

  } catch (error) {
    console.error("❌ Unexpected error in createPaymentOrder:", error);
    console.error("Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: "Failed to create payment order",
      error: error.message
    });
  }
});

// Verify Payment and Create Order with Email
router.post('/verifyPayment', async (req, res) => {
    const { 
      razorpay_order_id, 
      razorpay_payment_id, 
      razorpay_signature,
      userId,
      items,
      address,
      phone,
      email,
      totalAmount,
      userName: requestedUserName,
      fullName,
      customerName,
      name,
      checkoutToken
    } = req.body;

  console.log("=== VERIFY PAYMENT REQUEST ===");
  console.log("Payment verification data:", {
    razorpay_order_id,
    razorpay_payment_id,
    userId,
    itemsCount: items?.length,
    email: email
  });

  try {
    let verifiedUserId = userId;
    let verifiedItems = items;

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Payment verification data is incomplete"
      });
    }

    if (!userId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Order data is incomplete"
      });
    }

    // Verify payment signature
    const { instance: rzp, keySecret } = await getRazorpay();
    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    console.log("Signature verification:", {
      received: razorpay_signature,
      generated: generatedSignature,
      match: generatedSignature === razorpay_signature
    });

    const generatedBuffer = Buffer.from(generatedSignature, 'hex');
    const receivedBuffer = Buffer.from(String(razorpay_signature), 'hex');
    if (
      receivedBuffer.length !== generatedBuffer.length ||
      !crypto.timingSafeEqual(receivedBuffer, generatedBuffer)
    ) {
      console.error("❌ Signature verification failed!");
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature. Payment verification failed."
      });
    }

    console.log("✅ Payment signature verified successfully");

    // Fetch both resources because Magic Checkout stores the customer's
    // delivery details on the Razorpay order.
    let paymentDetails;
    let razorpayOrderDetails;
    try {
      [paymentDetails, razorpayOrderDetails] = await Promise.all([
        rzp.payments.fetch(razorpay_payment_id),
        rzp.orders.fetch(razorpay_order_id)
      ]);
      console.log("Payment details from Razorpay:", {
        id: paymentDetails.id,
        status: paymentDetails.status,
        amount: paymentDetails.amount,
        method: paymentDetails.method
      });
    } catch (error) {
      console.error("Error fetching payment details:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch payment details from gateway"
      });
    }

    const isCodPayment =
      codEnabled &&
      paymentDetails.method === 'cod' &&
      ['pending', 'authorized', 'captured'].includes(paymentDetails.status);

    if (paymentDetails.status !== 'captured' && !isCodPayment) {
      console.error("❌ Payment not captured:", paymentDetails.status);
      return res.status(400).json({
        success: false,
        message: `Payment is ${paymentDetails.status}. Order cannot be created.`
      });
    }

    console.log("✅ Payment paid successfully");

    const magicCustomer = razorpayOrderDetails?.customer_details || {};
    const magicAddress =
      magicCustomer.shipping_address ||
      magicCustomer.billing_address ||
      {};
    const resolvedEmail = magicCustomer.email || paymentDetails.email || email;
    const resolvedPhone =
      magicAddress.contact ||
      magicCustomer.contact ||
      paymentDetails.contact ||
      phone;
    const resolvedName =
      magicAddress.name ||
      requestedUserName ||
      fullName ||
      customerName ||
      name;
    const resolvedAddress = [
      magicAddress.line1,
      magicAddress.line2,
      magicAddress.city,
      magicAddress.state,
      magicAddress.zipcode,
      magicAddress.country
    ].filter(Boolean).join(', ') || address;

    if (!resolvedEmail || !resolvedPhone || !resolvedAddress) {
      return res.status(400).json({
        success: false,
        message: "Delivery details were not returned by Magic Checkout"
      });
    }

    if (
      paymentDetails.order_id !== razorpay_order_id ||
      String(razorpayOrderDetails?.id) !== String(razorpay_order_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment does not belong to this order"
      });
    }

    const gatewayAmount = Number(razorpayOrderDetails?.amount);
    if (
      !Number.isFinite(gatewayAmount) ||
      Number(paymentDetails.amount) !== gatewayAmount ||
      String(paymentDetails.currency || '').toUpperCase() !== 'INR' ||
      String(razorpayOrderDetails?.currency || '').toUpperCase() !== 'INR'
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment amount or currency does not match the order"
      });
    }

    if (razorpayOrderDetails?.notes?.checkoutMode === 'magic') {
      let tokenPayload;
      try {
        tokenPayload = verifyMagicCheckoutToken(checkoutToken);
      } catch (tokenError) {
        return res.status(400).json({ success: false, message: tokenError.message });
      }

      if (
        tokenPayload.orderId !== razorpay_order_id ||
        Number(tokenPayload.amountInPaise) !== gatewayAmount
      ) {
        return res.status(400).json({
          success: false,
          message: "Checkout session does not match the payment"
        });
      }
      verifiedUserId = tokenPayload.userId;
      verifiedItems = tokenPayload.items;
    }

    const existingOrder = await Order.findOne({ razorpayOrderId: razorpay_order_id });
    if (existingOrder) {
      return res.status(200).json({
        success: true,
        message: "Order was already created",
        orderId: existingOrder.orderId,
        order: {
          _id: existingOrder._id,
          orderId: existingOrder.orderId,
          status: existingOrder.status,
          totalAmount: existingOrder.totalAmount,
          paymentMethod: existingOrder.paymentMethod,
          createdAt: existingOrder.createdAt,
          userEmail: existingOrder.userEmail,
          userName: existingOrder.userName,
          emailSent: existingOrder.emailSent || false
        }
      });
    }

    // Prepare phone number
    let formattedPhone = resolvedPhone.toString().trim();
    formattedPhone = formattedPhone.replace(/^\+91/, '').replace(/^91/, '');
    if (!/^\d{10}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format"
      });
    }
    formattedPhone = `+91${formattedPhone}`;

    // Prepare user details
    let userEmail = resolvedEmail;
    let userName = resolvedName || 'Customer';
    let isGuest = false;
    let newUserDetails = null;

    let user = null;
    const mongoose = require('mongoose');
    const bcrypt = require('bcryptjs');
    if (verifiedUserId && !String(verifiedUserId).startsWith('guest_') && mongoose.Types.ObjectId.isValid(verifiedUserId)) {
      try {
        user = await Admin.findById(verifiedUserId);
      } catch (err) {
        console.error("Error finding user by ID:", err.message);
      }
    }
    
    if (!user && resolvedEmail) {
      try {
        user = await Admin.findOne({ email: resolvedEmail.toLowerCase().trim() });
      } catch (err) {
        console.error("Error finding user by email:", err.message);
      }
    }

    if (!user) {
      // Auto-create user account!
      const generatedPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);
      
      try {
        user = await Admin.create({
          name: resolvedName || resolvedEmail.split('@')[0] || 'Customer',
          email: resolvedEmail.toLowerCase().trim(),
          phone: formattedPhone,
          password: hashedPassword,
          address: resolvedAddress ? [resolvedAddress] : [],
          role: 'User',
          timeStamp: new Date().toISOString()
        });
        
        newUserDetails = {
          isNew: true,
          password: generatedPassword
        };
        console.log(`Auto-created user for email ${resolvedEmail} with password ${generatedPassword}`);
      } catch (createErr) {
        console.error("Error auto-creating user:", createErr.message);
      }
    } else {
      // User exists, update address/phone if missing
      let updated = false;
      if (!user.phone && formattedPhone) {
        user.phone = formattedPhone;
        updated = true;
      }
      if (resolvedAddress && !user.address.includes(resolvedAddress)) {
        user.address.push(resolvedAddress);
        updated = true;
      }
      if (updated) {
        try {
          await user.save();
        } catch (saveErr) {
          console.error("Error updating existing user info:", saveErr.message);
        }
      }
    }

    if (user) {
      verifiedUserId = user._id;
      userEmail = user.email;
      userName = user.name || resolvedName || 'Customer';
      isGuest = false;
    } else {
      isGuest = true;
      userEmail = resolvedEmail;
      userName = resolvedName || getEmailLocalPart(resolvedEmail) || 'Customer';
    }

    // Prepare items with media
    console.log("Preparing order items...");
    const itemsWithMedia = await Promise.all(verifiedItems.map(async (item) => {
      let media = [];
      let productDetails = {};
      
      try {
        const product = await Product.findById(item.productId);
        if (product) {
          media = product.media || [];
          media = media.map(mediaItem => ({
            ...mediaItem,
            url: processMediaUrl(mediaItem.url)
          }));
          productDetails = {
            category: product.category,
            description: product.description
          };
        }
      } catch (error) {
        console.error(`Error fetching product ${item.productId}:`, error.message);
      }
      
      return {
        productId: item.productId.toString(),
        name: item.name.toString().trim(),
        quantity: parseInt(item.quantity),
        price: parseFloat(item.price),
        media: media,
        ...productDetails
      };
    }));

    // Create order in database - ONLY AFTER PAYMENT VERIFICATION ✅
    console.log("Creating database order...");
    
    const orderData = {
      userId: verifiedUserId,
      userEmail: userEmail,
      userName: userName,
      email: resolvedEmail,
      items: itemsWithMedia,
      address: resolvedAddress.toString().trim(),
      shippingAddress: {
        line1: magicAddress.line1 || '',
        line2: magicAddress.line2 || '',
        city: magicAddress.city || '',
        state: magicAddress.state || '',
        zipcode: magicAddress.zipcode || '',
        country: magicAddress.country || 'India'
      },
      phone: formattedPhone,
      totalAmount: Number(razorpayOrderDetails?.amount || paymentDetails.amount) / 100,
      razorpayOrderId: razorpay_order_id,
      isGuest: isGuest,
      paymentMethod: isCodPayment ? 'cod' : 'online',
      paymentInfo: {
        paymentId: razorpay_payment_id,
        amount: Number(razorpayOrderDetails?.amount || paymentDetails.amount) / 100,
        status: isCodPayment ? 'pending' : 'captured',
        method: paymentDetails.method,
        ...(isCodPayment ? {} : { capturedAt: new Date() }),
        updatedAt: new Date()
      },
      status: 'Pending',
      emailSent: false,
      emailError: null,
      createdAt: new Date()
    };

    console.log("Order data for database:", JSON.stringify(orderData, null, 2));

    let savedOrder;
    try {
      const newOrder = new Order(orderData);
      savedOrder = await newOrder.save();
      console.log("✅ Order created in database:", savedOrder._id);

      await createDelhiveryShipmentForOrder(savedOrder);
      
      // ✅ SEND EMAIL HERE - After order is successfully saved
      try {
        console.log("Sending order confirmation email...");
        const emailResult = await sendOrderConfirmationEmailDynamic(
          savedOrder.toObject(), 
          userEmail, 
          userName,
          newUserDetails
        );
        
        if (emailResult.success) {
          console.log(`✅ Order confirmation email sent to ${userEmail}`);
          savedOrder.emailSent = true;
          savedOrder.emailSentAt = new Date();
          savedOrder.emailError = null;
          await savedOrder.save();
        } else {
          console.log(`⚠️ Email sending failed: ${emailResult.error}`);
          savedOrder.emailSent = false;
          savedOrder.emailError = emailResult.error;
          await savedOrder.save();
        }
      } catch (emailError) {
        console.error("Error in email sending:", emailError);
        savedOrder.emailSent = false;
        savedOrder.emailError = emailError.message;
        await savedOrder.save();
      }
      
    } catch (dbError) {
      console.error("Database error:", dbError);
      return res.status(500).json({
        success: false,
        message: "Failed to save order to database",
        error: dbError.message
      });
    }

    // Log success
    if (typeof logger !== 'undefined' && logger && typeof logger.info === 'function') {
      logger.info("Order created successfully", {
        orderId: savedOrder.orderId,
        internalId: savedOrder._id,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        userId: verifiedUserId,
        totalAmount: totalAmount,
        emailSent: savedOrder.emailSent || false
      });
    }

    console.log("=== ORDER CREATION SUCCESS ===");

    // Send success response
    res.status(201).json({
      success: true,
      message: "Order created successfully!",
      orderId: savedOrder.orderId,
      order: {
        _id: savedOrder._id,
        orderId: savedOrder.orderId,
        status: savedOrder.status,
        totalAmount: savedOrder.totalAmount,
        paymentMethod: savedOrder.paymentMethod,
        createdAt: savedOrder.createdAt,
        userEmail: savedOrder.userEmail,
        userName: savedOrder.userName,
        emailSent: savedOrder.emailSent || false
      }
    });

  } catch (error) {
    console.error("❌ Error in verifyPayment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment and create order",
      error: error.message
    });
  }
});

// Update Order Status
router.put('/orders/:orderId/status', async (req, res) => {
  const { orderId } = req.params;
  const { status, cancelReason } = req.body;

  console.log("=== UPDATE ORDER STATUS ===");
  console.log("Order ID:", orderId);
  console.log("New Status:", status);
  console.log("Cancel Reason:", cancelReason);

  if (!['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status"
    });
  }

  try {
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    console.log("Current order state:", {
      id: order._id,
      status: order.status,
      paymentStatus: order.paymentInfo?.status,
      paymentId: order.paymentInfo?.paymentId,
      totalAmount: order.totalAmount
    });

    let refundProcessed = false;
    let refundDetails = null;

    // Process refund when admin cancels AND payment is captured
    if (status === 'Cancelled' && order.status !== 'Cancelled') {
      console.log("Order being cancelled - checking refund eligibility...");

      // Check if payment exists and is captured
      if (order.paymentInfo?.paymentId && order.paymentInfo?.status === 'captured') {
        console.log("Payment captured - processing refund");
        console.log("Payment ID:", order.paymentInfo.paymentId);
        console.log("Amount:", order.totalAmount);

        try {
          // Call Razorpay refund API
          console.log("Calling Razorpay refund API...");
          const { instance: rzp } = await getRazorpay();
          const refund = await rzp.payments.refund(
            order.paymentInfo.paymentId,
            {
              amount: Math.round(order.totalAmount * 100),
              speed: 'optimum',
              notes: {
                reason: cancelReason || 'Order cancelled by admin',
                orderId: order._id.toString(),
                cancelledBy: 'admin'
              },
              receipt: `refund_${order._id}_${Date.now()}`
            }
          );

          console.log("Refund API success:");
          console.log("Refund ID:", refund.id);
          console.log("Refund Amount:", refund.amount / 100);
          console.log("Refund Status:", refund.status);

          const estimatedSettlement = new Date();
          estimatedSettlement.setDate(estimatedSettlement.getDate() + 5);

          // Update order with refund information
          order.refundInfo = {
            refundId: refund.id,
            amount: refund.amount / 100,
            status: 'initiated',
            reason: cancelReason || 'Order cancelled by admin',
            initiatedAt: new Date(),
            estimatedSettlement: estimatedSettlement,
            speed: 'optimum',
            notes: 'Automatic refund processed on order cancellation'
          };

          refundProcessed = true;
          refundDetails = order.refundInfo;

          console.log("Refund info updated in order");

          if (logger && typeof logger.info === 'function') {
            logger.info("Refund initiated successfully", {
              orderId: order._id,
              refundId: refund.id,
              amount: refund.amount / 100,
              paymentId: order.paymentInfo.paymentId
            });
          }

        } catch (refundError) {
          console.error("Refund API failed:");
          console.error("Error:", refundError.message);
          console.error("Code:", refundError.error?.code);

          if (logger && typeof logger.error === 'function') {
            logger.error("Refund processing failed", {
              orderId,
              paymentId: order.paymentInfo.paymentId,
              error: refundError.message,
              errorCode: refundError.error?.code
            });
          }

          // Set refund as failed
          order.refundInfo = {
            refundId: null,
            amount: order.totalAmount,
            status: 'failed',
            reason: `Refund failed: ${refundError.message}`,
            failedAt: new Date(),
            notes: 'Automatic refund failed - manual processing required'
          };

          console.log("Refund failed but order will still be cancelled");
        }
      } else {
        console.log("No refund needed - payment not captured");
        console.log("Payment ID exists:", !!order.paymentInfo?.paymentId);
        console.log("Payment status:", order.paymentInfo?.status);
      }

      // Update cancellation details
      order.status = 'Cancelled';
      order.cancelReason = cancelReason || 'Cancelled by admin';
      order.cancelledBy = 'admin';
      order.cancelledAt = new Date();

    } else {
      // Regular status update
      console.log("Regular status update to:", status);
      order.status = status;
    }

    // Save the order
    await order.save();
    console.log("Order saved successfully");

    // Send status update email to customer
    try {
      const emailToUse = order.userEmail || order.email;
      const nameToUse = order.userName || 'Customer';
      if (emailToUse) {
        sendStatusUpdateEmail(order.toObject ? order.toObject() : order, emailToUse, nameToUse)
          .then(res => console.log("Status update email result:", res))
          .catch(err => console.error("Status update email error:", err));
      }
    } catch (emailErr) {
      console.error("Error initiating status update email:", emailErr);
    }

    const responseMessage = status === 'Cancelled'
      ? `Order cancelled successfully! ${refundProcessed
          ? `Refund of ₹${refundDetails?.amount} initiated. Refund ID: ${refundDetails?.refundId}. Settlement expected in 5-7 days.`
          : order.refundInfo?.status === 'failed'
            ? 'Automatic refund failed - manual processing required.'
            : 'No refund needed - payment not captured.'
        }`
      : 'Order status updated successfully';

    res.status(200).json({
      success: true,
      message: responseMessage,
      order: {
        _id: order._id,
        status: order.status,
        paymentInfo: order.paymentInfo,
        refundInfo: order.refundInfo,
        cancelReason: order.cancelReason,
        cancelledAt: order.cancelledAt
      },
      refundProcessed: refundProcessed,
      refundDetails: refundDetails
    });

  } catch (error) {
    console.error("Error updating order status:", error);
    if (logger && typeof logger.error === 'function') {
      logger.error("Error updating order status", {
        orderId,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: error.message
    });
  }
});

// ==================== DELETE ORDER API - FIXED ====================
// Delete Order (Admin only)
router.delete('/orders/:orderId', async (req, res) => {
  const { orderId } = req.params;

  console.log("=== DELETE ORDER REQUEST ===");
  console.log("Order ID:", orderId);
  console.log("Timestamp:", new Date().toISOString());

  try {
    // Find the order first
    const order = await Order.findById(orderId);
    
    if (!order) {
      console.log("❌ Order not found:", orderId);
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    console.log("✅ Order found:", {
      id: order._id,
      status: order.status,
      amount: order.totalAmount,
      paymentStatus: order.paymentInfo?.status,
      refundStatus: order.refundInfo?.status
    });

    // Check if order can be deleted
    // Only allow deletion for certain statuses
    const deletableStatuses = ['Pending', 'Cancelled', 'Delivered'];
    if (!deletableStatuses.includes(order.status)) {
      console.log("❌ Order cannot be deleted - invalid status:", order.status);
      return res.status(400).json({
        success: false,
        message: `Order with status '${order.status}' cannot be deleted. Only orders with status: ${deletableStatuses.join(', ')} can be deleted.`
      });
    }

    // Check if order has refund in progress
    if (order.refundInfo?.status === 'initiated') {
      console.log("❌ Order cannot be deleted - refund in progress:", order.refundInfo.status);
      return res.status(400).json({
        success: false,
        message: "Cannot delete order while refund is in progress. Please wait for refund to complete."
      });
    }

    // Store order details for response before deletion
    const orderDetails = {
      _id: order._id,
      orderId: order.razorpayOrderId,
      amount: order.totalAmount,
      status: order.status,
      email: order.email,
      userName: order.userName,
      createdAt: order.createdAt,
      itemsCount: order.items?.length || 0
    };

    // Delete the order
    await Order.findByIdAndDelete(orderId);
    console.log("✅ Order deleted successfully from database:", orderId);

    // ✅ FIXED: Safe access to req.body with optional chaining
    const deletedBy = req.body?.deletedBy || 'admin';

    // Log the deletion
    if (logger && typeof logger.info === 'function') {
      logger.info("Order deleted successfully", {
        orderId: order._id,
        razorpayOrderId: order.razorpayOrderId,
        amount: order.totalAmount,
        status: order.status,
        deletedBy: deletedBy,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: "Order deleted successfully",
      deletedOrder: orderDetails
    });

  } catch (error) {
    console.error("❌ Error deleting order:", error);
    console.error("Error stack:", error.stack);
    
    if (logger && typeof logger.error === 'function') {
      logger.error("Error deleting order", {
        orderId,
        error: error.message,
        stack: error.stack
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete order",
      error: error.message
    });
  }
});

// ==================== BULK DELETE ORDERS API - FIXED ====================
// Bulk delete orders (Admin only)
router.post('/orders/bulk-delete', async (req, res) => {
  const { orderIds } = req.body;

  console.log("=== BULK DELETE ORDERS REQUEST ===");
  console.log("Order IDs to delete:", orderIds);
  console.log("Total count:", orderIds?.length || 0);
  console.log("Timestamp:", new Date().toISOString());

  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Order IDs array is required"
    });
  }

  try {
    // Find all orders first
    const orders = await Order.find({ _id: { $in: orderIds } });
    console.log(`✅ Found ${orders.length} orders out of ${orderIds.length} requested`);

    // Check for non-deletable orders
    const deletableStatuses = ['Pending', 'Cancelled', 'Delivered'];
    const nonDeletableOrders = orders.filter(order => 
      !deletableStatuses.includes(order.status)
    );

    if (nonDeletableOrders.length > 0) {
      console.log("❌ Non-deletable orders found:", nonDeletableOrders.map(o => ({
        id: o._id,
        status: o.status
      })));
      
      return res.status(400).json({
        success: false,
        message: `Some orders cannot be deleted. ${nonDeletableOrders.length} orders have non-deletable status.`,
        nonDeletableOrders: nonDeletableOrders.map(o => ({
          _id: o._id,
          status: o.status
        }))
      });
    }

    // Check for orders with pending refunds
    const ordersWithPendingRefunds = orders.filter(order => 
      order.refundInfo?.status === 'initiated'
    );

    if (ordersWithPendingRefunds.length > 0) {
      console.log("❌ Orders with pending refunds:", ordersWithPendingRefunds.map(o => o._id));
      
      return res.status(400).json({
        success: false,
        message: `Cannot delete ${ordersWithPendingRefunds.length} order(s) with refunds in progress.`,
        pendingRefundOrders: ordersWithPendingRefunds.map(o => o._id)
      });
    }

    // Perform bulk deletion
    const result = await Order.deleteMany({ _id: { $in: orderIds } });

    console.log(`✅ Bulk deletion completed: ${result.deletedCount} orders deleted`);

    // ✅ FIXED: Safe access to req.body.deletedBy
    const deletedBy = req.body?.deletedBy || 'admin';

    // Log the bulk deletion
    if (logger && typeof logger.info === 'function') {
      logger.info("Bulk orders deleted successfully", {
        deletedCount: result.deletedCount,
        requestedCount: orderIds.length,
        deletedOrders: orderIds,
        deletedBy: deletedBy,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.deletedCount} orders`,
      deletedCount: result.deletedCount
    });

  } catch (error) {
    console.error("❌ Error in bulk delete:", error);
    console.error("Error stack:", error.stack);
    
    if (logger && typeof logger.error === 'function') {
      logger.error("Error in bulk delete orders", {
        orderIds,
        error: error.message,
        stack: error.stack
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to delete orders",
      error: error.message
    });
  }
});

// Add endpoint to resend order confirmation email
router.post('/orders/:orderId/resend-email', async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    const emailResult = await sendOrderConfirmationEmailDynamic(
      order.toObject(),
      order.userEmail || order.email,
      order.userName || 'Customer'
    );

    if (emailResult.success) {
      order.emailSent = true;
      order.emailSentAt = new Date();
      order.emailError = null;
      await order.save();

      res.status(200).json({
        success: true,
        message: "Order confirmation email resent successfully",
        email: order.userEmail || order.email,
        messageId: emailResult.messageId
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to resend email",
        error: emailResult.error
      });
    }

  } catch (error) {
    console.error("Error resending email:", error);
    res.status(500).json({
      success: false,
      message: "Failed to resend order confirmation email",
      error: error.message
    });
  }
});

// Get Payment Status
router.get('/paymentStatus/:razorpayOrderId', async (req, res) => {
  const { razorpayOrderId } = req.params;

  try {
    const order = await Order.findOne({ razorpayOrderId: razorpayOrderId });
    
    if (order) {
      return res.status(200).json({
        success: true,
        orderExists: true,
        order: order,
        message: "Order found in database"
      });
    }

    const { instance: rzp } = await getRazorpay();
    const razorpayOrder = await rzp.orders.fetch(razorpayOrderId);
    const payments = await rzp.orders.fetchPayments(razorpayOrderId);

    res.status(200).json({
      success: true,
      orderExists: false,
      razorpayOrder: razorpayOrder,
      payments: payments,
      message: "Order not in database, but found in Razorpay"
    });

  } catch (error) {
    console.error("Error checking payment status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check payment status"
    });
  }
});

// Get Orders by Email
router.get('/orders/by-email/:email', async (req, res) => {
  const { email } = req.params;

  console.log("=== FETCHING ORDERS BY EMAIL ===");
  console.log("Email:", email);

  if (!email) {
    return res.status(400).json({
      success: false,
      message: "Email is required"
    });
  }

  try {
    const orders = await Order.find({ 
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, 'i') } },
        { userEmail: { $regex: new RegExp(`^${email}$`, 'i') } }
      ]
    })
    .populate({
      path: 'items.productId',
      model: 'Product',
      select: 'name price media category description'
    })
    .sort({ createdAt: -1 })
    .lean();

    console.log(`Found ${orders.length} orders for email: ${email}`);

    const processedOrders = await enrichOrderCustomerNames(orders.map(order => {
      if (order.items) {
        order.items = order.items.map(item => {
          if (item.media && Array.isArray(item.media) && item.media.length > 0) {
            item.media = item.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          }
          else if (item.productId && item.productId.media && Array.isArray(item.productId.media)) {
            item.productId.media = item.productId.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          }
          return item;
        });
      }
      return order;
    }));

    res.status(200).json({
      success: true,
      orders: processedOrders,
      totalCount: processedOrders.length,
      email: email
    });

  } catch (error) {
    console.error("Error fetching orders by email:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders by email",
      error: error.message
    });
  }
});

// Get Orders by User ID
router.get('/orders/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const orders = await Order.find({ userId })
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'name price media category description'
      })
      .sort({ createdAt: -1 })
      .lean();

    const processedOrders = await enrichOrderCustomerNames(orders.map(order => {
      if (order.items) {
        order.items = order.items.map(item => {
          if (item.media && Array.isArray(item.media) && item.media.length > 0) {
            item.media = item.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          }
          else if (item.productId && item.productId.media && Array.isArray(item.productId.media)) {
            item.productId.media = item.productId.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          }
          return item;
        });
      }
      return order;
    }));

    res.status(200).json({
      success: true,
      orders: processedOrders,
      totalCount: processedOrders.length
    });

  } catch (error) {
    console.error("Error fetching user orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message
    });
  }
});

// Get All Orders (Admin)
router.get('/orders', async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('userId', 'name email phone')
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'name price media category'
      })
      .sort({ createdAt: -1 })
      .lean();

    const processedOrders = await enrichOrderCustomerNames(orders.map(order => {
      if (order.items) {
        order.items = order.items.map(item => {
          if (item.media && Array.isArray(item.media) && item.media.length > 0) {
            item.media = item.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          } else if (item.productId && item.productId.media && Array.isArray(item.productId.media)) {
            item.productId.media = item.productId.media.map(mediaItem => ({
              ...mediaItem,
              url: processMediaUrl(mediaItem.url)
            }));
          }
          return item;
        });
      }
      return order;
    }));

    res.status(200).json({
      success: true,
      orders: processedOrders,
      totalCount: processedOrders.length
    });

  } catch (error) {
    console.error("Error fetching all orders:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: error.message
    });
  }
});

// Get refund status for specific order
router.get('/orders/:orderId/refund-status', async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await Order.findById(orderId)
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'name price media category description'
      })
      .lean();
      
    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    if (order.items) {
      order.items = order.items.map(item => {
        if (item.media && Array.isArray(item.media) && item.media.length > 0) {
          item.media = item.media.map(mediaItem => ({
            ...mediaItem,
            url: processMediaUrl(mediaItem.url)
          }));
        } else if (item.productId && item.productId.media && Array.isArray(item.productId.media)) {
          item.productId.media = item.productId.media.map(mediaItem => ({
            ...mediaItem,
            url: processMediaUrl(mediaItem.url)
          }));
        }
        return item;
      });
    }

    let refundInfo = order.refundInfo || { status: 'none' };

    if (order.refundInfo?.refundId && order.paymentInfo?.paymentId) {
      try {
        const { instance: rzp } = await getRazorpay();
        const refunds = await rzp.payments.fetchMultipleRefund(order.paymentInfo.paymentId);
        const latestRefund = refunds.items.find(r => r.id === order.refundInfo.refundId);

        if (latestRefund) {
          const estimatedSettlement = new Date(latestRefund.created_at * 1000);
          estimatedSettlement.setDate(estimatedSettlement.getDate() + 5);

          refundInfo = {
            refundId: latestRefund.id,
            amount: latestRefund.amount / 100,
            status: latestRefund.status === 'processed' ? 'processed' : 'initiated',
            reason: order.refundInfo.reason || 'Refund processed',
            initiatedAt: new Date(latestRefund.created_at * 1000),
            processedAt: latestRefund.processed_at ? new Date(latestRefund.processed_at * 1000) : null,
            estimatedSettlement: estimatedSettlement,
            speed: 'optimum',
            notes: order.refundInfo.notes
          };

          await Order.findByIdAndUpdate(orderId, { refundInfo });
        }
      } catch (error) {
        console.log('Error fetching refund status:', error.message);
      }
    }

    res.status(200).json({
      success: true,
      refundInfo: refundInfo,
      order: order
    });

  } catch (error) {
    console.error("Error fetching refund status:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch refund status",
      error: error.message
    });
  }
});

// Get order count
router.get('/totalOrdercount', async (req, res) => {
  try {
    const count = await Order.countDocuments();
    res.status(200).json({
      success: true,
      totalOrders: count
    });
  } catch (error) {
    console.error("Error getting order count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get order count"
    });
  }
});

// Get single order with complete details
router.get('/order/:orderId', async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await Order.findById(orderId)
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'name price media category description'
      })
      .lean();

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found"
      });
    }

    if (order.items) {
      order.items = order.items.map(item => {
        if (item.media && Array.isArray(item.media) && item.media.length > 0) {
          item.media = item.media.map(mediaItem => ({
            ...mediaItem,
            url: processMediaUrl(mediaItem.url)
          }));
        } else if (item.productId && item.productId.media && Array.isArray(item.productId.media)) {
          item.productId.media = item.productId.media.map(mediaItem => ({
            ...mediaItem,
            url: processMediaUrl(mediaItem.url)
          }));
        }
        return item;
      });
    }

    res.status(200).json({
      success: true,
      order: order
    });

  } catch (error) {
    console.error("Error fetching order:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch order",
      error: error.message
    });
  }
});

// In your backend route
// routes/product.routes.js
router.get('/productsBySubcategory', optionalToken, async (req, res) => {
  const requestStartTime = Date.now();

  try {
    const pricingTier = await resolvePricingTier(req.user);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📥 /productsBySubcategory API HIT");
    console.log("🕒 Time:", new Date().toISOString());
    console.log("🌐 Full URL:", req.originalUrl);
    console.log("📦 Raw Query Params:", req.query);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    let { subcategory } = req.query;

    /* ===============================
       1️⃣ VALIDATION
    =============================== */
    if (!subcategory) {
      console.error("❌ ERROR: subcategory is missing in query");
      return res.status(400).json({ error: "subcategory is required" });
    }

    console.log("✅ Subcategory received (raw):", `"${subcategory}"`);
    console.log("📏 Raw length:", subcategory.length);

    /* ===============================
       2️⃣ DECODING STEP
    =============================== */
    const decodedSubcategory = decodeURIComponent(subcategory);
    console.log("🔓 Decoded subcategory:", `"${decodedSubcategory}"`);

    /* ===============================
       3️⃣ NORMALIZATION STEP
    =============================== */
    const normalizedSubcategory = decodedSubcategory
      .replace(/%20/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

    console.log("🧹 Normalized subcategory:", `"${normalizedSubcategory}"`);
    console.log("📏 Normalized length:", normalizedSubcategory.length);

    /* ===============================
       4️⃣ REGEX CREATION
    =============================== */
    const regex = new RegExp(`^${normalizedSubcategory}$`, "i");
    console.log("🧪 Generated Regex:", regex);

    /* ===============================
       5️⃣ DATABASE QUERY START
    =============================== */
    console.log("🗄️ Querying Product collection...");
    console.time("⏱️ MongoDB Query Time");

    const products = await Product.find({
      sub_category: { $regex: regex }
    });

    console.timeEnd("⏱️ MongoDB Query Time");

    /* ===============================
       6️⃣ QUERY RESULT LOGS
    =============================== */
    console.log("📊 Products found count:", products.length);

    if (products.length === 0) {
      console.warn("⚠️ No products matched subcategory:", `"${normalizedSubcategory}"`);
    } else {
      console.log("🧾 Matched Product IDs:", products.map(p => p._id));
      console.log("🧾 Matched Subcategories:", [
        ...new Set(products.map(p => p.sub_category))
      ]);
    }

    /* ===============================
       7️⃣ RESPONSE SENT
    =============================== */
    const totalTime = Date.now() - requestStartTime;
    console.log("✅ Response sent successfully");
    console.log("⏱️ Total API Time:", `${totalTime} ms`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    res.status(200).json(
      products.map(product => applyProductPricing(product, pricingTier))
    );

  } catch (error) {
    console.error("🔥 SERVER ERROR OCCURRED");
    console.error("🧨 Error Message:", error.message);
    console.error("📛 Error Stack:", error.stack);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    res.status(500).json({ error: "Server error" });
  }
});

// CREATE COD ORDER - FIXED VERSION
router.post('/createCOD', async (req, res) => {
  console.log("=== CREATE COD ORDER REQUEST ===");
  console.log("Request body:", JSON.stringify(req.body, null, 2));

  try {
    const {
      userId,
      items,
      address,
      phone,
      email,
      totalAmount,
      baseAmount,
      codCharge,
      isGuest,
      userName: requestedUserName,
      fullName,
      customerName,
      name,
      shippingAddress,
      line1,
      line2,
      city,
      state,
      zipcode,
      pincode,
      country,
      productName,
      productImage,
      paymentMethod,
      paymentStatus
    } = req.body;

    // Validate required fields
    if (!userId || !items || !address || !phone || !email || !totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Required fields are missing'
      });
    }

    // Email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Valid email address is required"
      });
    }

    // Prepare phone number
    let formattedPhone = phone.toString().trim();
    formattedPhone = formattedPhone.replace(/^\+91/, '').replace(/^91/, '');
    
    console.log("Phone validation:", {
      original: phone,
      cleaned: formattedPhone,
      length: formattedPhone.length,
      is10Digits: /^\d{10}$/.test(formattedPhone)
    });
    
    if (!/^\d{10}$/.test(formattedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be exactly 10 digits"
      });
    }
    formattedPhone = `+91${formattedPhone}`;

    // Generate order ID
    const orderId = `COD${Date.now()}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // Prepare user details
    let resolvedUserId = userId;
    let resolvedEmail = email;
    let resolvedName = requestedUserName || fullName || customerName || name || 'Customer';
    let newUserDetails = null;

    let user = null;
    const mongoose = require('mongoose');
    const bcrypt = require('bcryptjs');
    if (userId && !String(userId).startsWith('guest_') && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        user = await Admin.findById(userId);
      } catch (err) {
        console.error("Error finding user by ID:", err.message);
      }
    }
    
    if (!user && email) {
      try {
        user = await Admin.findOne({ email: email.toLowerCase().trim() });
      } catch (err) {
        console.error("Error finding user by email:", err.message);
      }
    }

    if (!user) {
      // Auto-create user account!
      const generatedPassword = Math.random().toString(36).slice(-8);
      const hashedPassword = await bcrypt.hash(generatedPassword, 10);
      
      try {
        user = await Admin.create({
          name: resolvedName || email.split('@')[0] || 'Customer',
          email: email.toLowerCase().trim(),
          phone: formattedPhone,
          password: hashedPassword,
          address: address ? [address] : [],
          role: 'User',
          timeStamp: new Date().toISOString()
        });
        
        newUserDetails = {
          isNew: true,
          password: generatedPassword
        };
        console.log(`Auto-created user for email ${email} with password ${generatedPassword}`);
      } catch (createErr) {
        console.error("Error auto-creating user:", createErr.message);
      }
    } else {
      // User exists, update address/phone if missing
      let updated = false;
      if (!user.phone && formattedPhone) {
        user.phone = formattedPhone;
        updated = true;
      }
      if (address && !user.address.includes(address)) {
        user.address.push(address);
        updated = true;
      }
      if (updated) {
        try {
          await user.save();
        } catch (saveErr) {
          console.error("Error updating existing user info:", saveErr.message);
        }
      }
    }

    let finalUserId = userId;
    let finalUserName = resolvedName;
    let finalUserEmail = email;
    if (user) {
      finalUserId = user._id;
      finalUserEmail = user.email;
      finalUserName = user.name || resolvedName || 'Customer';
    } else {
      finalUserEmail = email;
      finalUserName = resolvedName || getEmailLocalPart(email) || 'Customer';
    }

    // Calculate base amount and cod charge
    let calculatedBaseAmount = 0;
    let calculatedCodCharge = codCharge || 99;
    
    if (items && items.length > 0) {
      // Calculate from items
      calculatedBaseAmount = items.reduce((sum, item) => {
        return sum + (parseFloat(item.price) * parseInt(item.quantity));
      }, 0);
      
      // If baseAmount provided in request, use it
      if (baseAmount) {
        calculatedBaseAmount = parseFloat(baseAmount);
      }
    }

    // Calculate total amount
    const calculatedTotalAmount = calculatedBaseAmount + calculatedCodCharge;
    
    console.log("Amount calculations:", {
      calculatedBaseAmount: calculatedBaseAmount,
      calculatedCodCharge: calculatedCodCharge,
      calculatedTotalAmount: calculatedTotalAmount,
      requestTotalAmount: totalAmount
    });

    // Validate amount consistency
    const requestTotal = parseFloat(totalAmount);
    const calculatedTotal = parseFloat(calculatedTotalAmount.toFixed(2));
    
    if (Math.abs(requestTotal - calculatedTotal) > 0.01) {
      console.warn(`Amount mismatch: request=${requestTotal}, calculated=${calculatedTotal}`);
      // Use the request total amount (frontend calculation)
      // We'll trust frontend calculation for COD orders
    }

    // Prepare items with media
    console.log("Preparing COD order items...");
    const itemsWithMedia = await Promise.all(items.map(async (item) => {
      let media = [];
      let productDetails = {};
      
      try {
        const product = await Product.findById(item.productId);
        if (product) {
          media = product.media || [];
          media = media.map(mediaItem => ({
            ...mediaItem,
            url: processMediaUrl(mediaItem.url)
          }));
          productDetails = {
            category: product.category,
            description: product.description
          };
        }
      } catch (error) {
        console.error(`Error fetching product ${item.productId}:`, error.message);
      }
      
      return {
        productId: item.productId.toString(),
        name: item.name.toString().trim(),
        quantity: parseInt(item.quantity),
        price: parseFloat(item.price),
        media: media,
        ...productDetails
      };
    }));

    // Create COD order in database - USING REQUEST AMOUNTS
    console.log("Creating COD order in database...");
    
    const orderData = {
      orderId: orderId,
      userId: finalUserId,
      userEmail: finalUserEmail,
      userName: finalUserName,
      email: email,
      items: itemsWithMedia,
      address: address.toString().trim(),
      phone: formattedPhone,
      totalAmount: parseFloat(requestTotal.toFixed(2)), // Use frontend calculated total
      baseAmount: baseAmount ? parseFloat(baseAmount) : parseFloat(requestTotal) - calculatedCodCharge,
      codCharge: calculatedCodCharge,
      isGuest: isGuest || false,
      paymentMethod: 'cod',
      paymentStatus: 'pending',
      status: 'Pending',
      paymentInfo: {
        method: 'cod',
        status: 'pending',
        amount: parseFloat(requestTotal.toFixed(2))
      },
      emailSent: false,
      createdAt: new Date()
    };

    console.log("COD Order data:", JSON.stringify(orderData, null, 2));

    // Bypass validation if needed - create order directly
    let savedOrder;
    try {
      // Try to save normally first
      const newOrder = new Order(orderData);
      savedOrder = await newOrder.save();
      console.log("✅ COD Order created in database:", savedOrder._id);
      
    } catch (dbError) {
      console.error("Database error in COD order:", dbError);
      console.error("Error details:", dbError.message);
      
      // If validation fails, try to bypass it
      if (dbError.name === 'ValidationError') {
        try {
          console.log("Trying to bypass validation...");
          
          // Create order without validation
          savedOrder = await Order.create([orderData], { validateBeforeSave: false });
          savedOrder = savedOrder[0];
          
          console.log("✅ COD Order created (bypassing validation):", savedOrder._id);
        } catch (bypassError) {
          console.error("Failed to bypass validation:", bypassError);
          throw dbError; // Throw original error
        }
      } else {
        throw dbError;
      }
    }

    // Send confirmation email for COD order
    try {
      console.log("Sending COD order confirmation email...");
      const emailResult = await sendOrderConfirmationEmailDynamic(
        savedOrder.toObject(), 
        finalUserEmail, 
        finalUserName,
        newUserDetails
      );
      
      if (emailResult.success) {
        console.log(`✅ COD order confirmation email sent to ${email}`);
        savedOrder.emailSent = true;
        savedOrder.emailSentAt = new Date();
        savedOrder.emailError = null;
        await savedOrder.save();
      } else {
        console.log(`⚠️ COD Email sending failed: ${emailResult.error}`);
        savedOrder.emailSent = false;
        savedOrder.emailError = emailResult.error;
        await savedOrder.save();
      }
    } catch (emailError) {
      console.error("Error in COD email sending:", emailError);
      // Continue even if email fails
    }

    console.log("=== COD ORDER CREATION SUCCESS ===");

    // Send success response
    return res.status(201).json({
      success: true,
      message: "COD order created successfully!",
      orderId: savedOrder.orderId,
      orderDetails: {
        _id: savedOrder._id,
        orderId: savedOrder.orderId,
        status: savedOrder.status,
        totalAmount: savedOrder.totalAmount,
        baseAmount: savedOrder.baseAmount,
        codCharge: savedOrder.codCharge,
        createdAt: savedOrder.createdAt,
        email: savedOrder.email,
        paymentMethod: savedOrder.paymentMethod,
        emailSent: savedOrder.emailSent || false
      }
    });

  } catch (error) {
    console.error("❌ Error in createCOD:", error);
    console.error("Error stack:", error.stack);
    
    return res.status(500).json({
      success: false,
      message: "Failed to create COD order",
      error: error.message
    });
  }
});

// --- INVOICE PDF GENERATION ENDPOINT ---
router.get('/orders/:orderId/invoice', async (req, res) => {
  const { orderId } = req.params;

  try {
    const order = await Order.findById(orderId)
      .populate({
        path: 'items.productId',
        model: 'Product',
        select: 'name price media category description'
      })
      .lean();

    if (!order) {
      return res.status(404).send("Order not found");
    }

    const { jsPDF } = require("jspdf");
    const autoTable = require("jspdf-autotable").default || require("jspdf-autotable");

    // Helper to convert number to Indian currency words
    function numberToWords(num) {
      const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
      const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
      
      if (num === 0) return 'Zero';
      
      const parts = parseFloat(num).toFixed(2).split('.');
      const integerPart = parseInt(parts[0], 10);
      const decimalPart = parseInt(parts[1], 10);
      
      let words = helper(integerPart) + ' Rupees';
      
      if (decimalPart > 0) {
        words += ' and ' + helper(decimalPart) + ' Paise';
      }
      
      return words + ' Only';
      
      function helper(n) {
        if (n < 20) return a[n];
        if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
        if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + helper(n % 100) : '');
        if (n < 100000) return helper(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 !== 0 ? ' ' + helper(n % 1000) : '');
        if (n < 10000000) return helper(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 !== 0 ? ' ' + helper(n % 100000) : '');
        return helper(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 !== 0 ? ' ' + helper(n % 10000000) : '');
      }
    }

    // Format Date helper
    function formatDate(dateString) {
      if (!dateString) return '-';
      const d = new Date(dateString);
      return d.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).replace(/\//g, '.');
    }

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.width; // A4 is 210mm
    const margin = 14;
    const contentWidth = pageWidth - (margin * 2); // 182mm
    let currentY = 15;

    // --- 1. HEADER SECTION ---
    // Draw Logo on the left
    const logoImgData = "data:image/jpeg;base64,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w++++++++++++uBflFJqtXy+99N+sq++++++++++++06hTAAAAAAAAAAAAAxAKADDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDAAWRgAAAAAAAAAAAAAAAAAAAQAWNAPPPPPPPPPPPPPPPPPPPPPPPPMPOKAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2336yyyyyyyyyyyyyyyyy/xyrAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGCFLDBBBBBBBBBIBoDAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAXDZ4ww47O3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAaMgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//aAAwDAQACAAMAAAAQ888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888e888888888888888888888888888888888888888888888888888888841888888888888888888888888888888888888888888888884882IE88/U88888888888888888888888888888888888888888888888Wu8/Du84/Y88888888888888888888888888888888888888888888888jvQkDm80+5E388888888888888888888888888888888888888888888y8D6U8/m/6cAUBp888888888888888888888888888888888888888888EmJhXKb/5t8Brh/C88V88888888888888888888888888888888888888cEYSaor/o88gHIq88bw8888888888888888888888888888888888888883/8yor6G88RWJuPP98888888888888888888888888888888888888pk8erkyorp88siWoy8588888888888888888888888888888888888888eXUW8Z8jr488HAX4c81c8888888888888888888888888888888888888URb28C8mrA8v8Kv885ScU8888888888888888888888888888888884i888H/8ADPNaufGqj/APu7CPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPA8C/K//PyvJ6/P5PGX6qUij/PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPOAsgsPP+fADgu/U6OwYyhM4nfPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPCddv/vEMNvOvPPPPE71/PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPG/yghfQHPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPAYsAvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPJvPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPBPPPPPPPPPBM8888888888888888888888888888888888888888888884fPPPPPPPPEM8888888888888888888888888888888888888888888885fPPPPPPPPFssssssssssssssssssssssssssssssssssssst09cssssss/PPPPPPPPBsMMMMMNv/wD7DDDDDDDD3/P7DDL7/Db/AI3905wwiaQwwwwwwj888888888G888888/+as98888888266s24c88+28Be0/288vFN888888/888888888GPPPPPPawPTtNHNPPPP7zPbq4x15l7x/1tNhPPPPPPPPPPPI888888888uzzzzzz19z072a9zzzzW6sYZj88zzc824zxRxY/ezzzzzzzk888888888+zzzzzz08zXSdazzzzzW49sczW2rz3++7zzzk8uzzzzzzzzl888888888s/wD/AP8A/wD+Zf8Atdl3/wD/AP8A9rf/AKn6x8z2az9xf/8A7/cW/wD/AP8A/wD/AP5888888888QPPPPPPf7P0sdEPPPPP+8P295uE96/8AdPYTzzNkPTzzzzzz3fPPPPPPPPFDzzzzz3LPbLV7D7bDz9Pf/bGNX+x/fb9eTz+tfPjzzzzzzzfPPPPPPPPAPPPPPPPvnvPPPvPnvPHvvHvPHj7PPPvPLPPPHH3vPPPPPPP/ADzzzzzzzwHzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz7zzzzzzzzxQMMMMMMMMMMMMMMM85gkAYEg4M4U08kYoMMMMMMMMMMMMMNPzzzzzzzzxI4444444444444457wheCY7784l/l/8AZkOOOOOOOOOOOOOOP888888888Pu/wDP/wD/AP8A/wD/AP8A/wD/ANb/AJZzu72df/v9/wC+t/8A/wD/AP8A/wD/AP8A/wD/ALZAHzzzzzzzzzzzzxJnjbHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHjN9BzzzzzzzzzzzzzzzzzzzyxF8IUwwwwwwwwwwwwwwwwwwwwwwwwgJXuXzzzzzzzzzzzzzzzzzzzzzzzzzzzjJTPXzzzzzzzzzzzzzzzzjGKF7zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzw+CIEAMMMMMMMMM4C+PzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzyeHjL/8A15+0888888888888888888888888888888888888888888888888888Jfc888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888888//EADkRAAEDAgQDBgQGAQMFAAAAAAEAAgMEEQUSEzEQIUEUIDAyUFEiYXGBFSMzQEJSNICRoRYkNbHR/9oACAECAQE/AP8AXMD6zGeZ9TJA5ldoamuDtuLzYKPf1Ca4bcKOQSC/CqJ5BMURseL33Ki9QIuLJjjC5NcHi4U8ReLhAKFh3PCWToEFG2wT3ZRdQuu259NBB4VMf8go5Cw3CjlD+BNlJLfkOEYvwqjyAUH6YT5QzdNmDvS5QR8TVHKHoi6li0z8kEJHe6JJ34AX5JosLcKrzBUx+GyqPOght6WbscmOzC6IBFipIixDjCzrxqhzCp5Mh5p8bZN0Imji6UDZMB3PpE4+K6hfY24TD4UOAFzZBthbjUuBNuDJXM2QqCjM5F5O6ji6n0Zzw3dCRp4VHRA2PBwzAhDhCLu4yvyNvxCYwnZCA9UyIN9HkOZxQTTmCqenBuw4PFiRwgHI8ah13W4RxF+yZC1nFzw3dMc5/wBPRpYTmuE2NxQbYWUxu63CE3bwmHO/CDbgTYXROZQw5+Z2QFtuL3ZRdC8juauG8vRAQdu5JMGbb8YDztwcLi3CA7jhN+mVGzO6yAtyHBzw3dGpHRPkL91T9VJfObqHb0OWEP5j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";
    doc.addImage(logoImgData, 'JPEG', margin, 10, 15, 15);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(104, 23, 27); // Brand color #68171b
    doc.text('UK German Pharmaceuticals', margin + 18, 19);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(33, 33, 33);
    doc.text('Tax Invoice/Bill of Supply/Cash Memo', pageWidth - margin, 17, { align: 'right' });
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text('(Original for Recipient)', pageWidth - margin, 22, { align: 'right' });

    currentY = 28;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 6;

    // --- 2. ADDRESSES SECTION ---
    const custAddress = (order.address || '').toLowerCase();
    const custState = (order.shippingAddress?.state || '').toLowerCase();
    const isPunjab = custAddress.includes('punjab') || custState.includes('punjab');

    const soldByText = [
      'UK German Pharmaceuticals',
      'Akal Academy Road, Opp. Punjab Gramin Bank,',
      'Cheema Mandi - 148029,',
      'Distt. Sangrur (Punjab) India',
      'PAN No: AKBPK9732C',
      'GST Registration No: 03AKBPK9732C1ZK'
    ];

    const billingAddress = [
      order.name || order.userName || 'N/A',
      order.shippingAddress?.line1 || order.address || 'N/A',
      order.shippingAddress?.line2 || '',
      `${order.shippingAddress?.city || ''}${order.shippingAddress?.state ? ', ' + order.shippingAddress.state : ''} ${order.shippingAddress?.zipcode || ''}`,
      order.shippingAddress?.country || 'India',
      `Phone: ${order.phone || 'N/A'}`,
      `Email: ${order.email || order.userEmail || 'N/A'}`,
      `State/UT Code: ${isPunjab ? '03 (Punjab)' : 'Other'}`
    ].filter(line => line !== null && line !== '');

    const leftColX = margin;
    const rightColX = pageWidth / 2 + 5;
    const colWidth = (pageWidth / 2) - margin - 5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(33, 33, 33);
    doc.text('Sold By :', leftColX, currentY);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    let tempY = currentY + 4;
    soldByText.forEach(line => {
      doc.text(line, leftColX, tempY);
      tempY += 3.8;
    });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(33, 33, 33);
    doc.text('Billing & Shipping Address :', rightColX, currentY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    let rightTempY = currentY + 4;
    billingAddress.forEach(line => {
      const lines = doc.splitTextToSize(line, colWidth);
      lines.forEach(wrappedLine => {
        doc.text(wrappedLine, rightColX, rightTempY);
        rightTempY += 3.8;
      });
    });

    currentY = Math.max(tempY, rightTempY) + 4;

    doc.line(margin, currentY, pageWidth - margin, currentY);
    currentY += 6;

    // --- 3. ORDER / INVOICE METADATA ---
    const orderDisplayId = order.orderId || `BSK-O-${String(order._id || '').slice(-8).toUpperCase()}`;
    const invoiceNo = `INV-BSK-${String(order._id || '').slice(-6).toUpperCase()}`;
    const orderDate = formatDate(order.createdAt);
    const payStatus = order.paymentInfo?.status === 'captured' || order.paymentInfo?.status === 'cod' ? 'Paid' : 'Unpaid';
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);

    doc.text(`Order Number: ${orderDisplayId}`, leftColX, currentY);
    doc.text(`Order Date: ${orderDate}`, leftColX, currentY + 4.5);
    doc.text(`Payment Method: ${order.paymentMethod === 'cod' ? 'Cash on Delivery' : 'Online Payment'}`, leftColX, currentY + 9);

    doc.text(`Invoice Number: ${invoiceNo}`, rightColX, currentY);
    doc.text(`Invoice Date: ${orderDate}`, rightColX, currentY + 4.5);
    doc.text(`Payment Status: ${payStatus}`, rightColX, currentY + 9);

    currentY += 15;

    // --- 4. PRODUCTS TABLE ---
    const tableColumns = [
      { header: 'SL\nNo', dataKey: 'sl' },
      { header: 'Description', dataKey: 'desc' },
      { header: 'Unit Price\n(Rs.)', dataKey: 'unit' },
      { header: 'Qty', dataKey: 'qty' },
      { header: 'Net Amt\n(Rs.)', dataKey: 'net' },
      { header: 'Tax\nRate', dataKey: 'taxRate' },
      { header: 'Tax\nType', dataKey: 'taxType' },
      { header: 'Tax Amt\n(Rs.)', dataKey: 'taxVal' },
      { header: 'Total\n(Rs.)', dataKey: 'total' }
    ];

    const tableRows = [];
    let grandSubtotal = 0;
    let grandTax = 0;
    let grandTotal = 0;

    if (order.items && Array.isArray(order.items)) {
      order.items.forEach((item, index) => {
        const itemQty = item.quantity || 1;
        const itemPrice = item.price || 0;
        const rowTotal = itemPrice * itemQty;
        
        const netPrice = itemPrice / 1.12;
        const netAmount = netPrice * itemQty;
        const taxAmount = rowTotal - netAmount;
        
        grandSubtotal += netAmount;
        grandTax += taxAmount;
        grandTotal += rowTotal;

        tableRows.push({
          sl: index + 1,
          desc: item.name || 'Unknown Product',
          unit: netPrice.toFixed(2),
          qty: itemQty,
          net: netAmount.toFixed(2),
          taxRate: '12%',
          taxType: isPunjab ? 'CGST(6%)\nSGST(6%)' : 'IGST(12%)',
          taxVal: taxAmount.toFixed(2),
          total: rowTotal.toFixed(2)
        });
      });
    }

    if (order.paymentMethod === 'cod' && order.codCharge && order.codCharge > 0) {
      const codTotal = order.codCharge;
      const codNet = codTotal / 1.12;
      const codTax = codTotal - codNet;

      grandSubtotal += codNet;
      grandTax += codTax;
      grandTotal += codTotal;

      tableRows.push({
        sl: tableRows.length + 1,
        desc: 'Cash On Delivery (COD) Charges',
        unit: codNet.toFixed(2),
        qty: 1,
        net: codNet.toFixed(2),
        taxRate: '12%',
        taxType: isPunjab ? 'CGST(6%)\nSGST(6%)' : 'IGST(12%)',
        taxVal: codTax.toFixed(2),
        total: codTotal.toFixed(2)
      });
    }

    autoTable(doc, {
      startY: currentY,
      columns: tableColumns,
      body: tableRows,
      theme: 'grid',
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        valign: 'middle'
      },
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [33, 33, 33],
        fontStyle: 'bold',
        lineWidth: 0.1,
        lineColor: [200, 200, 200]
      },
      columnStyles: {
        sl: { cellWidth: 8, halign: 'center' },
        desc: { cellWidth: 54 },
        unit: { cellWidth: 18, halign: 'right' },
        qty: { cellWidth: 10, halign: 'center' },
        net: { cellWidth: 18, halign: 'right' },
        taxRate: { cellWidth: 14, halign: 'center' },
        taxType: { cellWidth: 20, halign: 'center' },
        taxVal: { cellWidth: 18, halign: 'right' },
        total: { cellWidth: 22, halign: 'right' }
      },
      didDrawPage: (data) => {
        currentY = data.cursor.y + 4;
      }
    });

    if (currentY > doc.internal.pageSize.height - 60) {
      doc.addPage();
      currentY = 20;
    }

    // --- 5. TOTALS SECTION ---
    const totalBoxWidth = contentWidth / 2;

    doc.setDrawColor(210, 210, 210);
    doc.rect(margin, currentY, totalBoxWidth - 2, 22);
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(33, 33, 33);
    doc.text('Amount in Words:', margin + 3, currentY + 5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(60, 60, 60);
    const wordsText = numberToWords(order.totalAmount || grandTotal);
    const wrappedWords = doc.splitTextToSize(wordsText, totalBoxWidth - 8);
    let wordsY = currentY + 9;
    wrappedWords.forEach(wLine => {
      doc.text(wLine, margin + 3, wordsY);
      wordsY += 3.8;
    });

    const rightBoxX = margin + totalBoxWidth + 2;
    doc.rect(rightBoxX, currentY, totalBoxWidth - 2, 22);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(80, 80, 80);
    
    doc.text('Net Subtotal:', rightBoxX + 3, currentY + 5);
    doc.text(`Rs. ${grandSubtotal.toFixed(2)}`, pageWidth - margin - 3, currentY + 5, { align: 'right' });

    doc.text('GST Tax Amount:', rightBoxX + 3, currentY + 10);
    doc.text(`Rs. ${grandTax.toFixed(2)}`, pageWidth - margin - 3, currentY + 10, { align: 'right' });

    doc.setDrawColor(220, 220, 220);
    doc.line(rightBoxX, currentY + 13.5, pageWidth - margin, currentY + 13.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(33, 33, 33);
    doc.text('Grand Total:', rightBoxX + 3, currentY + 18.5);
    doc.text(`Rs. ${parseFloat(order.totalAmount || grandTotal).toFixed(2)}`, pageWidth - margin - 3, currentY + 18.5, { align: 'right' });

    currentY += 28;

    // --- 6. SIGNATURE & FOOTER ---
    if (currentY > doc.internal.pageSize.height - 45) {
      doc.addPage();
      currentY = 20;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text('Whether tax is payable under reverse charge - No', margin, currentY + 6);

    const sigX = pageWidth - margin - 50;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(33, 33, 33);
    doc.text('For UK German Pharmaceuticals:', sigX, currentY);

    doc.setDrawColor(225, 225, 225);
    doc.rect(sigX, currentY + 2.5, 45, 12);
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 100, 100);
    doc.text('Authorized Signatory', sigX + 11, currentY + 18.5);

    currentY += 24;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text('This is a computer-generated tax invoice. No physical signature is required.', pageWidth / 2, currentY, { align: 'center' });

    const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="Invoice_${orderDisplayId}.pdf"`);
    return res.send(pdfBuffer);

  } catch (error) {
    console.error("Error generating invoice PDF in backend route:", error);
    return res.status(500).send("Error generating invoice PDF");
  }
});

module.exports = router;

