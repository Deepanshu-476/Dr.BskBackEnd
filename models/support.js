const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const supportSchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("SUP"),
    },
    email: { type: String },
    name: { type: String },
    phone: { type: String },
    description: { type: String },
    deleted_at : { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Support", supportSchema);
