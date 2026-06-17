const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const newarrivalSchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("NA"),
    },
    name: { type: String },
    description: { type: String },
    image: { type: String },
    retail_price: { type: String },
    consumer_price: { type: String },
    discount: { type: String },
    mrp: { type: String },
    quantity: { type: String },
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

module.exports = mongoose.model("NewArrivalProduct", newarrivalSchema);
