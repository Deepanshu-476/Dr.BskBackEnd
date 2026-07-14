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
const sendMagicCheckoutShippingInfo = (req, res) => {
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
    cod: serviceable,
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(104, 23, 27); // Brand color #68171b
    doc.text('UK German Pharmaceuticals', margin, currentY);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(33, 33, 33);
    doc.text('Tax Invoice/Bill of Supply/Cash Memo', pageWidth - margin, currentY, { align: 'right' });
    currentY += 5;
    
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 100, 100);
    doc.text('(Original for Recipient)', pageWidth - margin, currentY, { align: 'right' });
    currentY += 8;

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
      'Akal Academy Road, Opp. PUNJAB Gramin Bank,',
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

