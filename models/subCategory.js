const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const subCategorySchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("SCAT"),
    },
    subCategoryvariety: { type: String , required: true },
    name: { type: String },
    description: { type: String },
    category_id: { type: mongoose.Schema.Types.ObjectId, ref: "ProductCategories" },
    image: { type: String },
    deleted_at : { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProductSubCategories", subCategorySchema);
