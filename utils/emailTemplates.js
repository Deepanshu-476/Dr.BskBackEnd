/**
 * Email HTML templates for Dr BSK Healthcare
 */

const getBrandHeader = () => `
  <div style="background: linear-gradient(135deg, #8a1f24 0%, #5c1115 100%); padding: 35px 20px; text-align: center; border-top-left-radius: 12px; border-top-right-radius: 12px;">
    <h1 style="color: #ffffff; margin: 0; font-family: 'Georgia', serif; font-size: 28px; font-weight: 700; letter-spacing: 1px;">Dr BSK Healthcare</h1>
    <p style="color: #f3e8ff; margin: 5px 0 0; font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; opacity: 0.9; text-transform: uppercase; letter-spacing: 2px;">Premium Wellness Delivered</p>
  </div>
`;

const getBrandFooter = () => `
  <div style="background-color: #f8fafc; padding: 25px 20px; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; border-top: 1px solid #eef2f6; text-align: center; font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #64748b;">
    <p style="margin: 0 0 10px 0; font-weight: 600; color: #334155;">Need assistance? We are here to help!</p>
    <p style="margin: 0 0 15px 0;">
      📧 Email: <a href="mailto:drbskhealthcare@gmail.com" style="color: #8a1f24; text-decoration: none; font-weight: 500;">drbskhealthcare@gmail.com</a> | 
      📞 Phone: <a href="tel:+919115513759" style="color: #8a1f24; text-decoration: none; font-weight: 500;">+91-9115513759</a>
    </p>
    <div style="margin: 20px 0; border-top: 1px dashed #e2e8f0;"></div>
    <p style="margin: 0 0 5px 0; font-size: 11px;">&copy; ${new Date().getFullYear()} Dr BSK Healthcare. All rights reserved.</p>
    <p style="margin: 0; font-size: 10px; color: #94a3b8;">This is an automated operational notification. Please do not reply directly.</p>
  </div>
`;

/**
 * Generate premium OTP email template
 */
const getOtpTemplate = (otp) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login Verification OTP</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    ${getBrandHeader()}
    
    <div style="padding: 40px 30px; text-align: center;">
      <h2 style="color: #1e293b; margin-top: 0; font-size: 22px; font-weight: 700;">Login Verification Code</h2>
      <p style="color: #475569; font-size: 15px; margin-bottom: 30px;">Use the following Single-Use Password (OTP) to securely log in to your account. This code is valid for <strong>10 minutes</strong>.</p>
      
      <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border: 2px dashed #b38b4d; padding: 20px; border-radius: 8px; font-size: 32px; font-weight: 700; color: #8a1f24; letter-spacing: 8px; display: inline-block; min-width: 200px; margin-bottom: 30px; font-family: monospace;">
        ${otp}
      </div>
      
      <p style="color: #64748b; font-size: 13px; margin: 0;">If you did not request this login attempt, you can safely ignore this email.</p>
    </div>
    
    ${getBrandFooter()}
  </div>
</body>
</html>
`;

/**
 * Generate customer order confirmation email template
 */
const getCustomerOrderTemplate = (order, userDetails, newUserDetails = null) => {
  const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;
  
  let accountBannerHtml = '';
  if (newUserDetails && newUserDetails.isNew) {
    accountBannerHtml = `
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-left: 5px solid #166534; padding: 20px; border-radius: 8px; margin-bottom: 25px; font-family: 'Segoe UI', Arial, sans-serif;">
        <h3 style="margin: 0 0 10px 0; color: #15803d; font-size: 16px; font-weight: 700;">🔑 Your BSK Account Has Been Created!</h3>
        <p style="margin: 0 0 12px 0; color: #166534; font-size: 14px;">We created an account for you using your delivery email. You can use these credentials to log in, track your packages, and manage your health dashboard:</p>
        <div style="background-color: #ffffff; padding: 12px 15px; border-radius: 6px; border: 1px solid #dcfce7; display: inline-block;">
          <span style="color: #475569; font-size: 13px;">Username / Email:</span> <strong style="font-family: monospace; color: #1e293b;">${userDetails.email}</strong><br>
          <span style="color: #475569; font-size: 13px;">Temporary Password:</span> <strong style="font-family: monospace; color: #1e293b;">${newUserDetails.password}</strong>
        </div>
        <p style="margin: 12px 0 0 0; font-size: 12px; color: #166534; font-style: italic;">💡 Tip: We highly recommend changing this temporary password after logging in for the first time.</p>
      </div>
    `;
  } else {
    accountBannerHtml = `
      <div style="background-color: #eff6ff; border: 1px solid #bfdbfe; border-left: 5px solid #1d4ed8; padding: 20px; border-radius: 8px; margin-bottom: 25px; font-family: 'Segoe UI', Arial, sans-serif;">
        <h3 style="margin: 0 0 8px 0; color: #1e40af; font-size: 16px; font-weight: 700;">👤 Order Linked to Your Account</h3>
        <p style="margin: 0; color: #1e40af; font-size: 14px;">This order is successfully linked to your registered profile (<strong>${userDetails.email}</strong>). Log in anytime to check shipment status.</p>
      </div>
    `;
  }

  const itemsHtml = order.items.map(item => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 12px 0; font-size: 14px; color: #1e293b; font-weight: 500;">${item.name}</td>
      <td style="padding: 12px 0; font-size: 14px; color: #64748b; text-align: center;">${item.quantity}</td>
      <td style="padding: 12px 0; font-size: 14px; color: #64748b; text-align: right;">₹${parseFloat(item.price).toFixed(2)}</td>
      <td style="padding: 12px 0; font-size: 14px; color: #1e293b; text-align: right; font-weight: 600;">₹${(parseFloat(item.price) * parseInt(item.quantity)).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation #${displayOrderId}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    ${getBrandHeader()}
    
    <div style="padding: 30px;">
      <div style="text-align: center; margin-bottom: 25px;">
        <h2 style="color: #1e293b; margin: 0 0 5px 0; font-size: 24px; font-weight: 700;">🎉 Order Confirmed!</h2>
        <p style="color: #64748b; margin: 0; font-size: 14px;">Thank you for your purchase. We are preparing your order.</p>
      </div>

      ${accountBannerHtml}

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">Order Details</h3>
        
        <table style="width: 100%; font-size: 14px; border-spacing: 0 8px;">
          <tr>
            <td style="color: #64748b; font-weight: 500;">Order ID:</td>
            <td style="color: #1e293b; font-weight: 700; font-family: monospace; text-align: right;">${displayOrderId}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">Date:</td>
            <td style="color: #1e293b; font-weight: 600; text-align: right;">${new Date(order.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">Payment Mode:</td>
            <td style="color: #1e293b; font-weight: 600; text-align: right;">${order.paymentMethod || 'Online'}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 25px;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px;">📦 Delivery Address</h3>
        <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">
          <strong>${order.userName || userDetails.name || 'Customer'}</strong><br>
          ${order.address}<br>
          📞 Phone: ${order.phone}<br>
          📧 Email: ${userDetails.email}
        </p>
      </div>

      <div style="margin-bottom: 25px;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Purchase Items</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #cbd5e1; text-align: left;">
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700;">Item</th>
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700; text-align: center; width: 60px;">Qty</th>
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700; text-align: right; width: 80px;">Price</th>
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700; text-align: right; width: 100px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
            <tr style="background-color: #f8fafc; font-weight: bold;">
              <td colspan="3" style="padding: 15px; text-align: right; font-size: 14px; color: #334155; border-top: 2px solid #cbd5e1;">Grand Total:</td>
              <td style="padding: 15px 0; text-align: right; font-size: 18px; color: #8a1f24; border-top: 2px solid #cbd5e1;">₹${parseFloat(order.totalAmount).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    
    ${getBrandFooter()}
  </div>
</body>
</html>
`;
};

/**
 * Generate owner order notification email template
 */
const getOwnerOrderTemplate = (order, userDetails) => {
  const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;

  const itemsHtml = order.items.map(item => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 0; font-size: 14px; color: #1e293b;">${item.name}</td>
      <td style="padding: 10px 0; font-size: 14px; color: #475569; text-align: center;">${item.quantity}</td>
      <td style="padding: 10px 0; font-size: 14px; color: #475569; text-align: right;">₹${parseFloat(item.price).toFixed(2)}</td>
      <td style="padding: 10px 0; font-size: 14px; color: #1e293b; text-align: right; font-weight: 600;">₹${(parseFloat(item.price) * parseInt(item.quantity)).toFixed(2)}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Order Alert #${displayOrderId}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    <div style="background: #1e293b; padding: 25px 20px; text-align: center; border-top-left-radius: 12px; border-top-right-radius: 12px;">
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px;">🔔 BSK System Alert</h1>
      <p style="color: #cbd5e1; margin: 5px 0 0; font-size: 13px;">New Order Received Successfully</p>
    </div>
    
    <div style="padding: 30px;">
      <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 5px solid #d97706; padding: 15px; border-radius: 8px; margin-bottom: 25px; font-size: 14px; color: #b45309;">
        A new order has been created on the website. Please process and prepare shipping waybill.
      </div>

      <div style="margin-bottom: 25px;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px;">Order Specs</h3>
        <table style="width: 100%; font-size: 14px; border-spacing: 0 8px;">
          <tr>
            <td style="color: #64748b; font-weight: 500;">Order ID:</td>
            <td style="color: #1e293b; font-weight: 700; font-family: monospace; text-align: right;">${displayOrderId}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">Amount Total:</td>
            <td style="color: #8a1f24; font-weight: 700; text-align: right; font-size: 16px;">₹${parseFloat(order.totalAmount).toFixed(2)}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">Payment Gateway:</td>
            <td style="color: #1e293b; font-weight: 600; text-align: right;">${order.paymentMethod || 'Online'}</td>
          </tr>
        </table>
      </div>

      <div style="margin-bottom: 25px; background-color: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">Customer Details</h3>
        <p style="margin: 0; font-size: 14px; color: #334155; line-height: 1.5;">
          <strong>Name:</strong> ${order.userName || userDetails.name || 'Customer'}<br>
          <strong>Email:</strong> ${userDetails.email}<br>
          <strong>Phone:</strong> ${order.phone}<br>
          <strong>Delivery Address:</strong><br>${order.address}
        </p>
      </div>

      <div>
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Order Items</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="border-bottom: 2px solid #cbd5e1; text-align: left;">
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700;">Product</th>
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700; text-align: center; width: 60px;">Qty</th>
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700; text-align: right; width: 80px;">Price</th>
              <th style="padding: 8px 0; font-size: 13px; color: #475569; font-weight: 700; text-align: right; width: 100px;">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>
      </div>
    </div>
    
    <div style="background-color: #f8fafc; padding: 20px; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; border-top: 1px solid #eef2f6; text-align: center; font-size: 12px; color: #64748b; font-family: sans-serif;">
      <p style="margin: 0;">Automated System Alert - Dr BSK Healthcare Portal</p>
    </div>
  </div>
</body>
</html>
`;
};

/**
 * Generate order status update email template
 */
const getStatusUpdateTemplate = (order, userDetails, statusText, statusDescription, statusColor) => {
  const displayOrderId = order.orderId || `BSK-O-${String(order._id).slice(-8).toUpperCase()}`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Status Update #${displayOrderId}</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    ${getBrandHeader()}
    
    <div style="padding: 30px;">
      <div style="text-align: center; margin-bottom: 25px;">
        <h2 style="color: #1e293b; margin: 0 0 5px 0; font-size: 24px; font-weight: 700;">📦 Shipment Status Update</h2>
        <p style="color: #64748b; margin: 0; font-size: 14px;">Your order #${displayOrderId} has a new update</p>
      </div>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-left: 5px solid ${statusColor}; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
        <div style="display: inline-block; padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; color: #ffffff; background-color: ${statusColor}; text-transform: uppercase; margin-bottom: 10px;">
          ${statusText}
        </div>
        <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: #1e293b;">Status Changed to: ${statusText}</h3>
        <p style="margin: 0; font-size: 14px; color: #475569; line-height: 1.5;">${statusDescription}</p>
      </div>

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; border: 1px solid #e2e8f0;">
        <h3 style="margin-top: 0; color: #1e293b; font-size: 15px; font-weight: 700; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">Order Snapshot</h3>
        <table style="width: 100%; font-size: 14px; border-spacing: 0 8px;">
          <tr>
            <td style="color: #64748b; font-weight: 500;">Order ID:</td>
            <td style="color: #1e293b; font-weight: 700; font-family: monospace; text-align: right;">${displayOrderId}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">Payment Mode:</td>
            <td style="color: #1e293b; font-weight: 600; text-align: right;">${order.paymentMethod || 'Online'}</td>
          </tr>
          <tr>
            <td style="color: #64748b; font-weight: 500;">Grand Total:</td>
            <td style="color: #8a1f24; font-weight: 700; text-align: right;">₹${parseFloat(order.totalAmount).toFixed(2)}</td>
          </tr>
        </table>
      </div>
    </div>
    
    ${getBrandFooter()}
  </div>
</body>
</html>
`;
};

module.exports = {
  getOtpTemplate,
  getCustomerOrderTemplate,
  getOwnerOrderTemplate,
  getStatusUpdateTemplate
};
