console.log("✅ AI Safe Prompt Loaded");

// ================= MASK FUNCTION =================
async function maskSensitiveData(text) {
  let learnedSecrets = await getLearnedSecrets();

  // 1. Mask previously learned secrets
  learnedSecrets.forEach(secret => {
    if (text.includes(secret)) {
      text = text.replaceAll(secret, "***");
    }
  });

  // 2. Detect new secrets
  const matches = text.match(/[A-Za-z0-9_\-\/+=.]{12,}/g) || [];

  for (let match of matches) {
    if (isLikelySecret(match)) {
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
    .replace(/[A-Za-z0-9_\-\/+=.]{16,}/g, (match) => {
      return isLikelySecret(match) ? "***" : match;
    });

  return text;
}

// ================= HEURISTIC =================
function isLikelySecret(str) {
  if (str.length < 16) return false;
  if (/^[a-z]+$/i.test(str)) return false;

  const entropy = calculateEntropy(str);

  const variety =
    (/[A-Z]/.test(str) ? 1 : 0) +
    (/[a-z]/.test(str) ? 1 : 0) +
    (/[0-9]/.test(str) ? 1 : 0) +
    (/[-_=+/]/.test(str) ? 1 : 0);

  return entropy > 3.5 && variety >= 2;
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

// ================= CHECK CHROME API =================
function isChromeAvailable() {
  try {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  } catch {
    return false;
  }
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
  if (!userLoggedIn || isUpdating) return;

  const target = e.target;

  if (
    target.tagName === "TEXTAREA" ||
    (target.tagName === "INPUT" && target.type === "text")
  ) {
    const text = target.value;
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