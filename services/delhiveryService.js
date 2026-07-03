const axios = require('axios');

const getConfig = () => ({
  enabled: String(process.env.DELHIVERY_ENABLED || 'false').toLowerCase() === 'true',
  token: String(process.env.DELHIVERY_API_TOKEN || '').trim(),
  pickupLocation: String(process.env.DELHIVERY_PICKUP_LOCATION || '').trim(),
  baseUrl: String(process.env.DELHIVERY_BASE_URL || 'https://track.delhivery.com').replace(/\/+$/, ''),
  weight: Number(process.env.DELHIVERY_DEFAULT_WEIGHT_GRAMS || 500),
  length: Number(process.env.DELHIVERY_DEFAULT_LENGTH_CM || 20),
  width: Number(process.env.DELHIVERY_DEFAULT_WIDTH_CM || 15),
  height: Number(process.env.DELHIVERY_DEFAULT_HEIGHT_CM || 10),
  pickupTime: String(process.env.DELHIVERY_PICKUP_TIME || '16:00:00'),
  autoPickup: String(process.env.DELHIVERY_AUTO_PICKUP || 'true').toLowerCase() === 'true'
});

const headers = (token, contentType = 'application/json') => ({
  Authorization: `Token ${token}`,
  'Content-Type': contentType,
  Accept: 'application/json'
});

const clean = (value, maxLength = 500) => String(value || '')
  .replace(/[&#%;\\]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, maxLength);

const getPincode = (order) => {
  const structured = String(order.shippingAddress?.zipcode || '').trim();
  if (/^\d{6}$/.test(structured)) return structured;
  return String(order.address || '').match(/\b[1-9]\d{5}\b/)?.[0] || '';
};

const requireConfig = () => {
  const settings = getConfig();
  if (!settings.enabled) return settings;
  if (!settings.token || settings.token.includes('replace_with')) {
    throw new Error('DELHIVERY_API_TOKEN is not configured');
  }
  if (!settings.pickupLocation) {
    throw new Error('DELHIVERY_PICKUP_LOCATION is not configured');
  }
  return settings;
};

const checkServiceability = async (pincode, paymentMethod, settings) => {
  const response = await axios.get(`${settings.baseUrl}/c/api/pin-codes/json/`, {
    params: { filter_codes: pincode },
    headers: headers(settings.token),
    timeout: 15000
  });
  const postalCode = response.data?.delivery_codes?.[0]?.postal_code;
  if (!postalCode) throw new Error(`Delhivery does not service pincode ${pincode}`);

  const allowed = paymentMethod === 'cod'
    ? postalCode.cod === 'Y'
    : postalCode.pre_paid === 'Y';
  if (!allowed) {
    throw new Error(`Delhivery ${paymentMethod === 'cod' ? 'COD' : 'prepaid'} service is unavailable for ${pincode}`);
  }
};

const extractWaybill = (data) => {
  const packageResult = data?.packages?.[0] || data?.package || {};
  return String(packageResult.waybill || packageResult.wbn || data?.waybill || data?.upload_wbn || '').trim();
};

const createShipment = async (order) => {
  const settings = requireConfig();
  if (!settings.enabled) return { skipped: true, reason: 'Delhivery integration is disabled' };
  if (order.trackingNumber) return { skipped: true, waybill: order.trackingNumber };

  const pincode = getPincode(order);
  if (!pincode) throw new Error('Customer delivery pincode is missing');
  await checkServiceability(pincode, order.paymentMethod, settings);

  const quantity = order.items.reduce((total, item) => total + Number(item.quantity || 0), 0);
  const products = order.items.map((item) => `${item.name} x ${item.quantity}`).join(', ');
  const shipment = {
    name: clean(order.userName, 100),
    add: clean(order.address),
    pin: pincode,
    city: clean(order.shippingAddress?.city, 100),
    state: clean(order.shippingAddress?.state, 100),
    country: clean(order.shippingAddress?.country || 'India', 50),
    phone: String(order.phone || '').replace(/\D/g, '').slice(-10),
    order: clean(order.orderId || order._id, 100),
    payment_mode: order.paymentMethod === 'cod' ? 'COD' : 'Pre-paid',
    cod_amount: order.paymentMethod === 'cod' ? Number(order.totalAmount) : 0,
    total_amount: Number(order.totalAmount),
    products_desc: clean(products),
    quantity: Math.max(quantity, 1),
    weight: settings.weight,
    shipment_width: settings.width,
    shipment_height: settings.height,
    shipment_length: settings.length,
    shipping_mode: 'Surface',
    address_type: 'home'
  };

  const body = new URLSearchParams({
    format: 'json',
    data: JSON.stringify({
      shipments: [shipment],
      pickup_location: { name: settings.pickupLocation }
    })
  }).toString();

  const response = await axios.post(`${settings.baseUrl}/api/cmu/create.json`, body, {
    headers: headers(settings.token, 'application/x-www-form-urlencoded'),
    timeout: 20000
  });
  const waybill = extractWaybill(response.data);
  if (!waybill) {
    const remark = response.data?.packages?.[0]?.remarks?.[0] ||
      response.data?.packages?.[0]?.rmk ||
      response.data?.rmk ||
      response.data?.error ||
      'Delhivery did not return an AWB';
    throw new Error(clean(remark, 300));
  }
  return { waybill, response: response.data, settings };
};

const schedulePickup = async (settings) => {
  if (!settings.autoPickup) return { skipped: true };
  const pickupDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const response = await axios.post(`${settings.baseUrl}/fm/request/new/`, {
    pickup_time: settings.pickupTime,
    pickup_date: pickupDate,
    pickup_location: settings.pickupLocation,
    expected_package_count: 1
  }, {
    headers: headers(settings.token),
    timeout: 15000
  });
  return {
    pickupId: response.data?.pickup_id || response.data?.pr_exist || null,
    response: response.data
  };
};

const createShipmentAndPickup = async (order) => {
  const shipment = await createShipment(order);
  if (shipment.skipped) return shipment;

  let pickup = null;
  let pickupError = null;
  try {
    pickup = await schedulePickup(shipment.settings);
  } catch (error) {
    pickupError = error.response?.data?.error || error.response?.data?.detail || error.message;
  }
  return {
    waybill: shipment.waybill,
    pickupId: pickup?.pickupId || null,
    pickupError: pickupError ? clean(pickupError, 300) : null
  };
};

module.exports = { createShipmentAndPickup };
