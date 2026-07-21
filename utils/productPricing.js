const WholesalePartner = require("../models/wholeSale");

const firstPositivePrice = (...values) => {
  for (const value of values) {
    const price = Number(value);
    if (Number.isFinite(price) && price > 0) return price;
  }
  return 0;
};

const resolvePricingTier = async (user) => {
  if (user?.type === "admin") return "admin";
  if (user?.type !== "wholesalePartner" || !user.id) return "consumer";

  const partner = await WholesalePartner.findById(user.id).select("_id").lean();

  return partner ? "wholesale" : "consumer";
};

const reconstructStringFromObject = (obj) => {
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj) && obj["0"] !== undefined) {
    let s = "";
    for (let i = 0; obj[String(i)] !== undefined; i++) {
      s += obj[String(i)];
    }
    return s;
  }
  return null;
};

const normalizeQuantity = (raw) => {
  try {
    if (!raw) return [];
    
    const reconstructedRaw = reconstructStringFromObject(raw);
    if (reconstructedRaw !== null) {
      raw = reconstructedRaw;
    }
    
    let arr = [];
    if (Array.isArray(raw)) {
      if (raw.length > 0) {
        if (Array.isArray(raw[0])) {
          arr = raw.flat();
        } else {
          arr = raw;
        }
      }
      
      if (arr.length > 0 && typeof arr[0] === 'object' && arr[0] !== null && arr[0]["0"] !== undefined) {
        arr = arr.flatMap((item) => {
          const s = reconstructStringFromObject(item);
          if (s !== null) {
            try {
              const parsed = JSON.parse(s);
              return Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              return [];
            }
          }
          return [item];
        });
      }
      
      if (arr.length > 0 && typeof arr[0] === "string") {
        arr = arr.flatMap((item) => {
          try {
            const parsed = JSON.parse(item);
            return Array.isArray(parsed) ? parsed : [parsed];
          } catch (err) {
            return [];
          }
        });
      }
    } else if (typeof raw === "string") {
      try {
        arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0 && Array.isArray(arr[0])) {
          arr = arr.flat();
        }
      } catch {
        arr = [];
      }
    } else {
      arr = [];
    }
    
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (err) {
    console.error("Error normalizing quantity:", err);
    return [];
  }
};

const applyVariantPricing = (variant, product, pricingTier) => {
  if (pricingTier === "admin") return { ...variant };

  const wholesalePrice = firstPositivePrice(
    variant.retail_price,
    product.retail_price
  );
  const consumerPrice = firstPositivePrice(
    variant.final_price,
    variant.consumer_price,
    product.consumer_price,
    wholesalePrice
  );
  const effectivePrice =
    pricingTier === "wholesale" ? wholesalePrice : consumerPrice;

  return {
    ...variant,
    price: effectivePrice,
    effective_price: effectivePrice,
    final_price: effectivePrice,
    // Keeps older frontend screens on the backend-selected price.
    consumer_price: effectivePrice,
    retail_price: effectivePrice,
  };
};

const applyProductPricing = (product, pricingTier) => {
  const value =
    typeof product?.toObject === "function" ? product.toObject() : { ...product };

  value.quantity = normalizeQuantity(value.quantity);

  if (pricingTier === "admin") {
    return { ...value, pricing_tier: pricingTier };
  }

  const wholesalePrice = firstPositivePrice(value.retail_price);
  const consumerPrice = firstPositivePrice(
    value.consumer_price,
    value.final_price,
    wholesalePrice
  );
  const effectivePrice =
    pricingTier === "wholesale" ? wholesalePrice : consumerPrice;
  const variants = Array.isArray(value.quantity)
    ? value.quantity.map((variant) =>
        applyVariantPricing(variant, value, pricingTier)
      )
    : value.quantity;

  return {
    ...value,
    quantity: variants,
    price: effectivePrice,
    effective_price: effectivePrice,
    final_price: effectivePrice,
    consumer_price: effectivePrice,
    retail_price: effectivePrice,
    pricing_tier: pricingTier,
  };
};

module.exports = {
  applyProductPricing,
  resolvePricingTier,
};
