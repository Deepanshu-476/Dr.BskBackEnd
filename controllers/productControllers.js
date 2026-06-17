const Product = require("../models/product");
const { logger } = require("../utils/logger");
const BASE_URL = "https://drbskhealthcare.com";

const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, "../uploads/products");
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
    cb(null, uniqueSuffix + "-" + safeName);
  },
});

const mediaFileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/")) {
    cb(null, true);
    return;
  }
  cb(new Error("Only image and video files are allowed"), false);
};

exports.upload = multer({
  storage,
  fileFilter: mediaFileFilter,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 10,
  },
});

exports.handleUploadError = (error, req, res, next) => {
  if (!error) {
    next();
    return;
  }

  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: "Each media file must be 25MB or smaller",
      LIMIT_FILE_COUNT: "You can upload up to 10 media files per product",
      LIMIT_UNEXPECTED_FILE: "Only product media files are allowed in this upload",
    };
    res.status(400).json({ message: messages[error.code] || error.message });
    return;
  }

  res.status(400).json({ message: error.message });
};

const parseQuantity = (quantity) => {
  if (!quantity) return [];
  if (Array.isArray(quantity)) return quantity;
  try {
    const parsed = JSON.parse(quantity);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
};

const normalizeExistingMediaUrl = (url = "") => {
  if (!url) return "";
  return url
    .replace(BASE_URL, "")
    .replace(/^https?:\/\/[^/]+/, "");
};

// Create a new product
// const path = require("path");

exports.createProduct = async (req, res) => {
  try {
    const mediaFiles = (Array.isArray(req.files) ? req.files : Object.values(req.files || {})).map(file => ({
      url: `/uploads/products/${file.filename}`,
      type: file.mimetype.startsWith("video") ? "video" : "image",
      name: file.originalname,
      size: file.size
    }));

    let slug = slugify(req.body.name);

// duplicate slug fix
    const existing = await Product.findOne({ slug });
    if (existing) {
      slug = slug + "-" + Date.now();
    }

    const productData = {
      ...req.body,
      slug,
      media: mediaFiles,
      quantity: parseQuantity(req.body.quantity)
    };

    const product = new Product(productData);
    const savedProduct = await product.save();

    logger.info(`Product created: ${savedProduct._id}`);
    res.status(201).json(savedProduct);
  } catch (error) {
    logger.error("Error creating product:", error);
    res.status(400).json({ message: error.message });
  }
};
const slugify = (text) => {
  return text
    .toLowerCase()
    .trim()
    .replace(/[()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

// Get all products
exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.find({
        deleted_at: null,
        category: { $ne: null }
      });

    logger.info(`Fetched ${products.length} products`);
    res.status(200).json(products);
  } catch (error) {
    logger.error("Error fetching all products:", error);
    res.status(500).json({ message: error.message });
  }
};

const escapeXML = (str = "") => {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};


exports.getAllProductsXML = async (req, res) => {
  try {
   const products = await Product.find({
      deleted_at: null,
      category: { $ne: null }   // ✅ ye add karo
    })
    .populate("category")
    .populate("sub_category");

let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
<title>DR BSK Healthcare</title>
<link>https://drbskhealthcare.com/</link>
<description>Product Feed</description>
`;

products.forEach(p => {
  const feedProductId = p.publicId || `BSK-P-${String(p._id).slice(-8).toUpperCase()}`;


let variants = [];

try {
  if (Array.isArray(p.quantity)) {
    variants = p.quantity;
  } else if (typeof p.quantity === "string") {
    variants = JSON.parse(p.quantity);
  }
} catch {
  variants = [];
}

let variantPrice = null;

for (let v of variants) {
  if (
    v?.final_price ||
    v?.retail_price ||
    v?.price ||
    v?.selling_price ||
    v?.discount_price
  ) {
    variantPrice =
      v.final_price ||
      v.retail_price ||
      v.price ||
      v.selling_price ||
      v.discount_price;

    break;
  }
}

  const price = Number(
  variantPrice ||
  p.final_price ||
  p.consumer_price ||
  p.retail_price ||
  p.mrp ||
  0
).toFixed(2);

  let image = p.media?.[0]?.url || `${BASE_URL}/default.jpg`;
  image = encodeURI(image);
  if (image && !image.startsWith("http")) {
    image = BASE_URL + image;
  }

xml += `
<item>
  <g:id>${feedProductId}</g:id>
  <g:mpn>${feedProductId}</g:mpn>

  <g:title><![CDATA[${(p.name || "").trim()}]]></g:title>

  <g:description><![CDATA[${(p.description || "").trim().replace(/\s+/g, " ")}]]></g:description>

  <g:link>${BASE_URL}/#/ProductPage/${p.slug || p._id}</g:link>

  <g:image_link>${image}</g:image_link>

  <g:availability>${(p.stock === "yes" || p.stock === true) ? "in stock" : "out of stock"}</g:availability>

  <g:price>${price} INR</g:price>

    <g:shipping>
      <g:country>IN</g:country>
      <g:service>Standard</g:service>
     <g:price>${price} INR</g:price>
    </g:shipping>
  
  <g:brand>BSK</g:brand>

  <g:condition>new</g:condition>

  <g:identifier_exists>no</g:identifier_exists>

  <g:product_type>${escapeXML((p.category || "").trim())}</g:product_type>

  <g:google_product_category>
      ${escapeXML((p.category || "Health & Beauty").trim())}
    </g:google_product_category>

</item>
`;
});

xml += `
</channel>
</rss>
`;

res.set("Content-Type", "application/xml");
res.send(xml);

  } catch (error) {
    console.error("XML ERROR:", error);
    res.status(500).send(error.message);
  }
};

// Get a single product by ID
exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json(product);
  } catch (error) {
    console.error("GET PRODUCT ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};


// option 1:  Update a product
// exports.updateProduct = async (req, res) => {
//   try {
//     logger.info(`Request to update product ${req.params.id} with data: ${JSON.stringify(req.body)}`);

//     let slug = slugify(req.body.name);

//     const updatedProduct = await Product.findByIdAndUpdate(
//       req.params.id,
//       {
//         ...req.body,
//         slug,
//         quantity: req.body.quantity ? JSON.parse(req.body.quantity) : [],
//         updatedAt: Date.now()
//       }, // ✅ ADD slug
//       { new: true, runValidators: true }
//     );  

//     if (!updatedProduct) {
//       logger.warn(`Product not found for update: ${req.params.id}`);
//       return res.status(404).json({ message: "Product not found" });
//     }

//     logger.info(`Product updated: ${updatedProduct._id}`);
//     res.status(200).json(updatedProduct);
//   } catch (error) {
//     logger.error(`Error updating product (${req.params.id}):`, error);
//     res.status(400).json({ message: error.message });
//   }
// };

// option 2: with media
exports.updateProduct = async (req, res) => {
  try {
    const { existingMedia: existingMediaBody, quantity, ...body } = req.body;

    // Parse incoming form data
    const existingMedia = Array.isArray(existingMediaBody)
      ? existingMediaBody
      : existingMediaBody
        ? [existingMediaBody]
        : [];

    const newMedia = (Array.isArray(req.files) ? req.files : Object.values(req.files || {})).map(file => ({
      url: `/uploads/products/${file.filename}`,
      type: file.mimetype.startsWith("video") ? "video" : "image",
      name: file.originalname,
      size: file.size
    }));

    const mergedMedia = [
      ...existingMedia.map(url => {
        const normalizedUrl = normalizeExistingMediaUrl(url);
        return {
          url: normalizedUrl,
          type: normalizedUrl.match(/\.(mp4|webm|mov|avi|mkv)$/i) ? 'video' : 'image',
          name: path.basename(normalizedUrl),
          size: 0
        };
      }),
      ...newMedia
    ];

    let slug;
    if (body.name) {
      slug = slugify(body.name);
      const existing = await Product.findOne({ slug, _id: { $ne: req.params.id } });
      if (existing) {
        slug = slug + "-" + Date.now();
      }
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      {
        ...body,
        ...(slug ? { slug } : {}),
        media: mergedMedia,
        quantity: parseQuantity(quantity),
        updatedAt: Date.now()
      },
      { new: true, runValidators: true }
    );

    if (!updatedProduct) {
      logger.warn(`Product not found for update: ${req.params.id}`);
      return res.status(404).json({ message: "Product not found" });
    }

    logger.info(`Product updated: ${updatedProduct._id}`);
    res.status(200).json(updatedProduct);
  } catch (error) {
    logger.error(`Error updating product (${req.params.id}):`, error);
    res.status(400).json({ message: error.message });
  }
};


// Soft delete a product
exports.deleteProduct = async (req, res) => {
  try {
    const deletedProduct = await Product.findByIdAndDelete(req.params.id);

    if (!deletedProduct) {
      logger.warn(`Product not found for deletion: ${req.params.id}`);
      return res.status(404).json({ message: "Product not found" });
    }

    logger.info(`Product permanently deleted: ${deletedProduct._id}`);
    res.status(200).json({ message: "Product permanently deleted successfully" });
  } catch (error) {
    logger.error(`Error deleting product (${req.params.id}):`, error);
    res.status(500).json({ message: error.message });
  }
};
// Get all product images
exports.getAllProductImages = async (req, res) => {
  try {
    const products = await Product.find({ deleted_at: null }, 'media');

    const images = products.flatMap(product =>
      product.media.filter(file => file.type === 'image')
    );

    res.status(200).json(images);
  } catch (error) {
    logger.error("Error fetching product images:", error);
    res.status(500).json({ message: error.message });
  }
};

// Get total product count
exports.getProductCount = async (req, res) => {
  try {
    // Count products that are not deleted
    const count = await Product.countDocuments({ deleted_at: null });

    // Get only createdAt field for those products (exclude _id)
    const createdDates = await Product.find({ deleted_at: null }).select({ createdAt: 1, _id: 0 });

    logger.info(`Total product count: ${count}`);

    res.status(200).json({
      total: count,
      createdDates: createdDates,
    });
  } catch (error) {
    logger.error("Error fetching product count:", error);
    res.status(500).json({ message: error.message });
  }
};


// Search products by name and suggest similar products
exports.searchProducts = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ message: "Search query is required" });
    }

    // Search for products where name matches (case-insensitive, partial)
    const matchedProducts = await Product.find({
      name: { $regex: query, $options: "i" },
      deleted_at: null,
    }).populate("category").populate("sub_category");

    // Suggested products (excluding exact matches, showing similar ones)
    const suggestedProducts = await Product.find({
      name: { $regex: query.split(" ")[0], $options: "i" },
      _id: { $nin: matchedProducts.map(p => p._id) },
      deleted_at: null,
    }).limit(5); // Limit suggestions

    logger.info(`Search query: "${query}", Matches: ${matchedProducts.length}, Suggestions: ${suggestedProducts.length}`);

    res.status(200).json({
      results: matchedProducts,
      suggestions: suggestedProducts
    });
  } catch (error) {
    logger.error("Error searching products:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json(product);  
  } catch (error) {
    console.error("GET PRODUCT BY SLUG ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};
