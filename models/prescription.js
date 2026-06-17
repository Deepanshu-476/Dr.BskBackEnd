const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const prescriptionSchema = mongoose.Schema(
  {
     publicId: {
        type: String,
        unique: true,
        sparse: true,
        index: true,
        default: () => generateBskId("RX"),
      },
     userId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Admin',
      },
    image: { type: String },
    deleted_at : { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Prescriptions", prescriptionSchema);
