const mongoose = require("mongoose");

const privacyStatsSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true
    },
    date: {
      type: String,
      required: true
    },
    todayItems: {
      type: Number,
      default: 0,
      min: 0
    },
    todayPrompts: {
      type: Number,
      default: 0,
      min: 0
    },
    totalItems: {
      type: Number,
      default: 0,
      min: 0
    },
    totalPrompts: {
      type: Number,
      default: 0,
      min: 0
    },
    lastProtectedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("PrivacyStats", privacyStatsSchema);
