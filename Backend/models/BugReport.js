const mongoose = require("mongoose");

const bugReportSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      index: true
    },
    description: {
      type: String,
      required: true,
      trim: true,
      minlength: 5,
      maxlength: 2000
    },
    status: {
      type: String,
      enum: ["open", "reviewing", "resolved"],
      default: "open"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("BugReport", bugReportSchema);
