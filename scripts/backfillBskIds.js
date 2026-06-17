require("dotenv").config();

const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const Admin = require("../models/admin");
const Banner = require("../models/banner");
const Category = require("../models/category");
const Coupon = require("../models/Coupon");
const NewArrival = require("../models/newarrival");
const Order = require("../models/order");
const Prescription = require("../models/prescription");
const Product = require("../models/product");
const SubCategory = require("../models/subCategory");
const Support = require("../models/support");
const Wholesale = require("../models/wholeSale");

const targets = [
  { model: Product, field: "publicId", prefix: "P", name: "products" },
  { model: Order, field: "orderId", prefix: "O", name: "orders" },
  { model: Banner, field: "publicId", prefix: "BN", name: "banners" },
  { model: Prescription, field: "publicId", prefix: "RX", name: "prescriptions" },
  { model: Category, field: "publicId", prefix: "CAT", name: "categories" },
  { model: SubCategory, field: "publicId", prefix: "SCAT", name: "subcategories" },
  { model: Admin, field: "publicId", prefix: "U", name: "users" },
  { model: Wholesale, field: "publicId", prefix: "WS", name: "wholesale partners" },
  { model: Support, field: "publicId", prefix: "SUP", name: "support tickets" },
  { model: NewArrival, field: "publicId", prefix: "NA", name: "new arrivals" },
  { model: Coupon, field: "publicId", prefix: "CPN", name: "coupons" },
];

const assignBskIds = async ({ model, field, prefix, name }) => {
  const docs = await model.find({
    $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }],
  }).select("_id").lean();

  let updated = 0;

  for (const doc of docs) {
    let saved = false;

    for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
      try {
        await model.updateOne(
          { _id: doc._id, $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: "" }] },
          { $set: { [field]: generateBskId(prefix) } }
        );
        updated += 1;
        saved = true;
      } catch (error) {
        if (error?.code !== 11000 || attempt === 4) throw error;
      }
    }
  }

  console.log(`${name}: ${updated} updated`);
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  for (const target of targets) {
    await assignBskIds(target);
  }

  await mongoose.disconnect();
  console.log("BSK ID backfill complete");
};

run().catch(async (error) => {
  console.error("BSK ID backfill failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
