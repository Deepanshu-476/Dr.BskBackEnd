const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const Product = require("../models/product");

const frontendNodeModules = path.resolve(__dirname, "../../Dr.BskFrontEnd/node_modules");
const { jsPDF } = require(path.join(frontendNodeModules, "jspdf"));
const { autoTable } = require(path.join(frontendNodeModules, "jspdf-autotable"));

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE_URL = "https://drbskhealthcare.com";
const outputPath = path.resolve(__dirname, "../../all-products-details.pdf");
const productUploadsDir = path.resolve(__dirname, "../uploads/products");
const imageCache = new Map();

const fieldLabels = [
  ["publicId", "Product Public ID"],
  ["name", "Name"],
  ["category", "Category"],
  ["sub_category", "Sub Category"],
  ["productvariety", "Product Variety"],
  ["allPrices", "Prices"],
  ["description", "Description"],
  ["benefits", "Benefits"],
  ["dosage", "Dosage"],
  ["suitable_for", "Suitable For"],
  ["side_effects", "Side Effects"],
  ["prescription", "Prescription"],
  ["stock", "Stock"],
  ["expires_on", "Expires On"],
];

const cleanText = (value) => {
  if (value === undefined || value === null || value === "") return "-";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "-";
};

const parseMaybeJson = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!/^[\[{]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const normalizeQuantityItems = (quantity) => {
  const parsed = parseMaybeJson(quantity);
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    const parsedItem = parseMaybeJson(item);
    if (Array.isArray(parsedItem)) return parsedItem;
    return [parsedItem];
  });
};

const priceValue = (value) => {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value).trim();
  return text ? `Rs. ${text.replace(/^rs\.?\s*/i, "")}` : "";
};

const formatProductPrices = (product) => {
  const directParts = [
    product.mrp ? `MRP: ${priceValue(product.mrp)}` : "",
    product.retail_price ? `Retail: ${priceValue(product.retail_price)}` : "",
    product.consumer_price ? `Consumer: ${priceValue(product.consumer_price)}` : "",
    product.discount ? `Discount: ${product.discount}%` : "",
    product.gst ? `GST: ${product.gst}%` : "",
  ].filter(Boolean);

  const variants = normalizeQuantityItems(product.quantity);
  const variantLines = variants
    .map((item, index) => {
      if (!item || typeof item !== "object") return "";

      const label = item.label || item.quantity || item.name || item.size || item.variant || `Variant ${index + 1}`;
      const parts = [
        label,
        item.mrp ? `MRP: ${priceValue(item.mrp)}` : "",
        item.retail_price ? `Retail: ${priceValue(item.retail_price)}` : "",
        item.consumer_price ? `Consumer: ${priceValue(item.consumer_price)}` : "",
        item.final_price ? `Final: ${priceValue(item.final_price)}` : "",
        item.price ? `Price: ${priceValue(item.price)}` : "",
        item.selling_price ? `Selling: ${priceValue(item.selling_price)}` : "",
        item.discount_price ? `Discount Price: ${priceValue(item.discount_price)}` : "",
        item.discount ? `Discount: ${item.discount}%` : "",
        item.gst ? `GST: ${item.gst}%` : "",
        item.in_stock ? `Stock: ${item.in_stock}` : "",
      ].filter(Boolean);

      return `${index + 1}. ${parts.join(" | ")}`;
    })
    .filter(Boolean);

  return [...directParts, ...variantLines].join("\n") || "-";
};

const mediaUrl = (item) => {
  const url = item && item.url ? String(item.url) : "";
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `${BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
};

const imageFormatFromPath = (filePath) => {
  const extension = path.extname(filePath).toLowerCase();
  if ([".jpg", ".jpeg", ".jfif"].includes(extension)) return "JPEG";
  if (extension === ".png") return "PNG";
  if (extension === ".webp") return "WEBP";
  return null;
};

const imageFormatFromResponse = (url, contentType = "") => {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "JPEG";
  if (contentType.includes("png")) return "PNG";
  if (contentType.includes("webp")) return "WEBP";
  return imageFormatFromPath(url);
};

const toDataUri = (buffer, format) => {
  const mime = format === "JPEG" ? "image/jpeg" : `image/${format.toLowerCase()}`;
  return `data:${mime};base64,${buffer.toString("base64")}`;
};

const localMediaPath = (item) => {
  const url = item && item.url ? String(item.url) : "";
  const fileName = path.basename(url.split("?")[0]);
  if (!fileName) return "";
  return path.join(productUploadsDir, fileName);
};

const getPrimaryProductImage = (product) => {
  const media = Array.isArray(product.media) ? product.media : [];
  const image = media.find((item) => item && item.type === "image" && item.url) || media.find((item) => item && item.url);
  if (!image) return null;

  const filePath = localMediaPath(image);
  if (filePath && fs.existsSync(filePath)) {
    const format = imageFormatFromPath(filePath);
    if (format) {
      return {
        dataUri: toDataUri(fs.readFileSync(filePath), format),
        format,
        source: mediaUrl(image),
      };
    }
  }

  if (process.env.INCLUDE_REMOTE_PRODUCT_IMAGES === "1") {
    return {
      source: mediaUrl(image),
    };
  }

  return null;
};

const downloadImage = async (url) => {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "DR-BSK-PDF-Generator/1.0" },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") || "";
    const format = imageFormatFromResponse(url, contentType);
    if (!format) return null;

    const arrayBuffer = await response.arrayBuffer();
    const result = {
      dataUri: toDataUri(Buffer.from(arrayBuffer), format),
      format,
      source: url,
    };
    imageCache.set(url, result);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const drawProductImage = async (doc, product) => {
  const localImage = getPrimaryProductImage(product);
  const image = localImage && localImage.dataUri ? localImage : await downloadImage(localImage && localImage.source);
  const x = 148;
  const y = 24;
  const boxSize = 48;

  doc.setDrawColor(215);
  doc.setFillColor(248, 250, 248);
  doc.roundedRect(x, y, boxSize, boxSize, 2, 2, "FD");

  if (!image) {
    return "";
  }

  try {
    const properties = doc.getImageProperties(image.dataUri);
    const ratio = Math.min((boxSize - 4) / properties.width, (boxSize - 4) / properties.height);
    const width = properties.width * ratio;
    const height = properties.height * ratio;
    doc.addImage(image.dataUri, image.format, x + (boxSize - width) / 2, y + (boxSize - height) / 2, width, height);
    return image.source;
  } catch (error) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(130);
    return "";
  }
};

const formatQuantity = (quantity) => {
  const quantityItems = normalizeQuantityItems(quantity);
  if (quantityItems.length === 0) return "-";
  return quantityItems
    .map((item, index) => {
      if (!item || typeof item !== "object") return `${index + 1}. ${cleanText(item)}`;
      const parts = Object.entries(item)
        .filter(([, value]) => value !== undefined && value !== null && value !== "")
        .map(([key, value]) => `${key}: ${cleanText(value)}`);
      return `${index + 1}. ${parts.join(" | ")}`;
    })
    .join("\n");
};

const formatMedia = (media) => {
  if (!Array.isArray(media) || media.length === 0) return "-";
  return media
    .map((item, index) => {
      const bits = [
        item.type ? `type: ${item.type}` : "",
        item.name ? `name: ${item.name}` : "",
        mediaUrl(item),
      ].filter(Boolean);
      return `${index + 1}. ${bits.join(" | ")}`;
    })
    .join("\n");
};

const addFooter = (doc) => {
  const pageCount = doc.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Page ${page} of ${pageCount}`, 200, 287, { align: "right" });
    doc.text("DR BSK Healthcare - Product Details", 14, 287);
  }
};

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is missing in Dr.BskBackEnd/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const products = await Product.find({
    deleted_at: null,
    category: { $ne: null },
  })
    .sort({ name: 1 })
    .lean();

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setProperties({
    title: "DR BSK Healthcare Product Details",
    subject: "All product details from DR BSK Healthcare",
    creator: "DR BSK Healthcare",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("DR BSK Healthcare", 14, 20);
  doc.setFontSize(15);
  doc.text("All Product Details", 14, 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, 14, 40);
  doc.text(`Total products: ${products.length}`, 14, 47);
  doc.text(`Source: MongoDB products collection, active website products only`, 14, 54);

  autoTable(doc, {
    startY: 64,
    head: [["#", "Product", "Category", "Prices", "Stock"]],
    body: products.map((product, index) => [
      index + 1,
      cleanText(product.name),
      cleanText(product.category),
      formatProductPrices(product),
      cleanText(product.stock),
    ]),
    styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak" },
    headStyles: { fillColor: [28, 105, 78], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 12 },
      1: { cellWidth: 58 },
      2: { cellWidth: 34 },
      3: { cellWidth: 62 },
      4: { cellWidth: 20 },
    },
  });

  for (const [index, product] of products.entries()) {
    doc.addPage();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(20);
    doc.text(`${index + 1}. ${cleanText(product.name)}`, 14, 18, { maxWidth: 180 });

    await drawProductImage(doc, product);

    const rows = fieldLabels.map(([key, label]) => [
      label,
      key === "allPrices" ? formatProductPrices(product) : cleanText(product[key]),
    ]);
    rows.push(["Quantity / Variants", formatQuantity(product.quantity)]);

    autoTable(doc, {
      startY: 26,
      body: rows,
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 2, overflow: "linebreak", valign: "top" },
      columnStyles: {
        0: { cellWidth: 42, fontStyle: "bold", fillColor: [242, 247, 244] },
        1: { cellWidth: 86 },
      },
      margin: { left: 14, right: 68, bottom: 14 },
    });
  }

  addFooter(doc);

  const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
  fs.writeFileSync(outputPath, pdfBuffer);

  await mongoose.disconnect();
  console.log(`Generated ${outputPath}`);
  console.log(`Products included: ${products.length}`);
}

main().catch(async (error) => {
  await mongoose.disconnect().catch(() => {});
  console.error(error.message);
  process.exit(1);
});
