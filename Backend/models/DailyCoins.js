const mongoose = require('mongoose');

const dailyCoinSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    date: {
      type: String,
      required: true,
      // Format: "YYYY-MM-DD"
    },
    coinsEarned: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

// Compound index for unique date per user
dailyCoinSchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyCoins', dailyCoinSchema);
