const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const productSchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("P"),
    },
    name: { type: String },
    slug: { 
      type: String, 
      unique: true 
    },
    description: { type: String },
    media: [
      {
        url: { type: String, required: true },
        type: { type: String, enum: ['image', 'video'], required: true },
        name: { type: String },
        size: { type: Number }
      }
    ],
    retail_price: { type: String },
    consumer_price: { type: String },
    prescription: { type: String },
    discount: { type: String },
    gst: { type: String },
    stock: { type: String },
    mrp: { type: String },
    productvariety: { type: String },
    quantity: { type: Array },
    category: { type: String },
    sub_category: { type: String },
    expires_on: { type: String },
    suitable_for: { type: String },
    benefits: { type: String },
    dosage: { type: String },
    side_effects: { type: String },
    deleted_at: { type: Date, default: null },
  },
  { timestamps: true }
);

productSchema.pre("validate", function (next) {
  if (!this.publicId) {
    this.publicId = generateBskId("P");
  }
  next();
});

module.exports = mongoose.model("Product", productSchema);
