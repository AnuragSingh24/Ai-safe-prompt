console.log("✅ AI Safe Prompt Loaded");

// ================= MASK FUNCTION =================
async function maskSensitiveData(text) {
  let learnedSecrets = await getLearnedSecrets();

  // 1. Mask previously learned secrets
  learnedSecrets.forEach(secret => {

    // ❌ Skip SQL / identifiers from learned secrets too
    if (
      /^[A-Z_]+$/.test(secret) ||
      /^[A-Za-z]+_[A-Za-z]+/.test(secret) ||
      /^pck\$/i.test(secret) ||
      (/_/.test(secret) && !/[0-9]/.test(secret))
    ) {
      return; // skip masking
    }

    if (text.includes(secret)) {
      text = text.replaceAll(secret, "***");
    }
  });
  // 2. Detect new secrets
  const matches = text.match(/[A-Za-z0-9_\-$]{10,}/g) || [];

  for (let match of matches) {

    // ✅ SKIP SQL / IDENTIFIER PATTERNS
    if (
      /^[A-Z_]+$/.test(match) ||                  // UPDATE_USER
      /^[A-Za-z]+_[A-Za-z]+/.test(match) ||       // user_profile
      /^pck\$/i.test(match) ||                    // PCK$
      (/_/.test(match) && !/[0-9]/.test(match))   // underscore but no numbers
    ) {
      continue;
    }

    if (isLikelySecret(match)) {

      // ❌ Double check before saving
      if (
        /^[A-Z_]+$/.test(match) ||
        /^[A-Za-z]+_[A-Za-z]+/.test(match) ||
        /^pck\$/i.test(match) ||
        (/_/.test(match) && !/[0-9]/.test(match))
      ) {
        continue;
      }

      await saveLearnedSecret(match);
      text = text.replaceAll(match, "***");
    }
  }

  // 3. Known patterns
  text = text.replace(
    /"(password|token|api_key|apikey|client_secret|secret|credential|auth)"\s*:\s*"([^"]*)"/gi,
    (match, key) => `"${key}": "***"`
  )
    .replace(/sk-[^\s"'`]+/gi, "***")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "***")
    .replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, "***")
    .replace(/\beyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_+/=]+\b/g, "***")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer ***")
    .replace(/(password\s*[:=]\s*["'`]).*?(["'`])/gi, '$1***$2')
    .replace(/(password\s*[:=]\s*)(\S+)/gi, '$1***')
    .replace(/(token\s*[:=]\s*["'`]?)[A-Za-z0-9-_.+/=]{10,}(["'`]?)/gi, '$1***$2')
    .replace(/(api_key|apikey|client_secret|secret|credential|auth|password)\s*[:=]\s*([^\s,;}\]"'`]+)/gi, '$1=***')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "***")
    .replace(/\b(\+?\d{1,3}[\s-]?)?[6-9]\d{9}\b/g, "***")


  return text;
}

// ================= HEURISTIC =================
function isLikelySecret(str) {
  if (str.length < 20) return false;

  // ✅ SQL / IDENTIFIER EXCLUSIONS
  if (
    /^[A-Z_]+$/.test(str) ||                         // ALL CAPS
    /^[a-z]+_[a-z_]+$/i.test(str) ||                 // snake_case
    /^[A-Za-z]+_[A-Za-z]+(_[A-Za-z]+)*$/.test(str) ||// word_word
    /^(dbo_|sp_|fn_|udf_|pkg_|pck\$)/i.test(str)     // SQL prefixes
  ) {
    return false;
  }

  // ❌ Skip readable words (no randomness)
  if (/^[A-Za-z$_]+$/.test(str)) return false;

  // Must contain randomness
  if (!/[0-9]/.test(str) && !/[-+=/]/.test(str)) {
    return false;
  }

  const entropy = calculateEntropy(str);

  const variety =
    (/[A-Z]/.test(str) ? 1 : 0) +
    (/[a-z]/.test(str) ? 1 : 0) +
    (/[0-9]/.test(str) ? 1 : 0) +
    (/[-_=+/]/.test(str) ? 1 : 0);

  return entropy > 3.5 && variety >= 3;
}

// ================= ENTROPY =================
function calculateEntropy(str) {
  const freq = {};
  for (let c of str) freq[c] = (freq[c] || 0) + 1;

  let entropy = 0;
  const len = str.length;

  for (let k in freq) {
    const p = freq[k] / len;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

// ================= GLOBAL STATE =================
let extensionEnabled = true;
let userLoggedIn = false;
let isUpdating = false;
let detectedIdPattern = null;
let popupActive = false;

// ================= CHECK CHROME API =================
function isChromeAvailable() {
  try {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  } catch {
    return false;
  }
}

// ================= DETECT ID WITH PREFIX =================
function detectIdPattern(text) {
  const patterns = [
    // Matches: user_id: 123, email_id abc@gmail.com, customer_id=456
    { 
      regex: /\b[a-zA-Z_]+_id[:=\s]+[^\s,;}]+/gi, 
      type: "id_with_underscore" 
    },

    // Matches: emailid: value, userid 123 (NO underscore)
    { 
      regex: /\b[a-zA-Z]+id[:=\s]+[^\s,;}]+/gi, 
      type: "id_without_underscore" 
    },

    // Matches: user_id_123, order_id_abc
    { 
      regex: /\b[a-zA-Z_]+_id_[a-zA-Z0-9_-]+/gi, 
      type: "id_compound" 
    }
  ];

  for (const pattern of patterns) {
    const matches = text.match(pattern.regex);
    if (matches) {
      console.log("🎯 ID pattern detected:", pattern.type, "| Matches:", matches);
      return { pattern: pattern.type, matches, regex: pattern.regex };
    }
  }

  return null;
}

// ================= SHOW CONFIRMATION POPUP =================
function showConfirmationPopup(patternType, matches) {
  return new Promise((resolve) => {
    popupActive = true;

    // Create popup overlay
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999;
    `;

    const popup = document.createElement("div");
    popup.style.cssText = `
      background: white;
      padding: 20px;
      border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      max-width: 400px;
      max-height: 60vh;
      overflow-y: auto;
      text-align: left;
      font-family: Arial, sans-serif;
      z-index: 10000;
    `;

    // Generate list of found values
    const matchesHTML = matches
      .map(match => `<div style="background: #161203; padding: 8px; margin: 5px 0; border-radius: 4px; word-break: break-word; border-left: 3px solid #ff9800;"><code>${escapeHtml(match)}</code></div>`)
      .join('');

    popup.innerHTML = `
      <h3 style="color: #333; margin-bottom: 15px; text-align: center;">🔍 Sensitive Data Detected</h3>
      <p style="color: #666; margin-bottom: 12px; text-align: center;"><b>Found ${matches.length} instance(s):</b></p>
      <div style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-bottom: 15px; max-height: 200px; overflow-y: auto;">
        ${matchesHTML}
      </div>
      <div style="display: flex; gap: 10px; justify-content: center;">
        <button id="replaceAllBtn" style="flex: 1; background: #4CAF50; color: white; padding: 10px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Hide All</button>
        <button id="cancelBtn" style="flex: 1; background: #f44336; color: white; padding: 10px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Cancel</button>
      </div>
    `;

    overlay.appendChild(popup);
    document.body.appendChild(overlay);

    document.getElementById("replaceAllBtn").onclick = () => {
      overlay.remove();
      popupActive = false;
      resolve(true);
    };

    document.getElementById("cancelBtn").onclick = () => {
      overlay.remove();
      popupActive = false;
      resolve(false);
    };
  });
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ================= HIDE ALL INSTANCES =================
function hideAllOnPage(regex) {
  let hiddenCount = 0;

  // Hide in text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let node;
  while (node = walker.nextNode()) {
    if (regex.test(node.textContent)) {
      // Replace only the value part, keep the label
      node.textContent = node.textContent.replace(regex, (match) => {
        // Extract label and value from match
        // Example: "user_id: 12345" -> label="user_id: ", value="12345"
        const labelMatch = match.match(/^([a-zA-Z_]+(?:_id)?[:=\s]+)/i);
        if (labelMatch) {
          // Keep the label, replace only the value
          return labelMatch[1] + "***";
        }
        // Fallback: if no label found, replace everything
        return "***";
      });
      hiddenCount++;
      regex.lastIndex = 0; // Reset regex
    }
  }

  // Hide in input/textarea values
  document.querySelectorAll("input, textarea").forEach(el => {
    if (regex.test(el.value)) {
      el.value = el.value.replace(regex, (match) => {
        // Extract label and value from match
        const labelMatch = match.match(/^([a-zA-Z_]+(?:_id)?[:=\s]+)/i);
        if (labelMatch) {
          // Keep the label, replace only the value
          return labelMatch[1] + "***";
        }
        // Fallback: if no label found, replace everything
        return "***";
      });
      hiddenCount++;
      regex.lastIndex = 0;
    }
  });

  console.log("✅ Hidden instances:", hiddenCount);
}

// ================= INIT STATE =================
function initState() {
  if (!isChromeAvailable()) return;

  chrome.storage.local.get(["enabled", "jwtToken"], (result) => {
    extensionEnabled = result.enabled !== false;
    userLoggedIn = !!result.jwtToken;
  });
}

// ================= OBSERVER =================
const observer = new MutationObserver(async () => {
  if (isUpdating || !userLoggedIn) return;
  await sanitizeEditor();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// ================= SANITIZE FUNCTION =================
async function sanitizeEditor() {
  const editors = document.querySelectorAll('[contenteditable="true"]');

  for (const el of editors) {
    const text = el.innerText;
    if (!text) continue;

    const masked = await maskSensitiveData(text);
    if (text === masked) continue;

    const selection = window.getSelection();
    let range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    isUpdating = true;
    el.textContent = masked;
    isUpdating = false;

    if (range && document.body.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
}

// ================= PASTE EVENT =================
document.addEventListener("paste", async (e) => {
  if (!userLoggedIn) return;

  const text = e.clipboardData?.getData("text");
  if (!text) return;

  // Check for ID patterns first
  const idMatch = detectIdPattern(text);
  if (idMatch) {
    const shouldHide = await showConfirmationPopup(idMatch.pattern, idMatch.matches);
    if (shouldHide) {
      e.preventDefault();
      e.stopImmediatePropagation();
      hideAllOnPage(idMatch.regex);
      console.log("✅ ID pattern hidden on page (paste)");
      return; // Skip maskSensitiveData if ID pattern is handled
    } else {
      // User clicked cancel - just allow normal paste without masking
      return;
    }
  }

  const masked = await maskSensitiveData(text);

  if (text !== masked) {
    e.preventDefault();
    e.stopImmediatePropagation();
    isUpdating = true;

    const target = e.target;

    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      const start = target.selectionStart;
      const end = target.selectionEnd;

      target.value =
        target.value.substring(0, start) +
        masked +
        target.value.substring(end);

      target.selectionStart = target.selectionEnd = start + masked.length;

      setTimeout(() => { isUpdating = false; }, 100);
    } else {
      const selection = window.getSelection();
      if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();

        const node = document.createTextNode(masked);
        range.insertNode(node);

        range.setStartAfter(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      setTimeout(() => { isUpdating = false; }, 100);
    }
  }
}, true);

// ================= INPUT EVENT =================
document.addEventListener("input", async (e) => {
  if (!userLoggedIn || isUpdating || popupActive) return;

  const target = e.target;

  if (
    target.tagName === "TEXTAREA" ||
    (target.tagName === "INPUT" && target.type === "text")
  ) {
    const text = target.value;

    // Check for ID patterns with prefix BEFORE masking
    const idMatch = detectIdPattern(text);
    if (idMatch) {
      console.log("🎯 ID pattern detected from typing:", idMatch.pattern);
      const shouldHide = await showConfirmationPopup(idMatch.pattern, idMatch.matches);
      if (shouldHide) {
        hideAllOnPage(idMatch.regex);
        console.log("✅ ID pattern hidden on page (typing)");
      }
      // Skip maskSensitiveData if ID pattern was detected
      return;
    }

    const masked = await maskSensitiveData(text);

    if (text !== masked) {
      isUpdating = true;

      const pos = target.selectionStart - (text.length - masked.length);

      target.value = masked;
      target.selectionStart = target.selectionEnd = Math.max(0, pos);

      isUpdating = false;
    }
  }
}, true);

// ================= STORAGE =================
async function getLearnedSecrets() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["learnedSecrets"], (result) => {
      resolve(result.learnedSecrets || []);
    });
  });
}

async function saveLearnedSecret(secret) {
  const secrets = await getLearnedSecrets();
  if (!secrets.includes(secret)) {
    secrets.push(secret);
    chrome.storage.local.set({ learnedSecrets: secrets });
  }
}

// ================= INIT =================
initState();
