document.addEventListener("DOMContentLoaded", async () => {

  const loginPage = document.getElementById("loginPage");
  const dashboardPage = document.getElementById("dashboardPage");

  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  const userName = document.getElementById("userName");
  const userEmail = document.getElementById("userEmail");
  const userPicture = document.getElementById("userPicture");

  const coinsEl = document.getElementById("coins");
  const rupeesEl = document.getElementById("rupees");
  const messageBox = document.getElementById("messageBox");

  // ================= CHECK TOKEN VALIDITY =================
  async function isTokenValid(jwtToken) {
    if (!jwtToken) {
      console.log("❌ No token provided");
      return false;
    }

    try {
      // Verify token format (basic check)
      const parts = jwtToken.split('.');
      if (parts.length !== 3) {
        console.log("❌ Invalid token format");
        return false;
      }

      // Try to fetch profile with token
      const res = await fetch("http://localhost:5000/api/profile", {
        method: "GET",
        headers: { "Authorization": `Bearer ${jwtToken}` }
      });

      if (res.ok) {
        console.log("✅ Token is valid");
        return true;
      } else {
        console.log("❌ Token validation failed:", res.status);
        return false;
      }
    } catch (err) {
      console.error("⚠️ Token validation error:", err.message);
      // If backend is down, assume token is valid (don't logout)
      return true;
    }
  }
  async function debugStorage() {
    const allData = await chrome.storage.local.get(null);
    console.log("🔍 === STORAGE DEBUG ===");
    console.log("All stored data:", allData);
    console.log("keys:", Object.keys(allData));
    console.log("Has user:", !!allData.user);
    console.log("Has jwtToken:", !!allData.jwtToken);
    console.log("jwtToken value:", allData.jwtToken ? allData.jwtToken.substring(0, 50) + "..." : "MISSING");
    console.log("enabled:", allData.enabled);
    console.log("================================");
    return allData;
  }

  // Make it globally accessible for testing
  window.debugStorage = debugStorage;

  // ================= SHOW MESSAGE =================
  function showMessage(text, type = "success") {
    messageBox.innerHTML = `<div class="message ${type}">${text}</div>`;
    setTimeout(() => {
      messageBox.innerHTML = "";
    }, 4000);
  }

  // ================= FETCH COINS FROM BACKEND =================
  async function fetchCoinsFromBackend() {
    const data = await chrome.storage.local.get(["jwtToken"]);

    if (!data.jwtToken) return null;

    try {
      const res = await fetch("http://localhost:5000/api/profile", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${data.jwtToken}`
        }
      });

      const result = await res.json();
      return result;
    } catch (err) {
      console.error("Failed to fetch coins from backend:", err);
      return null;
    }
  }

  // ================= CLAIM DAILY COIN =================
  async function claimDailyCoin() {
    const data = await chrome.storage.local.get(["jwtToken"]);

    if (!data.jwtToken) return null;

    try {
      const res = await fetch("http://localhost:5000/api/claim-daily-coin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.jwtToken}`
        },
        body: JSON.stringify({})
      });

      const result = await res.json();
      
      if (result.success) {
        console.log(" Daily coin claimed!", result);
        return result;
      } else {
        console.log(" Daily coin already claimed:", result.message);
        return null;
      }
    } catch (err) {
      console.error("Failed to claim daily coin:", err);
      return null;
    }
  }

  // ================= LOAD UI =================
  async function loadUI() {
    try {
      const data = await chrome.storage.local.get(["user", "jwtToken", "points", "enabled"]);
      console.log("📂 Loading UI from storage:", {
        hasUser: !!data.user,
        hasToken: !!data.jwtToken,
        tokenLength: data.jwtToken?.length || 0,
        enabled: data.enabled,
        timestamp: new Date().toLocaleTimeString()
      });

      // 🔐 If user has credentials stored
      if (data.user && data.jwtToken) {
        console.log("✅ Found stored credentials for:", data.user.name);
        
        // Validate token is still good
        const isValid = await isTokenValid(data.jwtToken);
        
        if (!isValid) {
          console.warn("⚠️ Token validation failed - logging out");
          await chrome.storage.local.remove(["user", "jwtToken"]);
          loginPage.style.display = "block";
          dashboardPage.style.display = "none";
          showMessage("❌ Session expired, please login again", "error");
          return;
        }

        console.log("✅ User is logged in:", data.user.name);

      // Show Dashboard, Hide Login
      loginPage.style.display = "none";
      dashboardPage.style.display = "block";

      // Display user info
      userName.innerText = data.user.name || "User";
      userEmail.innerText = data.user.email || "email@example.com";
      userPicture.src = data.user.picture || "";

      // 💰 Claim daily coin (1 coin per day automatically) - with error handling
      try {
        const claimResult = await claimDailyCoin();
        if (claimResult?.success) {
          showMessage(" +1 Daily coin credited!", "success");
        }
      } catch (err) {
        console.error("Error claiming daily coin:", err);
        // Continue loading UI even if claim fails
      }

      // Fetch coins from backend
      const profileData = await fetchCoinsFromBackend();
      if (profileData) {
        const totalCoins = profileData.totalCoins || 0;
        const dailyCoins = profileData.dailyCoins || 0;
        const savedUpi = profileData.upi || "";
        
        coinsEl.innerText = totalCoins;
        document.getElementById("dailyCoins").innerText = dailyCoins;
        rupeesEl.innerText = (totalCoins * 0.1).toFixed(2);
        
        // Display saved UPI if it exists
        if (savedUpi) {
          document.getElementById("upi").value = savedUpi;
          console.log("✅ Loaded saved UPI from backend:", savedUpi);
        }
        
        console.log("✅ Coins from backend - Total:", totalCoins, "Today:", dailyCoins, "UPI:", savedUpi);
      } else {
        // Fallback to local storage if backend not available
        const points = data.points || 0;
        coinsEl.innerText = points;
        document.getElementById("dailyCoins").innerText = "0";
        rupeesEl.innerText = (points * 0.1).toFixed(2);
        console.log("⚠️ Backend unavailable, using local storage fallback");
      }

      // Update masking toggle
      const maskingToggle = document.getElementById("maskingToggle");
      const maskingStatus = document.getElementById("maskingStatus");
      const isEnabled = data.enabled !== false;
      maskingToggle.checked = isEnabled;
      maskingStatus.innerText = isEnabled ? "ON" : "OFF";

    } else {
      console.log("❌ User not logged in");
      console.log("Debug info - data.user:", !!data.user, "data.jwtToken:", !!data.jwtToken);

      // Show Login, Hide Dashboard
      loginPage.style.display = "block";
      dashboardPage.style.display = "none";
    }
    } catch (err) {
      console.error("❌ CRITICAL ERROR in loadUI:", err);
      console.error("Error stack:", err.stack);
      // Fallback to login page on error
      loginPage.style.display = "block";
      dashboardPage.style.display = "none";
      showMessage("❌ Error loading dashboard. Please refresh.", "error");
    }
  }

  // ================= LOGIN =================
  loginBtn.onclick = async () => {
    try {
      const redirectURL = chrome.identity.getRedirectURL();
      const clientId = "766985052649-07uq48gd6mrjroqmbpk9ing77asr3j3j.apps.googleusercontent.com";

      const authUrl =
        `https://accounts.google.com/o/oauth2/v2/auth` +
        `?client_id=${clientId}` +
        `&response_type=id_token` +
        `&redirect_uri=${encodeURIComponent(redirectURL)}` +
        `&scope=email profile` +
        `&nonce=random_nonce_${Date.now()}`;

      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        async (responseUrl) => {
          if (chrome.runtime.lastError || !responseUrl) {
            showMessage("❌ Login failed", "error");
            return;
          }

          const url = new URL(responseUrl);
          const params = new URLSearchParams(url.hash.substring(1));

          const idToken = params.get("id_token");

          if (!idToken) {
            showMessage("❌ No ID token received", "error");
            return;
          }

          try {
            // ✅ SEND TOKEN TO BACKEND
            const backendRes = await fetch(
              "http://localhost:5000/api/auth/google",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({ token: idToken })
              }
            );

            const data = await backendRes.json();

            if (!data.success) {
              showMessage("❌ Backend auth failed: " + (data.error || "Unknown error"), "error");
              return;
            }

            // ✅ SAVE USER AND JWT TOKEN - ENABLE MASKING
            await chrome.storage.local.set({
              user: data.user,
              jwtToken: data.token,
              points: 0,
              enabled: true  // 🔐 Auto-enable masking after login
            });

            // ✅ VERIFY STORAGE WAS SAVED
            const verify = await chrome.storage.local.get(["enabled", "jwtToken"]);
            console.log("✅ Storage verify after login:", verify);

            console.log("✅ User saved to storage:", data.user);
            showMessage("✅ Login successful! Welcome " + data.user.name, "success");
            await loadUI();

          } catch (err) {
            console.error("Backend request failed:", err);
            showMessage("❌ Failed to authenticate with backend", "error");
          }
        }
      );
    } catch (err) {
      console.error(err);
      showMessage("❌ Login error occurred", "error");
    }
  };

  // ================= LOGOUT =================
  logoutBtn.onclick = async () => {
    const confirmLogout = confirm("Are you sure you want to logout?");
    if (!confirmLogout) return;

    console.log("🔐 Starting logout process...");
    
    // ✅ EXPLICITLY CLEAR ALL DATA
    await chrome.storage.local.remove(["user", "jwtToken", "points"]);
    await chrome.storage.local.set({ enabled: false }); // 🔐 Auto-disable masking on logout
    
    // ✅ VERIFY DATA WAS CLEARED
    const verify = await chrome.storage.local.get(["user", "jwtToken", "enabled"]);
    console.log("🔐 Verification after logout:", verify);
    
    showMessage("✅ Logged out successfully", "success");
    console.log("✅ User logged out, masking disabled");
    await loadUI();
  };

  // ================= SCAN TEXT =================
  document.getElementById("scanBtn").onclick = async () => {
    const data = await chrome.storage.local.get(["jwtToken"]);
    
    if (!data.jwtToken) {
      showMessage("❌ Please login first", "error");
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/api/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.jwtToken}`
        },
        body: JSON.stringify({})
      });

      const result = await res.json();

      if (result.success) {
        coinsEl.innerText = result.totalCoins;
        document.getElementById("dailyCoins").innerText = result.dailyCoins;
        rupeesEl.innerText = (result.totalCoins * 0.1).toFixed(2);
        showMessage(`🎉 +${result.coinsEarned} coins earned! (Daily: ${result.dailyCoins})`, "success");
      } else {
        showMessage("❌ Scan failed", "error");
      }
    } catch (err) {
      console.error("Scan error:", err);
      showMessage("❌ Failed to scan", "error");
    }
  };

  // ================= SAVE UPI =================
  document.getElementById("saveUpi").onclick = async () => {
    const upi = document.getElementById("upi").value;
    const data = await chrome.storage.local.get(["jwtToken"]);

    if (!data.jwtToken) {
      showMessage("❌ Please login first", "error");
      return;
    }

    if (!upi || !upi.includes("@")) {
      showMessage("❌ Invalid UPI ID", "error");
      return;
    }

    try {
      const res = await fetch("http://localhost:5000/api/save-upi", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.jwtToken}`
        },
        body: JSON.stringify({ upi })
      });

      const result = await res.json();

      if (result.success) {
        await chrome.storage.local.set({ upi });
        showMessage("✅ UPI ID Saved to Backend Successfully", "success");
        console.log("✅ UPI saved to MongoDB:", upi);
      } else {
        showMessage("❌ Failed to save UPI: " + (result.error || "Unknown error"), "error");
      }
    } catch (err) {
      console.error("Save UPI error:", err);
      showMessage("❌ Failed to save UPI", "error");
    }
  };

  // ================= REDEEM =================
  document.getElementById("redeemBtn").onclick = async () => {
    const data = await chrome.storage.local.get(["jwtToken"]);
    
    if (!data.jwtToken) {
      showMessage("❌ Please login first", "error");
      return;
    }

    try {
      // ✅ FETCH CURRENT COINS FROM BACKEND FIRST
      const profileRes = await fetch("http://localhost:5000/api/profile", {
        headers: { "Authorization": `Bearer ${data.jwtToken}` }
      });

      const profileData = await profileRes.json();
      const totalCoins = profileData.totalCoins || 0;

      if (totalCoins < 50) {
        showMessage(`❌ Not enough coins (need 50, have ${totalCoins})`, "error");
        return;
      }

      // ✅ SEND REDEEM REQUEST
      const response = await fetch("http://localhost:5000/api/redeem", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.jwtToken}`
        },
        body: JSON.stringify({ amount: 50 })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        coinsEl.innerText = result.remainingCoins;
        rupeesEl.innerText = result.rupees.toFixed(2);
        showMessage("✅ " + result.message, "success");
        await loadUI();
      } else {
        showMessage("❌ Redemption failed: " + (result.error || "Unknown error"), "error");
      }
    } catch (err) {
      console.error("Redeem error:", err);
      showMessage("❌ Backend request failed", "error");
    }
  };

  // ================= INIT =================
  console.log("🟢 POPUP OPENED - DOMContentLoaded fired");
  await loadUI();

  // ================= REFRESH ON POPUP OPEN =================
  // Auto-refresh dashboard when popup opens (every time user clicks extension icon)
  window.addEventListener("focus", async () => {
    console.log("🔄 Popup regained focus, refreshing data...");
    await debugStorage();
    await loadUI();
  });

  // Also listen for storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      console.log("📦 Storage changed:", changes);
      if (changes.jwtToken) {
        console.log("🔑 jwtToken changed:", !!changes.jwtToken.newValue);
      }
      if (changes.user) {
        console.log("👤 user changed:", !!changes.user.newValue);
      }
    }
  });

  // ================= MASKING TOGGLE =================
  const maskingToggle = document.getElementById("maskingToggle");
  const maskingStatus = document.getElementById("maskingStatus");

  if (maskingToggle) {
    // Masking toggle is disabled - masking is auto-enabled on login
    maskingToggle.disabled = true;
    maskingToggle.style.cursor = "not-allowed";
    console.log("✅ Masking is auto-enabled on login");
  }
});