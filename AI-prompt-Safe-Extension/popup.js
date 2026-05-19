document.addEventListener("DOMContentLoaded", async () => {
  const NODE_API_BASE_URL = "https://ai-safe-prompt.onrender.com";

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
      const res = await fetch(`${NODE_API_BASE_URL}/api/profile`, {
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

  function showPage(page) {
    const isDashboard = page === "dashboard";
    loginPage.style.display = isDashboard ? "none" : "flex";
    dashboardPage.style.display = isDashboard ? "block" : "none";

    const activePage = isDashboard ? dashboardPage : loginPage;
    activePage.classList.remove("page-enter");
    void activePage.offsetWidth;
    activePage.classList.add("page-enter");
  }

  function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle("loading", isLoading);
    button.disabled = isLoading;
  }

  function animateNumber(element, value, options = {}) {
    if (!element) return;

    const decimals = options.decimals || 0;
    const end = Number(value) || 0;
    const start = Number(element.dataset.value || element.innerText || 0) || 0;
    const duration = 520;
    const startedAt = performance.now();

    element.classList.remove("coin-pop");
    void element.offsetWidth;
    element.classList.add("coin-pop");

    function tick(now) {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + (end - start) * eased;
      element.innerText = current.toFixed(decimals);

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        element.innerText = end.toFixed(decimals);
        element.dataset.value = String(end);
      }
    }

    requestAnimationFrame(tick);
  }

  function updateWallet(totalCoins, dailyCoins) {
    animateNumber(coinsEl, totalCoins);
    animateNumber(document.getElementById("dailyCoins"), dailyCoins);
    animateNumber(rupeesEl, totalCoins * 0.1, { decimals: 2 });
  }

  function updateMaskingControl(isEnabled) {
    const maskingToggle = document.getElementById("maskingToggle");
    const maskingStatus = document.getElementById("maskingStatus");
    const maskingSwitch = document.getElementById("maskingSwitch");
    const statusPanel = document.querySelector(".status-panel");

    if (maskingToggle) maskingToggle.checked = isEnabled;
    if (maskingStatus) {
      maskingStatus.innerText = isEnabled ? "ON" : "OFF";
      maskingStatus.style.background = isEnabled ? "#14785d" : "#8a938f";
    }
    if (maskingSwitch) {
      maskingSwitch.classList.toggle("is-off", !isEnabled);
      maskingSwitch.setAttribute("aria-checked", String(isEnabled));
    }
    if (statusPanel) {
      statusPanel.classList.toggle("is-off", !isEnabled);
    }
  }

  // ================= FETCH COINS FROM BACKEND =================
  async function fetchCoinsFromBackend() {
    const data = await chrome.storage.local.get(["jwtToken"]);

    if (!data.jwtToken) {
      console.warn("⚠️ No JWT token available for coin fetch");
      return null;
    }

    try {
      console.log("🔷 Fetching coins from backend...");
      const res = await fetch(`${NODE_API_BASE_URL}/api/profile`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${data.jwtToken}`,
          "Content-Type": "application/json"
        }
      });

      console.log("📊 Response status:", res.status);

      if (!res.ok) {
        console.error("❌ API returned error status:", res.status);
        return null;
      }

      const result = await res.json();
      console.log("✅ Coins fetched successfully:", result);
      return result;
    } catch (err) {
      console.error("❌ Failed to fetch coins from backend:", err.message);
      console.error("❌ Error details:", err);
      return null;
    }
  }

  // ================= CLAIM DAILY COIN =================
  async function claimDailyCoin() {
    const data = await chrome.storage.local.get(["jwtToken"]);

    if (!data.jwtToken) return null;

    try {
      const res = await fetch(`${NODE_API_BASE_URL}/api/claim-daily-coin`, {
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
          showPage("login");
          showMessage("❌ Session expired, please login again", "error");
          return;
        }

        console.log("✅ User is logged in:", data.user.name);

        // Show Dashboard, Hide Login
        showPage("dashboard");

        // Display user info
        userName.innerText = data.user.name || "User";
        userEmail.innerText = data.user.email || "email@example.com";
        userPicture.src = data.user.picture || "";

        // 💰 Claim daily coin (1 coin per day automatically) - with error handling
        try {
          const claimResult = await claimDailyCoin();
          console.log("📝 Claim daily coin result:", claimResult);
          if (claimResult?.success) {
            showMessage(" +1 Daily coin credited!", "success");
          }
        } catch (err) {
          console.error("Error claiming daily coin:", err);
          // Continue loading UI even if claim fails
        }

        // Fetch coins from backend
        console.log("🔷 Fetching profile data from backend...");
        const profileData = await fetchCoinsFromBackend();
        console.log("🔍 Profile data received:", profileData);

        if (profileData) {
          const totalCoins = profileData.totalCoins || 0;
          const dailyCoins = profileData.dailyCoins || 0;
          const savedUpi = profileData.upi || "";

          console.log("💰 Setting coins - Total:", totalCoins, "Daily:", dailyCoins);
          updateWallet(totalCoins, dailyCoins);
          console.log("✅ coinsEl.innerText set to:", coinsEl.innerText);
          document.getElementById("dailyCoins").dataset.value = String(dailyCoins);
          console.log("✅ dailyCoins element set to:", document.getElementById("dailyCoins").innerText);
          rupeesEl.dataset.value = String(totalCoins * 0.1);

          // Display saved UPI if it exists
          if (savedUpi) {
            document.getElementById("upi").value = savedUpi;
            console.log("✅ Loaded saved UPI from backend:", savedUpi);
          }

          console.log("✅ Coins from backend - Total:", totalCoins, "Today:", dailyCoins, "UPI:", savedUpi);
        } else {
          // Fallback to local storage if backend not available
          const points = data.points || 0;
          console.warn("⚠️ profileData is null, using fallback");
          updateWallet(points, 0);
          console.log("⚠️ Backend unavailable, using local storage fallback");
        }

        // Update masking toggle
        const maskingToggle = document.getElementById("maskingToggle");
        const maskingStatus = document.getElementById("maskingStatus");
        const isEnabled = data.enabled !== false;
        maskingToggle.checked = isEnabled;
        maskingStatus.innerText = isEnabled ? "ON" : "OFF";
        maskingStatus.style.background = isEnabled ? "#14785d" : "#8a938f";
        updateMaskingControl(isEnabled);

      } else {
        console.log("❌ User not logged in");
        console.log("Debug info - data.user:", !!data.user, "data.jwtToken:", !!data.jwtToken);

        // Show Login, Hide Dashboard
        showPage("login");
      }
    } catch (err) {
      console.error("❌ CRITICAL ERROR in loadUI:", err);
      console.error("Error stack:", err.stack);
      // Fallback to login page on error
      showPage("login");
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
              `${NODE_API_BASE_URL}/api/auth/google`,
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
  const scanBtn = document.getElementById("scanBtn");
  if (scanBtn) {
    scanBtn.onclick = async () => {
      const data = await chrome.storage.local.get(["jwtToken"]);

      if (!data.jwtToken) {
        showMessage("❌ Please login first", "error");
        return;
      }

      try {
        const res = await fetch(`${NODE_API_BASE_URL}/api/scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${data.jwtToken}`
          },
          body: JSON.stringify({})
        });

        const result = await res.json();

        if (result.success) {
          updateWallet(result.totalCoins, result.dailyCoins);
          document.getElementById("dailyCoins").dataset.value = String(result.dailyCoins);
          rupeesEl.dataset.value = String(result.totalCoins * 0.1);
          showMessage(`🎉 +${result.coinsEarned} coins earned! (Daily: ${result.dailyCoins})`, "success");
        } else {
          showMessage("❌ Scan failed", "error");
        }
      } catch (err) {
        console.error("Scan error:", err);
        showMessage("❌ Failed to scan", "error");
      }
    };
  }

  // ================= SAVE UPI =================
  const saveUpiBtn = document.getElementById("saveUpi");
  console.log("🔍 Save UPI button found:", !!saveUpiBtn);

  if (saveUpiBtn) {
    saveUpiBtn.onclick = async () => {
      setButtonLoading(saveUpiBtn, true);
      console.log("🔷 SAVE UPI BUTTON CLICKED!");

      const upiInput = document.getElementById("upi");
      const upi = upiInput ? upiInput.value : "";
      console.log("📝 UPI input value:", upi);

      const data = await chrome.storage.local.get(["jwtToken"]);
      console.log("🔑 JWT Token retrieved:", !!data.jwtToken);

      if (!data.jwtToken) {
        showMessage("❌ Please login first", "error");
        console.warn("⚠️ No JWT token found");
        setButtonLoading(saveUpiBtn, false);
        return;
      }

      if (!upi || !upi.includes("@")) {
        showMessage("❌ Invalid UPI ID", "error");
        console.warn("⚠️ Invalid UPI format:", upi);
        setButtonLoading(saveUpiBtn, false);
        return;
      }

      try {
        console.log("🚀 Sending request to backend...");
        const res = await fetch(`${NODE_API_BASE_URL}/api/save-upi`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${data.jwtToken}`
          },
          body: JSON.stringify({ upi })
        });

        console.log("📥 Response status:", res.status);
        const result = await res.json();
        console.log("📥 Response data:", result);

        if (result.success) {
          await chrome.storage.local.set({ upi });
          showMessage("✅ UPI ID Saved to Backend Successfully", "success");
          console.log("✅ UPI saved to MongoDB:", upi);
        } else {
          showMessage("❌ Failed to save UPI: " + (result.error || "Unknown error"), "error");
          console.error("❌ Backend error:", result);
        }
      } catch (err) {
        console.error("❌ Save UPI error:", err);
        console.error("❌ Error details:", err.message, err.stack);
        showMessage("❌ Failed to save UPI: " + err.message, "error");
      }
      setButtonLoading(saveUpiBtn, false);
    };
  } else {
    console.error("❌ Save UPI button NOT found in DOM");
  }

  // ================= SAVE BUG REPORT =================
  const saveBugBtn = document.getElementById("saveBug");

  if (saveBugBtn) {
    saveBugBtn.onclick = async () => {
      setButtonLoading(saveBugBtn, true);

      const bugInput = document.getElementById("bugDescription");
      const description = bugInput ? bugInput.value.trim() : "";
      const data = await chrome.storage.local.get(["jwtToken"]);

      if (!data.jwtToken) {
        showMessage("Please login first", "error");
        setButtonLoading(saveBugBtn, false);
        return;
      }

      if (description.length < 5) {
        showMessage("Please write a little more about the bug", "error");
        setButtonLoading(saveBugBtn, false);
        return;
      }

      try {
        const res = await fetch(`${NODE_API_BASE_URL}/api/bug-reports`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${data.jwtToken}`
          },
          body: JSON.stringify({ description })
        });

        const responseText = await res.text();
        let result = {};

        try {
          result = responseText ? JSON.parse(responseText) : {};
        } catch (parseErr) {
          console.error("Bug report endpoint returned non-JSON:", responseText);
          throw new Error("Node backend did not return JSON. Restart the Node backend and reload the extension.");
        }

        if (res.ok && result.success) {
          bugInput.value = "";
          showMessage("Bug saved successfully", "success");
        } else {
          showMessage(result.error || "Failed to save bug", "error");
        }
      } catch (err) {
        console.error("Save bug error:", err);
        showMessage("Failed to save bug: " + err.message, "error");
      }

      setButtonLoading(saveBugBtn, false);
    };
  }

  // ================= REDEEM =================
 document.getElementById("redeemBtn").onclick = async () => {
  const redeemBtn = document.getElementById("redeemBtn");
  setButtonLoading(redeemBtn, true);
  const data = await chrome.storage.local.get(["jwtToken"]);

  if (!data.jwtToken) {
    showMessage("❌ Please login first", "error");
    setButtonLoading(redeemBtn, false);
    return;
  }

  try {
    const res = await fetch(`${NODE_API_BASE_URL}/api/redeem`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${data.jwtToken}`
      },
      body: JSON.stringify({ amount: 50 })
    });

    const result = await res.json();

    if (result.success) {
      showMessage("💰 Money sent to your UPI!", "success");
      await loadUI();
    } else {
      showMessage("❌ " + result.error, "error");
    }

  } catch (err) {
    showMessage("❌ Redeem failed", "error");
  }
  setButtonLoading(redeemBtn, false);
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
  const maskingSwitch = document.getElementById("maskingSwitch");

  if (maskingSwitch) {
    maskingSwitch.onclick = async () => {
      const current = await chrome.storage.local.get(["enabled"]);
      const nextEnabled = current.enabled === false;
      await chrome.storage.local.set({ enabled: nextEnabled });
      updateMaskingControl(nextEnabled);
      showMessage(nextEnabled ? "Masking enabled" : "Masking paused", nextEnabled ? "success" : "error");
      console.log("Masking toggled:", nextEnabled);
    };
  }

  if (maskingToggle) {
    maskingToggle.onchange = async () => {
      const nextEnabled = maskingToggle.checked;
      await chrome.storage.local.set({ enabled: nextEnabled });
      updateMaskingControl(nextEnabled);
    };
  }
});
