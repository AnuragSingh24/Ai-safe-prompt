const mongoose = require("mongoose");

const payoutSchema = new mongoose.Schema({
  userId: String,
  email: String,
  upiId: String,
  coins: Number,
  amount: Number,
  status: {
    type: String,
    enum: ["pending", "success", "failed"],
    default: "pending"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model("Payout", payoutSchema);