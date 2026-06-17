const Order = require("../models/order");
const Admin = require("../models/admin");
const Product = require("../models/product");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { getEmailLocalPart, pickCustomerName } = require("../utils/customerName");

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ================= HELPER =================

const processMediaUrl = (url) => {
  if (!url) return "";

  if (
    url.startsWith("http://") ||
    url.startsWith("https://") ||
    url.startsWith("data:")
  ) {
    return url;
  }

  const cleanUrl = url.startsWith("/") ? url.substring(1) : url;

  return `https://drbskhealthcare.com/${cleanUrl}`;
};

// ================= EMAIL =================

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const sendOrderConfirmationEmail = async (order, userEmail) => {
  try {
    const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;
    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: userEmail,
      subject: `Order Confirmation #${displayOrderId}`,
      html: `
        <h2>Order Confirmed</h2>
        <p>Your order has been placed successfully.</p>
        <p><strong>Order ID:</strong> ${displayOrderId}</p>
        <p><strong>Total:</strong> ₹${order.totalAmount}</p>
      `,
    });

    return true;
  } catch (error) {
    console.log("Email Error:", error.message);
    return false;
  }
};

// ================= CREATE PAYMENT ORDER =================

exports.createPaymentOrder = async (req, res) => {
  try {
    const { userId, items, address, phone, totalAmount, email } = req.body;

    if (!userId || !items || !address || !phone || !totalAmount || !email) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const razorpayOrder = await razorpayInstance.orders.create({
      amount: Math.round(totalAmount * 100),
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
    });

    res.status(200).json({
      success: true,
      order: razorpayOrder,
      key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to create payment order",
      error: error.message,
    });
  }
};

// ================= VERIFY PAYMENT =================

exports.verifyPayment = async (req, res) => {
  try {
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
    } = req.body;

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    let userName = pickCustomerName({ name: requestedUserName || fullName || customerName || name, email });
    let isGuest = false;

    if (userId.startsWith("guest_")) {
      isGuest = true;
      userName = userName || getEmailLocalPart(email) || "Customer";
    } else {
      const user = await Admin.findById(userId);

      if (user) {
        userName = pickCustomerName(
          { name: requestedUserName || fullName || customerName || name, email },
          { name: user.name, email: user.email || email }
        ) || getEmailLocalPart(user.email || email) || "Customer";
      }
    }
    userName = userName || getEmailLocalPart(email) || "Customer";

    const itemsWithMedia = await Promise.all(
      items.map(async (item) => {
        const product = await Product.findById(item.productId);

        return {
          productId: item.productId,
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          media:
            product?.media?.map((m) => ({
              ...m,
              url: processMediaUrl(m.url),
            })) || [],
          category: product?.category || "",
          description: product?.description || "",
        };
      })
    );

    const order = new Order({
      userId,
      userEmail: email,
      userName,
      email,
      items: itemsWithMedia,
      address,
      phone,
      totalAmount,
      razorpayOrderId: razorpay_order_id,
      isGuest,
      paymentMethod: "online",
      paymentInfo: {
        paymentId: razorpay_payment_id,
        amount: totalAmount,
        status: "captured",
      },
      status: "Pending",
    });

    const savedOrder = await order.save();

    const emailSent = await sendOrderConfirmationEmail(
      savedOrder,
      email
    );

    if (emailSent) {
      savedOrder.emailSent = true;
      savedOrder.emailSentAt = new Date();
      await savedOrder.save();
    }

    res.status(201).json({
      success: true,
      message: "Order placed successfully",
      order: savedOrder,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Payment verification failed",
      error: error.message,
    });
  }
};

// ================= GET ALL ORDERS =================

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find()
      .populate("userId", "name email")
      .populate({
        path: "items.productId",
        model: "Product",
      })
      .sort({ createdAt: -1 })
      .lean();

    const processedOrders = orders.map((order) => {
      order.items = order.items.map((item) => {
        if (item.media?.length > 0) {
          item.media = item.media.map((m) => ({
            ...m,
            url: processMediaUrl(m.url),
          }));
        }

        return item;
      });

      return order;
    });

    res.status(200).json({
      success: true,
      orders: processedOrders,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

// ================= GET USER ORDERS =================

exports.getUserOrders = async (req, res) => {
  try {
    const { userId } = req.params;

    const orders = await Order.find({ userId })
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch user orders",
    });
  }
};

// ================= GET ORDERS BY EMAIL =================

exports.getOrdersByEmail = async (req, res) => {
  try {
    const { email } = req.params;

    const orders = await Order.find({
      $or: [
        { email: { $regex: new RegExp(`^${email}$`, "i") } },
        { userEmail: { $regex: new RegExp(`^${email}$`, "i") } },
      ],
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      orders,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
    });
  }
};

// ================= UPDATE ORDER STATUS =================

exports.updateOrderStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status, cancelReason } = req.body;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    order.status = status;

    if (status === "Cancelled") {
      order.cancelReason = cancelReason || "Cancelled by admin";
      order.cancelledAt = new Date();
      order.cancelledBy = "admin";
    }

    await order.save();

    res.status(200).json({
      success: true,
      message: "Order status updated",
      order,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to update order status",
    });
  }
};

// ================= DELETE ORDER =================

exports.deleteOrder = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    await Order.findByIdAndDelete(orderId);

    res.status(200).json({
      success: true,
      message: "Order deleted successfully",
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to delete order",
    });
  }
};

// ================= BULK DELETE =================

exports.bulkDeleteOrders = async (req, res) => {
  try {
    const { orderIds } = req.body;

    if (!Array.isArray(orderIds)) {
      return res.status(400).json({
        success: false,
        message: "Order IDs array required",
      });
    }

    const result = await Order.deleteMany({
      _id: { $in: orderIds },
    });

    res.status(200).json({
      success: true,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Bulk delete failed",
    });
  }
};

// ================= TOTAL ORDER COUNT =================

exports.totalOrderCount = async (req, res) => {
  try {
    const totalOrders = await Order.countDocuments();

    res.status(200).json({
      success: true,
      totalOrders,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: "Failed to count orders",
    });
  }
};
