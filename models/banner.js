const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const bannerSchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("BN"),
    },
    type: { type: String, required: true },
    slider_image: [{ type: String }],
    deleted_at: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DashboardBanner", bannerSchema);
