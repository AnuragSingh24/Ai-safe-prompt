const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    googleId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true
    },
    name: String,
    picture: String,
    totalCoins: {
      type: Number,
      default: 0
    },
    lastDailyClaimDate: {
      type: String,
      default: null
    },
    upi: {
      type: String,
      default: null
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
