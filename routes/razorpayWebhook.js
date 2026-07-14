// // razorpayWebhook.js
// const express = require('express');
// const router = express.Router();
// const crypto = require('crypto');
// const Order = require('../models/order');

// // Replace with your webhook secret from Razorpay dashboard
// const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;


// router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
//   const webhookSignature = req.headers['x-razorpay-signature'];

//   const expectedSignature = crypto
//     .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
//     .update(req.body, 'utf-8')
//     .digest('hex');

//   if (expectedSignature !== webhookSignature) {
//     return res.status(400).send('Invalid signature');
//   }

//   const payload = JSON.parse(req.body.toString());
//   const { event, payload: eventData } = payload;

//   try {
//     if (['payment.captured', 'payment.failed', 'payment.refund.processed'].includes(event)) {
//       const paymentId = eventData.payment.entity.id;
//       const orderId = eventData.payment.entity.order_id;
//       let newStatus = '';

//       if (event === 'payment.captured') newStatus = 'Paid';
//       else if (event === 'payment.failed') newStatus = 'Failed';
//       else if (event === 'payment.refund.processed') newStatus = 'Refunded';

//       const order = await Order.findOne({ razorpayOrderId: orderId });

//       if (order) {
//         // Update only paymentInfo fields
//         order.paymentInfo = {
//           paymentId,
//           amount: eventData.payment.entity.amount / 100,
//           status,  // Razorpay payment status: 'captured', 'failed', 'refunded'
//           updatedAt: new Date(),
//         };
//         await order.save();
//       }

//     }

//     res.status(200).send('Webhook received');
//   } catch (error) {
//     // Use your logger here
//     console.error('Webhook error:', error);
//     res.status(500).send('Internal server error');
//   }
// });


// module.exports = router;



// // 2: refund status:
// const express = require('express');
// const router = express.Router();
// const crypto = require('crypto');
// const Order = require('../models/order');
// const { logger } = require('../utils/logger');
const PaymentSettings = require('../models/PaymentSettings');

// const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// // Main webhook handler - SIMPLIFIED
// router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
//   console.log("=== WEBHOOK RECEIVED ===");

//   try {
//     const webhookSignature = req.headers['x-razorpay-signature'];

//     if (!webhookSignature) {
//       console.log("❌ Missing webhook signature");
//       return res.status(400).send('Missing signature header');
//     }

//     if (!RAZORPAY_WEBHOOK_SECRET) {
//       console.log("❌ Webhook secret not configured");
//       return res.status(500).send('Webhook secret not configured');
//     }

//     // Verify webhook signature
//     const expectedSignature = crypto
//       .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
//       .update(req.body, 'utf-8')
//       .digest('hex');

//     if (expectedSignature !== webhookSignature) {
//       console.log("❌ Invalid webhook signature");
//       return res.status(400).send('Invalid signature');
//     }

//     // Parse payload
//     let payload;
//     try {
//       payload = JSON.parse(req.body.toString());
//     } catch (parseError) {
//       console.log("❌ Invalid JSON in webhook payload");
//       return res.status(400).send('Invalid JSON payload');
//     }

//     const { event, payload: eventData } = payload;
//     console.log("✅ Webhook event:", event);

//     // Handle different events
//     switch (event) {
//       case 'payment.captured':
//         await handlePaymentCaptured(eventData);
//         break;
//       case 'payment.failed':
//         await handlePaymentFailed(eventData);
//         break;
//       case 'payment.authorized':
//         await handlePaymentAuthorized(eventData);
//         break;
//       case 'refund.processed':
//         await handleRefundProcessed(eventData);
//         break;
//       default:
//         console.log("⚠️  Unhandled webhook event:", event);
//     }

//     res.status(200).json({ 
//       success: true, 
//       message: 'Webhook processed successfully',
//       event
//     });

//   } catch (error) {
//     console.error("❌ Webhook processing error:", error);
//     logger.error('Webhook processing error', { 
//       error: error.message, 
//       stack: error.stack
//     });
//     res.status(500).send('Internal server error');
//   }
// });

// // Handle payment captured
// async function handlePaymentCaptured(eventData) {
//   const paymentEntity = eventData.payment.entity;
//   const orderId = paymentEntity.order_id;

//   console.log("💰 Processing payment.captured for order:", orderId);

//   try {
//     const order = await Order.findOne({ razorpayOrderId: orderId });

//     if (!order) {
//       console.log("⚠️  Order not found for payment:", orderId);
//       return;
//     }

//     // Update payment info
//     order.paymentInfo = {
//       paymentId: paymentEntity.id,
//       amount: paymentEntity.amount / 100,
//       status: 'captured',
//       method: paymentEntity.method || 'unknown',
//       updatedAt: new Date()
//     };

//     // Ensure order is not cancelled if payment is successful
//     if (order.status === 'Cancelled') {
//       order.status = 'Pending';
//       order.cancelReason = null;
//       order.cancelledBy = null;
//       order.cancelledAt = null;
//     }

//     await order.save();

//     console.log("✅ Payment captured processed successfully for order:", order._id);
//     logger.info('Payment captured processed', { 
//       orderId: order._id, 
//       paymentId: paymentEntity.id,
//       amount: paymentEntity.amount / 100
//     });

//   } catch (error) {
//     console.error("❌ Error processing payment.captured:", error);
//     throw error;
//   }
// }

// // Handle payment failed
// async function handlePaymentFailed(eventData) {
//   const paymentEntity = eventData.payment.entity;
//   const orderId = paymentEntity.order_id;

//   console.log("💥 Processing payment.failed for order:", orderId);

//   try {
//     const order = await Order.findOne({ razorpayOrderId: orderId });

//     if (!order) {
//       console.log("⚠️  Order not found for failed payment:", orderId);
//       return;
//     }

//     // Update payment info
//     order.paymentInfo = {
//       paymentId: paymentEntity.id,
//       amount: paymentEntity.amount / 100,
//       status: 'failed',
//       method: paymentEntity.method || 'unknown',
//       updatedAt: new Date()
//     };

//     // Cancel order due to payment failure
//     order.status = 'Cancelled';
//     order.cancelReason = `Payment failed: ${paymentEntity.error_description || 'Unknown error'}`;
//     order.cancelledBy = 'system';
//     order.cancelledAt = new Date();

//     await order.save();

//     console.log("✅ Payment failed processed successfully for order:", order._id);
//     logger.info('Payment failed processed', { 
//       orderId: order._id, 
//       paymentId: paymentEntity.id
//     });

//   } catch (error) {
//     console.error("❌ Error processing payment.failed:", error);
//     throw error;
//   }
// }

// // Handle payment authorized
// async function handlePaymentAuthorized(eventData) {
//   const paymentEntity = eventData.payment.entity;
//   const orderId = paymentEntity.order_id;

//   console.log("🔐 Processing payment.authorized for order:", orderId);

//   try {
//     const order = await Order.findOne({ razorpayOrderId: orderId });

//     if (!order) {
//       console.log("⚠️  Order not found for authorized payment:", orderId);
//       return;
//     }

//     // Update payment info
//     order.paymentInfo = {
//       paymentId: paymentEntity.id,
//       amount: paymentEntity.amount / 100,
//       status: 'authorized',
//       method: paymentEntity.method || 'unknown',
//       updatedAt: new Date()
//     };

//     // Reactivate order if it was cancelled
//     if (order.status === 'Cancelled') {
//       order.status = 'Pending';
//       order.cancelReason = null;
//       order.cancelledBy = null;
//       order.cancelledAt = null;
//     }

//     await order.save();

//     console.log("✅ Payment authorized processed successfully for order:", order._id);

//   } catch (error) {
//     console.error("❌ Error processing payment.authorized:", error);
//     throw error;
//   }
// }

// // Handle refund processed
// async function handleRefundProcessed(eventData) {
//   const refundEntity = eventData.refund.entity;
//   const paymentId = refundEntity.payment_id;

//   console.log("💸 Processing refund.processed for payment:", paymentId);

//   try {
//     const order = await Order.findOne({ 'paymentInfo.paymentId': paymentId });

//     if (!order) {
//       console.log("⚠️  Order not found for refund:", paymentId);
//       return;
//     }

//     // Update refund info
//     order.refundInfo = {
//       refundId: refundEntity.id,
//       amount: refundEntity.amount / 100,
//       status: 'processed',
//       reason: order.refundInfo?.reason || 'Refund processed',
//       processedAt: new Date()
//     };

//     // Update order status
//     order.status = 'Refunded';

//     await order.save();

//     console.log("✅ Refund processed successfully for order:", order._id);

//   } catch (error) {
//     console.error("❌ Error processing refund:", error);
//     throw error;
//   }
// }

// // Health check endpoint
// router.get('/webhook/health', (req, res) => {
//   res.status(200).json({ 
//     status: 'OK', 
//     service: 'Razorpay Webhook Handler',
//     timestamp: new Date().toISOString(),
//     webhookSecret: RAZORPAY_WEBHOOK_SECRET ? 'configured' : 'missing'
//   });
// });

// module.exports = router;


// // 3:
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Order = require('../models/order');
const { logger } = require('../utils/logger');

const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Main webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  console.log("=== RAZORPAY WEBHOOK RECEIVED ===");

  try {
    const webhookSignature = req.headers['x-razorpay-signature'];

    if (!webhookSignature) {
      console.log("Missing webhook signature");
      return res.status(400).send('Missing signature header');
    }

    let settings = await PaymentSettings.findOne();
    if (!settings) {
      settings = await PaymentSettings.create({});
    }
    const webhookSecret = settings.razorpayWebhookSecret || RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.log("Webhook secret not configured");
      return res.status(500).send('Webhook secret not configured');
    }

    // Verify webhook signature
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(req.body, 'utf-8')
      .digest('hex');

    if (expectedSignature !== webhookSignature) {
      console.log("Invalid webhook signature");
      return res.status(400).send('Invalid signature');
    }

    // Parse payload
    let payload;
    try {
      payload = JSON.parse(req.body.toString());
    } catch (parseError) {
      console.log("Invalid JSON in webhook payload");
      return res.status(400).send('Invalid JSON payload');
    }

    const { event, payload: eventData } = payload;
    console.log("Webhook event received:", event);

    // Handle different events
    let processed = false;
    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(eventData);
        processed = true;
        break;
      case 'payment.failed':
        await handlePaymentFailed(eventData);
        processed = true;
        break;
      case 'payment.authorized':
        await handlePaymentAuthorized(eventData);
        processed = true;
        break;
      case 'refund.created':
        await handleRefundCreated(eventData);
        processed = true;
        break;
      case 'refund.processed':
        await handleRefundProcessed(eventData);
        processed = true;
        break;
      case 'refund.failed':
        await handleRefundFailed(eventData);
        processed = true;
        break;
      default:
        console.log("Unhandled webhook event:", event);
        processed = false;
    }

    logger.info('Webhook processed', { event, processed });

    res.status(200).json({
      success: true,
      message: 'Webhook processed successfully',
      event,
      processed
    });

  } catch (error) {
    console.error("Webhook processing error:", error);
    logger.error('Critical webhook processing error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).send('Internal server error');
  }
});

// Handle payment captured
async function handlePaymentCaptured(eventData) {
  const paymentEntity = eventData.payment.entity;
  const orderId = paymentEntity.order_id;

  console.log("Processing payment.captured for order:", orderId);

  try {
    const order = await Order.findOne({ razorpayOrderId: orderId });

    if (!order) {
      console.log("Order not found for payment:", orderId);
      logger.warn('Order not found for payment.captured', { orderId });
      return;
    }

    // Update payment info with complete details
    order.paymentInfo = {
      paymentId: paymentEntity.id,
      amount: paymentEntity.amount / 100,
      status: 'captured',
      method: paymentEntity.method || 'unknown',
      capturedAt: paymentEntity.captured_at ? new Date(paymentEntity.captured_at * 1000) : new Date(),
      updatedAt: new Date()
    };

    // Reactivate order if it was cancelled due to payment issues
    if (order.status === 'Cancelled' && order.cancelledBy === 'system') {
      order.status = 'Pending';
      order.cancelReason = null;
      order.cancelledBy = null;
      order.cancelledAt = null;
    }

    await order.save();

    console.log("Payment captured processed successfully for order:", order._id);
    logger.info('Payment captured processed', {
      orderId: order._id,
      paymentId: paymentEntity.id,
      amount: paymentEntity.amount / 100,
      userEmail: order.userEmail
    });

  } catch (error) {
    console.error("Error processing payment.captured:", error);
    logger.error('Error processing payment.captured', {
      orderId,
      error: error.message
    });
    throw error;
  }
}

// Handle payment failed
async function handlePaymentFailed(eventData) {
  const paymentEntity = eventData.payment.entity;
  const orderId = paymentEntity.order_id;

  console.log("Processing payment.failed for order:", orderId);

  try {
    const order = await Order.findOne({ razorpayOrderId: orderId });

    if (!order) {
      console.log("Order not found for failed payment:", orderId);
      return;
    }

    // Update payment info
    order.paymentInfo = {
      paymentId: paymentEntity.id,
      amount: paymentEntity.amount / 100,
      status: 'failed',
      method: paymentEntity.method || 'unknown',
      failedAt: new Date(),
      updatedAt: new Date()
    };

    // Cancel order due to payment failure
    order.status = 'Cancelled';
    order.cancelReason = `Payment failed: ${paymentEntity.error_description || 'Payment gateway error'}`;
    order.cancelledBy = 'system';
    order.cancelledAt = new Date();

    await order.save();

    console.log("Payment failed processed successfully for order:", order._id);
    logger.info('Payment failed processed', {
      orderId: order._id,
      paymentId: paymentEntity.id,
      reason: paymentEntity.error_description
    });

  } catch (error) {
    console.error("Error processing payment.failed:", error);
    throw error;
  }
}

// Handle payment authorized
async function handlePaymentAuthorized(eventData) {
  const paymentEntity = eventData.payment.entity;
  const orderId = paymentEntity.order_id;

  console.log("Processing payment.authorized for order:", orderId);

  try {
    const order = await Order.findOne({ razorpayOrderId: orderId });

    if (!order) {
      console.log("Order not found for authorized payment:", orderId);
      return;
    }

    // Update payment info
    order.paymentInfo = {
      paymentId: paymentEntity.id,
      amount: paymentEntity.amount / 100,
      status: 'authorized',
      method: paymentEntity.method || 'unknown',
      updatedAt: new Date()
    };

    // Reactivate order if cancelled
    if (order.status === 'Cancelled' && order.cancelledBy === 'system') {
      order.status = 'Pending';
      order.cancelReason = null;
      order.cancelledBy = null;
      order.cancelledAt = null;
    }

    await order.save();

    console.log("Payment authorized processed successfully for order:", order._id);

  } catch (error) {
    console.error("Error processing payment.authorized:", error);
    throw error;
  }
}

// Handle refund created
async function handleRefundCreated(eventData) {
  const refundEntity = eventData.refund.entity;
  const paymentId = refundEntity.payment_id;

  console.log("Processing refund.created for payment:", paymentId);

  try {
    const order = await Order.findOne({ 'paymentInfo.paymentId': paymentId });

    if (!order) {
      console.log("Order not found for refund:", paymentId);
      return;
    }

    // Calculate estimated settlement date
    const refundSpeed = refundEntity.speed_processed || refundEntity.speed_requested || 'optimum';
    const estimatedDays = refundSpeed === 'optimum' ? 5 : 7;
    const estimatedSettlement = new Date(refundEntity.created_at * 1000);
    estimatedSettlement.setDate(estimatedSettlement.getDate() + estimatedDays);

    // Update refund info
    order.refundInfo = {
      refundId: refundEntity.id,
      amount: refundEntity.amount / 100,
      status: 'initiated',
      reason: refundEntity.notes?.reason || order.cancelReason || 'Refund initiated',
      initiatedAt: new Date(refundEntity.created_at * 1000),
      estimatedSettlement: estimatedSettlement,
      speed: refundSpeed
    };

    // Update order status
    if (order.status !== 'Cancelled') {
      order.status = 'Cancelled';
      order.cancelReason = order.cancelReason || 'Refund initiated';
      order.cancelledBy = order.cancelledBy || 'system';
      order.cancelledAt = order.cancelledAt || new Date();
    }

    await order.save();

    console.log("Refund created processed successfully for order:", order._id);
    logger.info('Refund created processed', {
      orderId: order._id,
      refundId: refundEntity.id,
      amount: refundEntity.amount / 100,
      estimatedSettlement: estimatedSettlement
    });

  } catch (error) {
    console.error("Error processing refund.created:", error);
    throw error;
  }
}

// Handle refund processed
async function handleRefundProcessed(eventData) {
  const refundEntity = eventData.refund.entity;
  const paymentId = refundEntity.payment_id;

  console.log("Processing refund.processed for payment:", paymentId);

  try {
    const order = await Order.findOne({ 'paymentInfo.paymentId': paymentId });

    if (!order) {
      console.log("Order not found for processed refund:", paymentId);
      return;
    }

    // Update refund info with processed status
    if (order.refundInfo && order.refundInfo.refundId === refundEntity.id) {
      order.refundInfo.status = 'processed';
      order.refundInfo.processedAt = new Date(refundEntity.processed_at * 1000);
      order.refundInfo.speed = refundEntity.speed_processed || order.refundInfo.speed;

      // Update order status to Refunded
      order.status = 'Refunded';
    } else {
      // If no existing refund info, create it
      const estimatedSettlement = new Date(refundEntity.processed_at * 1000);

      order.refundInfo = {
        refundId: refundEntity.id,
        amount: refundEntity.amount / 100,
        status: 'processed',
        reason: 'Refund processed',
        processedAt: new Date(refundEntity.processed_at * 1000),
        estimatedSettlement: estimatedSettlement,
        speed: refundEntity.speed_processed || 'optimum'
      };

      order.status = 'Refunded';
    }

    await order.save();

    console.log("Refund processed successfully for order:", order._id);
    logger.info('Refund processed', {
      orderId: order._id,
      refundId: refundEntity.id,
      amount: refundEntity.amount / 100,
      processedAt: refundEntity.processed_at
    });

  } catch (error) {
    console.error("Error processing refund.processed:", error);
    throw error;
  }
}

// Handle refund failed
async function handleRefundFailed(eventData) {
  const refundEntity = eventData.refund.entity;
  const paymentId = refundEntity.payment_id;

  console.log("Processing refund.failed for payment:", paymentId);

  try {
    const order = await Order.findOne({ 'paymentInfo.paymentId': paymentId });

    if (!order) {
      console.log("Order not found for failed refund:", paymentId);
      return;
    }

    // Update refund info with failure details
    if (order.refundInfo && order.refundInfo.refundId === refundEntity.id) {
      order.refundInfo.status = 'failed';
      order.refundInfo.failedAt = new Date();
      order.refundInfo.reason = `Refund failed: ${refundEntity.error_description || 'Unknown error'}`;
    } else {
      order.refundInfo = {
        refundId: refundEntity.id,
        amount: refundEntity.amount / 100,
        status: 'failed',
        reason: `Refund failed: ${refundEntity.error_description || 'Unknown error'}`,
        failedAt: new Date()
      };
    }

    // Keep order as cancelled but indicate refund failed
    order.status = 'Cancelled';

    await order.save();

    console.log("Refund failed processed for order:", order._id);
    logger.error('Refund failed', {
      orderId: order._id,
      refundId: refundEntity.id,
      error: refundEntity.error_description
    });

  } catch (error) {
    console.error("Error processing refund.failed:", error);
    throw error;
  }
}

// Health check endpoint
router.get('/webhook/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'Razorpay Webhook Handler',
    timestamp: new Date().toISOString(),
    webhookSecret: RAZORPAY_WEBHOOK_SECRET ? 'configured' : 'missing'
  });
});

module.exports = router;
