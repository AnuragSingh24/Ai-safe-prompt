require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { OAuth2Client } = require("google-auth-library");


// Import Models
const User = require("./models/User");
const DailyCoins = require("./models/DailyCoins");
// const Payment = require("./models/Payment");
const Payout = require("./models/Payout");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// CONFIG
const PORT = process.env.PORT || 5000;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const JWT_SECRET = process.env.JWT_SECRET || "supersecret";
const MONGODB_URI = process.env.MONGODB_URI;



// Google Client
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// ================= MONGODB CONNECTION =================
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected successfully"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// ================= HELPER FUNCTIONS =================
function getTodayDate() {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

// ================= GOOGLE AUTH =================
app.post("/api/auth/google", async (req, res) => {
  try {
    console.log("🔷 /api/auth/google - Request received");
    const { token } = req.body;

    if (!token) {
      console.log("❌ Token missing");
      return res.status(400).json({ error: "Token missing" });
    }

    // Verify Google Token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    console.log("✅ Google token verified for:", payload.email);

    // Extract user info
    const userData = {
      googleId: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };

    // Save or update user in MongoDB
    let user = await User.findOneAndUpdate(
      { googleId: userData.googleId },
      { $set: userData },
      { upsert: true, new: true, runValidators: true }
    );

    console.log("✅ User saved to MongoDB:", user.email, "| ID:", user._id, "| Coins:", user.totalCoins);

    // Generate JWT
    const appToken = jwt.sign(
      {
        googleId: user.googleId,
        email: user.email,
        name: user.name,
        picture: user.picture
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token: appToken,
      user: {
        googleId: user.googleId,
        email: user.email,
        name: user.name,
        picture: user.picture
      }
    });

  } catch (err) {
    console.error("Auth Error:", err);
    res.status(401).json({ error: "Invalid Google token" });
  }
});

// ================= PROFILE ENDPOINT =================
app.get("/api/profile", verifyJWT, async (req, res) => {
  try {
    console.log("🔷 /api/profile - Request from:", req.user.email);
    const userId = req.user.googleId;
    
    // Get user from MongoDB
    const user = await User.findOne({ googleId: userId });
    if (!user) {
      console.log("❌ User not found in DB:", userId);
      return res.status(404).json({ error: "User not found" });
    }
    console.log("✅ User found:", user.email, "| Total Coins:", user.totalCoins, "| Type:", typeof user.totalCoins);

    // Get today's coins
    const today = getTodayDate();
    const todayCoins = await DailyCoins.findOne({ userId, date: today });
    const dailyCoins = todayCoins ? todayCoins.coinsEarned : 0;
    console.log("✅ Daily coins retrieved:", dailyCoins, "| Type:", typeof dailyCoins, "| Date:", today);

    const responseData = {
      message: "User profile fetched",
      user: req.user,
      dailyCoins: dailyCoins,
      totalCoins: user.totalCoins,
      upi: user.upi,
      date: today
    };
    
    console.log("📤 Sending response:", JSON.stringify(responseData));

    res.json(responseData);
  } catch (err) {
    console.error("❌ Profile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ================= SAVE UPI ENDPOINT =================
app.post("/api/save-upi", verifyJWT, async (req, res) => {
  try {
    console.log("🔷 /api/save-upi - Request from:", req.user.email);
    const userId = req.user.googleId;
    const { upi } = req.body;

    if (!upi) {
      console.log("❌ UPI missing from request");
      return res.status(400).json({ error: "UPI ID is required" });
    }

    // Validate UPI format (basic check)
    if (!upi.includes("@")) {
      console.log("❌ Invalid UPI format:", upi);
      return res.status(400).json({ error: "Invalid UPI format" });
    }

    // Update user's UPI in MongoDB
    const user = await User.findOneAndUpdate(
      { googleId: userId },
      { upi: upi },
      { new: true }
    );

    if (!user) {
      console.log("❌ User not found in DB");
      return res.status(404).json({ error: "User not found" });
    }

    console.log("✅ UPI saved successfully:", upi, "| User:", user.email);

    res.json({
      success: true,
      message: "UPI ID saved successfully",
      upi: upi,
      user: user.email
    });
  } catch (err) {
    console.error("❌ Save UPI error:", err);
    res.status(500).json({ error: "Failed to save UPI" });
  }
});







// ================= GET PAYMENT HISTORY =================
app.get("/api/payment-history", verifyJWT, async (req, res) => {
  try {
    console.log("🔷 /api/payment-history - Request from:", req.user.email);
    const userId = req.user.googleId;

    // Fetch all payments for the user
    const payments = await Payment.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50);

    console.log("✅ Found", payments.length, "payments for user:", userId);

    res.json({
      success: true,
      payments: payments,
      totalCount: payments.length
    });
  } catch (err) {
    console.error("❌ Payment history error:", err);
    res.status(500).json({ error: "Failed to fetch payment history", details: err.message });
  }
});

// ================= CLAIM DAILY COIN =================
app.post("/api/claim-daily-coin", verifyJWT, async (req, res) => {
  try {
    console.log("🔷 /api/claim-daily-coin - Request from:", req.user.email);
    const userId = req.user.googleId;
    const today = getTodayDate();

    // Check if already claimed today
    const existingClaim = await DailyCoins.findOne({ userId, date: today });
    if (existingClaim) {
      console.log("⚠️  Already claimed today");
      return res.json({
        success: false,
        message: "Already claimed daily coin today",
        reason: "already_claimed"
      });
    }

    // Award 1 daily coin
    const user = await User.findOne({ googleId: userId });
    if (!user) {
      console.log("❌ User not found in DB");
      return res.status(404).json({ error: "User not found" });
    }

    // Update user's total coins
    user.totalCoins += 1;
    user.lastDailyClaimDate = today;
    await user.save();
    console.log("✅ User coins updated:", user.totalCoins, "| User:", user.email);

    // Record daily coin claim
    const dailyRecord = new DailyCoins({
      userId,
      date: today,
      coinsEarned: 1
    });
    await dailyRecord.save();
    console.log("✅ Daily coin record saved for:", today);

    res.json({
      success: true,
      message: "Daily coin claimed!",
      coinsAwarded: 1,
      dailyCoins: 1,
      totalCoins: user.totalCoins,
      date: today
    });
  } catch (err) {
    console.error("❌ Daily coin claim error:", err);
    res.status(500).json({ error: "Failed to claim daily coin" });
  }
});


// ================= REDEEM ENDPOINT =================
app.post("/api/redeem", verifyJWT, async (req, res) => {
  try {
    console.log("🔷 /api/redeem - Request from:", req.user.email);
    const userId = req.user.googleId;
    const { amount } = req.body;

    if (!amount || amount < 50) {
      console.log("❌ Invalid redeem amount:", amount);
      return res.status(400).json({ error: "Minimum 50 coins required to redeem" });
    }

    const user = await User.findOne({ googleId: userId });
    if (!user) {
      console.log("❌ User not found in DB");
      return res.status(404).json({ error: "User not found" });
    }

    if (user.totalCoins < amount) {
      console.log("❌ Not enough coins. User has:", user.totalCoins, "| Needed:", amount);
      return res.status(400).json({
        error: `Not enough coins. You have ${user.totalCoins}, need ${amount}`,
        currentCoins: user.totalCoins
      });
    }

    // Deduct coins
    user.totalCoins -= amount;
    await user.save();
    console.log("✅ Coins redeemed:", amount, "| Remaining:", user.totalCoins);

    res.json({
      success: true,
      message: `Redeemed ${amount} coins successfully!`,
      coinsDeducted: amount,
      remainingCoins: user.totalCoins,
      rupees: (user.totalCoins * 0.1).toFixed(2)
    });
  } catch (err) {
    console.error("❌ Redeem error:", err);
    res.status(500).json({ error: "Failed to redeem coins" });
  }
});

// ================= JWT MIDDLEWARE =================
function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ================= DEBUG ENDPOINT - Get all users =================
app.get("/api/debug/users", async (req, res) => {
  try {
    console.log("🔷 /api/debug/users - Fetching all users from DB");
    const users = await User.find({});
    console.log("✅ Found", users.length, "users in database");
    
    // Map all users with their details
    const usersList = users.map(u => ({
      id: u._id,
      email: u.email,
      name: u.name,
      googleId: u.googleId,
      totalCoins: u.totalCoins,
      upi: u.upi,
      lastDailyClaimDate: u.lastDailyClaimDate,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt
    }));
    
    console.log("📋 Users list:", JSON.stringify(usersList, null, 2));
    
    res.json({
      count: users.length,
      users: usersList
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ================= DEBUG ENDPOINT - Get specific user by googleId =================
app.get("/api/debug/user/:googleId", async (req, res) => {
  try {
    const { googleId } = req.params;
    console.log("🔷 /api/debug/user/:googleId - Fetching user with googleId:", googleId);
    
    const user = await User.findOne({ googleId });
    
    if (!user) {
      console.log("❌ User not found with googleId:", googleId);
      return res.status(404).json({ error: "User not found" });
    }
    
    console.log("✅ User found:", user.email, "| Coins:", user.totalCoins);
    
    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        googleId: user.googleId,
        totalCoins: user.totalCoins,
        upi: user.upi,
        lastDailyClaimDate: user.lastDailyClaimDate,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ================= DEBUG ENDPOINT - Reset user coins =================
app.post("/api/debug/reset-coins/:googleId", async (req, res) => {
  try {
    const { googleId } = req.params;
    const { amount } = req.body;
    
    console.log("🔷 /api/debug/reset-coins - googleId:", googleId, "| New amount:", amount);
    
    const user = await User.findOneAndUpdate(
      { googleId },
      { totalCoins: amount },
      { new: true }
    );
    
    if (!user) {
      console.log("❌ User not found");
      return res.status(404).json({ error: "User not found" });
    }
    
    console.log("✅ User coins reset:", user.email, "| New coins:", user.totalCoins);
    
    res.json({
      success: true,
      message: `Coins reset to ${amount}`,
      user: {
        email: user.email,
        totalCoins: user.totalCoins
      }
    });
  } catch (err) {
    console.error("❌ Error resetting coins:", err);
    res.status(500).json({ error: "Failed to reset coins" });
  }
});

// ================= DEBUG ENDPOINT - Get all daily coins =================
app.get("/api/debug/users", async (req, res) => {
  try {
    console.log("🔷 /api/debug/users - Fetching all users from DB");
    const users = await User.find({});
    console.log("✅ Found", users.length, "users in database");
    res.json({
      count: users.length,
      users: users.map(u => ({
        id: u._id,
        email: u.email,
        name: u.name,
        totalCoins: u.totalCoins,
        lastDailyClaimDate: u.lastDailyClaimDate
      }))
    });
  } catch (err) {
    console.error("❌ Error fetching users:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// ================= DEBUG ENDPOINT - Get all daily coins =================
app.get("/api/debug/daily-coins", async (req, res) => {
  try {
    console.log("🔷 /api/debug/daily-coins - Fetching all daily coins from DB");
    const dailyCoins = await DailyCoins.find({});
    console.log("✅ Found", dailyCoins.length, "daily coin records in database");
    res.json({
      count: dailyCoins.length,
      records: dailyCoins.map(r => ({
        id: r._id,
        userId: r.userId,
        date: r.date,
        coinsEarned: r.coinsEarned
      }))
    });
  } catch (err) {
    console.error("❌ Error fetching daily coins:", err);
    res.status(500).json({ error: "Failed to fetch daily coins" });
  }
});

// // ================= DIAGNOSTIC ENDPOINT =================
// app.get("/api/debug/config", (req, res) => {
//   console.log("🔍 /api/debug/config - Checking configuration");
  
//   const config = {
//     razorpay: {
//       keyIdPresent: !!process.env.RAZORPAY_KEY_ID,
//       keyIdLength: process.env.RAZORPAY_KEY_ID ? process.env.RAZORPAY_KEY_ID.length : 0,
//       keySecretPresent: !!process.env.RAZORPAY_KEY_SECRET,
//       keySecretLength: process.env.RAZORPAY_KEY_SECRET ? process.env.RAZORPAY_KEY_SECRET.length : 0,
//       keyIdValue: process.env.RAZORPAY_KEY_ID || "NOT SET",
//     },
//     mongodb: {
//       uriPresent: !!process.env.MONGODB_URI,
//       connected: true // We'll set this based on connection status
//     },
//     jwt: {
//       secretPresent: !!process.env.JWT_SECRET
//     },
//     google: {
//       clientIdPresent: !!process.env.GOOGLE_CLIENT_ID
//     },
//     port: PORT
//   };

//   res.json(config);
// });

// // ================= TEST RAZORPAY ENDPOINT =================
// app.post("/api/debug/test-razorpay", async (req, res) => {
//   try {
//     console.log("🧪 Testing Razorpay connection...");
    
//     const testOrder = await razorpay.orders.create({
//       amount: 500, // 5 rupees = 500 paise (test amount)
//       currency: "INR",
//       receipt: "test_" + Date.now().toString().slice(-10),
//       notes: {
//         test: true,
//         timestamp: new Date().toISOString()
//       }
//     });

//     console.log("✅ Test order created successfully:", testOrder.id);
//     res.json({
//       success: true,
//       message: "Razorpay connection working",
//       testOrder: testOrder
//     });
//   } catch (err) {
//     console.error("❌ Razorpay test failed:", err);
//     res.status(500).json({
//       success: false,
//       error: "Razorpay connection failed",
//       details: {
//         message: err.message,
//         code: err.code,
//         statusCode: err.statusCode
//       }
//     });
//   }
// });


app.get("/api/payout-history", verifyJWT, async (req, res) => {
  const userId = req.user.googleId;

  const payouts = await Payout.find({ userId })
    .sort({ createdAt: -1 });

  res.json({
    success: true,
    payouts
  });
});

app.post("/api/redeem", verifyJWT, async (req, res) => {
  try {
    const userId = req.user.googleId;
    const { coins } = req.body;

    if (!coins || coins < 50) {
      return res.status(400).json({ error: "Minimum 50 coins required" });
    }

    const user = await User.findOne({ googleId: userId });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.upi) {
      return res.status(400).json({ error: "Please add UPI first" });
    }

    if (user.totalCoins < coins) {
      return res.status(400).json({ error: "Not enough coins" });
    }

    // 💰 Convert coins → rupees
    const amount = (coins * 0.1).toFixed(2);

    // 🔻 Deduct coins
    user.totalCoins -= coins;
    await user.save();

    // 🧾 Create payout record
    const payout = new Payout({
      userId,
      email: user.email,
      upiId: user.upi,
      coins,
      amount,
      status: "pending"
    });

    await payout.save();

    // ⏳ Simulate payment processing (5 sec delay)
    setTimeout(async () => {
      payout.status = "success";
      await payout.save();

      console.log("✅ Simulated payout completed for:", user.email);
    }, 5000);

    res.json({
      success: true,
      message: `₹${amount} will be sent to ${user.upi} within few seconds`,
      payoutId: payout._id,
      remainingCoins: user.totalCoins
    });

  } catch (err) {
    console.error("❌ Redeem error:", err);
    res.status(500).json({ error: "Redeem failed" });
  }
});

// ================= START SERVER =================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
