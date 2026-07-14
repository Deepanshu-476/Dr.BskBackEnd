require("dotenv").config();
const mongoose = require("mongoose");
const Product = require("../models/product");

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

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing from environment variables");
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log(`Connected to MongoDB: ${mongoose.connection.host}`);

  const products = await Product.find({});
  console.log(`Found ${products.length} products to check.`);

  let updatedCount = 0;

  for (const product of products) {
    const rawQuantity = product.quantity;
    
    // Check if it is a character object array (first item is non-null object with "0" key)
    let needsMigration = false;
    if (Array.isArray(rawQuantity) && rawQuantity.length > 0) {
      const firstItem = rawQuantity[0];
      if (typeof firstItem === 'object' && firstItem !== null && firstItem["0"] !== undefined) {
        needsMigration = true;
      }
    } else if (typeof rawQuantity === 'object' && rawQuantity !== null && rawQuantity["0"] !== undefined) {
      needsMigration = true;
    }

    if (needsMigration) {
      console.log(`Migrating product: "${product.name}" (${product._id})`);
      const normalized = normalizeQuantity(rawQuantity);
      
      await Product.updateOne(
        { _id: product._id },
        { $set: { quantity: normalized } }
      );
      
      updatedCount++;
      console.log(`Successfully migrated quantity for: "${product.name}"`);
    }
  }

  await mongoose.disconnect();
  console.log(`Migration complete. ${updatedCount} products were updated.`);
};

run().catch(async (error) => {
  console.error("Migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
