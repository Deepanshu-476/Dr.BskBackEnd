const Product = require("../models/product");
const { logger } = require("../utils/logger");
const {
  applyProductPricing,
  resolvePricingTier,
} = require("../utils/productPricing");
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

const parseQuantity = (quantity) => {
  return normalizeQuantity(quantity);
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
    const pricingTier = await resolvePricingTier(req.user);
    const products = await Product.find({
        deleted_at: null,
        category: { $ne: null }
      });

    logger.info(`Fetched ${products.length} products`);
    res.status(200).json(
      products.map((product) => applyProductPricing(product, pricingTier))
    );
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
    const pricingTier = await resolvePricingTier(req.user);
    const product = await Product.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json(applyProductPricing(product, pricingTier));
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
    const pricingTier = await resolvePricingTier(req.user);
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
      results: matchedProducts.map((product) =>
        applyProductPricing(product, pricingTier)
      ),
      suggestions: suggestedProducts.map((product) =>
        applyProductPricing(product, pricingTier)
      )
    });
  } catch (error) {
    logger.error("Error searching products:", error);
    res.status(500).json({ message: error.message });
  }
};

exports.getProductBySlug = async (req, res) => {
  try {
    const pricingTier = await resolvePricingTier(req.user);
    const product = await Product.findOne({ slug: req.params.slug });

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.status(200).json(applyProductPricing(product, pricingTier));
  } catch (error) {
    console.error("GET PRODUCT BY SLUG ERROR:", error);
    res.status(500).json({ message: error.message });
  }
};

// Serve HTML Product landing page for deferred deep linking fallback
exports.serveProductLandingPage = async (req, res) => {
  try {
    const productId = req.params.id;
    
    // Check if productId is a valid MongoDB ObjectId
    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(404).send('<h3>Invalid Product ID</h3>');
    }

    const product = await Product.findById(productId);
    if (!product || product.deleted_at !== null) {
      return res.status(404).send('<h3>Product not found</h3>');
    }

    // Load templates/product-share.html
    const templatePath = path.join(__dirname, '../templates/product-share.html');
    if (!fs.existsSync(templatePath)) {
      return res.status(500).send('<h3>Server Error: Share template not found</h3>');
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    // Get config variables
    const baseUrl = process.env.BASE_URL || 'https://drbskhealthcare.com';
    const androidUrl = process.env.ANDROID_APP_URL || 'https://play.google.com/store/apps/details?id=com.cupid_cakes';
    const iosUrl = process.env.IOS_APP_URL || 'https://apps.apple.com/app/id644476000';
    const scheme = process.env.DEEP_LINK_SCHEME || 'drbsk';

    // Parse product details
    const productName = product.name || 'DR.BSK Product';
    
    // Get product price
    const priceVal = product.consumer_price || product.retail_price || product.mrp || '0.00';
    
    // Get media image URL
    let imageUrl = '';
    if (product.media && product.media.length > 0) {
      const mediaItem = product.media[0];
      if (mediaItem.url) {
        if (mediaItem.url.startsWith('http://') || mediaItem.url.startsWith('https://')) {
          imageUrl = mediaItem.url;
        } else {
          // Prepend base URL
          imageUrl = `${baseUrl.replace(/\/+$/, '')}/${mediaItem.url.replace(/^\/+/, '')}`;
        }
      }
    }
    if (!imageUrl) {
      imageUrl = `${baseUrl.replace(/\/+$/, '')}/uploads/products/placeholder.png`; // standard fallback
    }

    const plainDescription = product.description 
      ? product.description.replace(/<[^>]*>/g, '').trim() 
      : 'Order authentic health and wellness products directly from DR.BSK Healthcare app.';
      
    const shortDescription = plainDescription.length > 150 
      ? plainDescription.substring(0, 147) + '...' 
      : plainDescription;

    const productUrl = `${baseUrl.replace(/\/+$/, '')}/product/${productId}`;
    const schemeUrl = `${scheme}://product/${productId}`;

    // Simple template rendering
    html = html.replace(/{{PRODUCT_NAME}}/g, productName);
    html = html.replace(/{{PRODUCT_PRICE}}/g, priceVal);
    html = html.replace(/{{PRODUCT_IMAGE}}/g, imageUrl);
    html = html.replace(/{{PRODUCT_DESCRIPTION_PLAIN}}/g, plainDescription);
    html = html.replace(/{{PRODUCT_DESCRIPTION_SHORT}}/g, shortDescription);
    html = html.replace(/{{PRODUCT_URL}}/g, productUrl);
    html = html.replace(/{{APP_SCHEME_URL}}/g, schemeUrl);
    html = html.replace(/{{PRODUCT_ID}}/g, productId);
    html = html.replace(/{{ANDROID_URL}}/g, androidUrl);
    html = html.replace(/{{IOS_URL}}/g, iosUrl);

    // Render simple Handlebars style conditional blocks if they exist
    // MRP
    if (product.mrp && product.mrp !== priceVal) {
      html = html.replace(/{{#if PRODUCT_MRP}}([\s\S]*?){{\/if}}/g, `$1`.replace(/{{PRODUCT_MRP}}/g, product.mrp));
    } else {
      html = html.replace(/{{#if PRODUCT_MRP}}[\s\S]*?{{\/if}}/g, '');
    }

    // Discount
    if (product.discount) {
      html = html.replace(/{{#if PRODUCT_DISCOUNT}}([\s\S]*?){{\/if}}/g, `$1`.replace(/{{PRODUCT_DISCOUNT}}/g, product.discount));
    } else {
      html = html.replace(/{{#if PRODUCT_DISCOUNT}}[\s\S]*?{{\/if}}/g, '');
    }

    res.setHeader('Content-Type', 'text/html');
    res.status(200).send(html);
  } catch (error) {
    console.error('SHARE PAGE ERROR:', error);
    res.status(500).send(`<h3>Server Error</h3><p>${error.message}</p>`);
  }
};
