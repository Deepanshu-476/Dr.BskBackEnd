const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const categorySchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("CAT"),
    },
    variety: { type: String , required: true },
    name: { type: String , required: true },
    description: { type: String },
    image: { type: String },
    Subcategory_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductSubCategories" },
    deleted_at : { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductCategories", categorySchema);
