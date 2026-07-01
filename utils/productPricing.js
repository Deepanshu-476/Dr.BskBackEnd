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
