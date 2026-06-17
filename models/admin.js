const mongoose = require("mongoose");
const { generateBskId } = require("../utils/bskIds");

const adminSchema = mongoose.Schema(
  {
    publicId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      default: () => generateBskId("U"),
    },
    email: { type: String, unique: true, required: true },
    password: { type: String },
    role: { type: String, default: "User" }, // Default role set here
    name: { type: String },
    image: { type: String },
    phone: { type: String },
    address: { type: [String], default: [] },
    location: { type: String },
    timeStamp: { type: String },
    deleted_at: { type: Date, default: null },
    lastLogin: { type: Date },
    loginMethod: { type: String, enum: ['otp', 'password', 'both'], default: 'otp' }
  },
  { timestamps: true }
);
// models/admin.js में ये code add करें:

adminSchema.statics.findOrCreateByEmail = async function(email, name = '') {
  let user = await this.findOne({ email: email.toLowerCase() });
  
  if (!user) {
    // Create new user
    user = await this.create({
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      password: 'default_password_123', // Temporary password
      role: "User"
    });
    
    console.log("New user created for email:", email);
  }
  
  return user;
};

module.exports = mongoose.model("Admin", adminSchema);
