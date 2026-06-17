require("dotenv").config();

const mongoose = require("mongoose");
const Admin = require("../models/admin");
const Order = require("../models/order");
const { getEmailLocalPart, isUsefulCustomerName } = require("../utils/customerName");

const getProfileForOrder = async (order) => {
  const email = String(order.userEmail || order.email || "").toLowerCase();
  if (email) {
    const userByEmail = await Admin.findOne({ email }).select("name email").lean();
    if (userByEmail) return userByEmail;
  }

  const userId = String(order.userId || "");
  if (userId && !userId.startsWith("guest_") && /^[a-f\d]{24}$/i.test(userId)) {
    const user = await Admin.findById(userId).select("name email").lean();
    if (user && String(user.email || "").toLowerCase() === email) return user;
  }

  return null;
};

const getUserIdProfile = async (order) => {
  const userId = String(order.userId || "");
  if (!userId || userId.startsWith("guest_") || !/^[a-f\d]{24}$/i.test(userId)) return null;
  return Admin.findById(userId).select("name email").lean();
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  const orders = await Order.find({}).select("_id userId userName userEmail email").lean();
  let updated = 0;
  let profileNames = 0;
  let emailFallbacks = 0;

  for (const order of orders) {
    const email = order.userEmail || order.email || "";
    const currentName = String(order.userName || "").trim();
    const emailLocal = getEmailLocalPart(email);

    const profile = await getProfileForOrder(order);
    const idProfile = await getUserIdProfile(order);
    const currentLooksLikeWrongUserProfile =
      idProfile &&
      currentName &&
      currentName === idProfile.name &&
      String(idProfile.email || "").toLowerCase() !== String(email || "").toLowerCase();

    if (isUsefulCustomerName(currentName, email) && !currentLooksLikeWrongUserProfile) continue;

    const nextName = isUsefulCustomerName(profile?.name, profile?.email || email)
      ? profile.name.trim()
      : emailLocal || "Customer";

    if (nextName !== currentName || currentName === emailLocal) {
      await Order.updateOne({ _id: order._id }, { $set: { userName: nextName } });
      updated += 1;
      if (nextName === emailLocal || nextName === "Customer") emailFallbacks += 1;
      else profileNames += 1;
    }
  }

  await mongoose.disconnect();
  console.log(`Order names updated: ${updated}`);
  console.log(`Profile names used: ${profileNames}`);
  console.log(`Email fallback used: ${emailFallbacks}`);
};

run().catch(async (error) => {
  console.error("Order name backfill failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
