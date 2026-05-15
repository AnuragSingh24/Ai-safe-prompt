console.log("AI Safe Prompt Loaded");

const PRIVACY_API_URLS = [
  "http://127.0.0.1:8010/api/scan",
  "http://127.0.0.1:8000/api/scan"
];
const SCAN_DEBOUNCE_MS = 450;
const MAX_LIVE_SCAN_CHARS = 12000;

let extensionEnabled = true;
let isUpdating = false;
let scanTimer = null;
let lastScannedValue = "";
let secureAnimationTimer = null;

function isChromeAvailable() {
  try {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  } catch {
    return false;
  }
}

function initState() {
  if (!isChromeAvailable()) return;

  chrome.storage.local.get(["enabled"], (result) => {
    extensionEnabled = result.enabled !== false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.enabled) {
      extensionEnabled = changes.enabled.newValue !== false;
    }
  });
}

function isEditableTarget(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;

  return Boolean(
    target.isContentEditable ||
      target.closest?.('[contenteditable="true"]') ||
      target.closest?.('[role="textbox"]') ||
      target.tagName === "TEXTAREA" ||
      (target.tagName === "INPUT" && ["text", "search", "url", "email"].includes(target.type))
  );
}

function getEditableElement(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return null;

  if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
    return target;
  }

  return target.closest?.('[contenteditable="true"], [role="textbox"]') || null;
}

async function scanWithPrivacyApi(text, mode = "paste") {
  const headers = { "Content-Type": "application/json" };

  if (isChromeAvailable()) {
    const stored = await chrome.storage.local.get(["jwtToken"]);
    if (stored.jwtToken) {
      headers.Authorization = `Bearer ${stored.jwtToken}`;
    }
  }

  let lastError = null;

  for (const apiUrl of PRIVACY_API_URLS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text,
          mode,
          source_url: window.location.href
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Privacy API returned ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("Privacy API unavailable");
}

async function maskSensitiveData(text, mode = "paste") {
  const preApiMasked = maskBeforeModelLocally(text);

  try {
    const result = await scanWithPrivacyApi(preApiMasked, mode);
    if (result?.success && typeof result.masked_text === "string") {
      if (result.detection_count > 0) {
        showPrivacyToast(result.detection_count, result.risk);
      } else if (preApiMasked !== text) {
        showPrivacyToast(1, "critical");
      }
      return result.masked_text;
    }
  } catch (err) {
    console.warn("AI Safe Prompt API unavailable, using local fallback:", err.message);
  }

  return maskSensitiveDataLocally(text);
}

function maskBeforeModelLocally(text) {
  const registry = createLocalMaskRegistry();

  return maskHighRiskSecretsLocally(text)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, value => registry.next("email", value))
    .replace(/\b(\+?\d{1,3}[\s-]?)?[6-9]\d{9}\b/g, value => registry.next("phone", value))
    .replace(/\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, value => registry.next("ip", value))
    .replace(/\bhttps?:\/\/[^\s<>'")]+/gi, value => registry.next("url", value))
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, value => isLikelyCreditCard(value) ? registry.next("card", value) : value)
    .replace(
      /\b([a-zA-Z][a-zA-Z0-9_]*(?:_id|id)\s*[:=]\s*)(["'`]?)([A-Za-z0-9@._-]{3,})(["'`]?)/gi,
      (match, label, openQuote, value, closeQuote) => {
        if (/(email|phone|url|uri|ip|host)/i.test(label)) return match;
        return `${label}${openQuote}${registry.next("id", value)}${closeQuote}`;
      }
    )
    .replace(
      /\b(name|full_name|owner|maintainer|developer|reviewer)\s*([:=])\s*(["'`]?)([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})(["'`]?)/g,
      (match, label, operator, openQuote, value, closeQuote) => `${label}${operator}${openQuote}${registry.next("person", value)}${closeQuote}`
    );
}

function maskHighRiskSecretsLocally(text) {
  return text
    .replace(
      /"(password|token|api_key|apikey|client_secret|secret|credential|auth)"\s*:\s*"([^"]*)"/gi,
      (match, key) => `"${key}": "${secretPlaceholderForKey(key)}"`
    )
    .replace(
      /'(password|token|api_key|apikey|client_secret|secret|credential|auth)'\s*:\s*'([^']*)'/gi,
      (match, key) => `'${key}': '${secretPlaceholderForKey(key)}'`
    )
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[PRIVATE_KEY_REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/gi, "[OPENAI_API_KEY_REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[AWS_ACCESS_KEY_REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, "[GOOGLE_API_KEY_REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[GITHUB_TOKEN_REDACTED]")
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "[SLACK_TOKEN_REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_+/=-]+\b/g, "[JWT_REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, "Bearer [TOKEN_REDACTED]")
    .replace(
      /\b(password|passwd|pwd)\s*([:=])\s*(["'`])([^"'`\s,;}\]]+)\3/gi,
      (match, key, operator, quote) => `${key}${operator}${quote}[PASSWORD_REDACTED]${quote}`
    )
    .replace(
      /\b(password|passwd|pwd)\s*([:=])\s*([^\s,;}\]"'`]+)/gi,
      (match, key, operator) => `${key}${operator}[PASSWORD_REDACTED]`
    )
    .replace(
      /\b(api[_-]?key|apikey|token|client[_-]?secret|secret|credential|auth)\s*([:=])\s*(["'`])([^"'`\s,;}\]]{8,})\3/gi,
      (match, key, operator, quote) => `${key}${operator}${quote}${secretPlaceholderForKey(key)}${quote}`
    )
    .replace(
      /\b(api[_-]?key|apikey|token|client[_-]?secret|secret|credential|auth)\s*([:=])\s*([^\s,;}\]"'`]{8,})/gi,
      (match, key, operator) => `${key}${operator}${secretPlaceholderForKey(key)}`
    )
    .replace(
      /\b(postgres|postgresql|mysql|mongodb|redis):\/\/([^:\s/@]+):([^@\s]+)@/gi,
      (match, scheme, user) => `${scheme}://${user}:[PASSWORD_REDACTED]@`
    );
}

function maskSensitiveDataLocally(text) {
  return maskBeforeModelLocally(text);
}

function createLocalMaskRegistry() {
  const counters = {};
  const mappings = {};

  function nextNumber(type) {
    counters[type] = (counters[type] || 0) + 1;
    return counters[type];
  }

  function padded(number) {
    return String(number).padStart(3, "0");
  }

  return {
    next(type, value) {
      const key = `${type}:${value}`;
      if (mappings[key]) return mappings[key];

      const number = nextNumber(type);
      let replacement;

      if (type === "email") replacement = `user_${padded(number)}@example.test`;
      else if (type === "phone") replacement = `+91 900000${String(number).padStart(4, "0")}`;
      else if (type === "ip") replacement = `10.0.0.${number}`;
      else if (type === "url") replacement = `https://example.test/resource/${padded(number)}`;
      else if (type === "card") replacement = `4111 1111 1111 ${String(number).padStart(4, "0")}`;
      else if (type === "id") replacement = `ID_${padded(number)}`;
      else if (type === "person") replacement = `Person_${padded(number)}`;
      else replacement = `[${type.toUpperCase()}_REDACTED]`;

      mappings[key] = replacement;
      return replacement;
    }
  };
}

function isLikelyCreditCard(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;

  let total = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
    shouldDouble = !shouldDouble;
  }

  return total % 10 === 0;
}

function secretPlaceholderForKey(key) {
  const normalized = String(key).toLowerCase().replace(/[-_]/g, "");
  if (normalized.includes("password") || normalized === "pwd" || normalized === "passwd") {
    return "[PASSWORD_REDACTED]";
  }
  if (normalized.includes("token") || normalized === "auth") {
    return "[TOKEN_REDACTED]";
  }
  if (normalized.includes("apikey")) {
    return "[API_KEY_REDACTED]";
  }
  if (normalized.includes("clientsecret") || normalized.includes("secret")) {
    return "[SECRET_REDACTED]";
  }
  return "[SECRET_REDACTED]";
}

function showPrivacyToast(count, risk) {
  const existing = document.getElementById("ai-safe-prompt-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "ai-safe-prompt-toast";
  toast.textContent = `AI Safe Prompt masked ${count} ${count === 1 ? "item" : "items"} (${risk} risk)`;
  toast.style.cssText = `
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 2147483647;
    background: #111827;
    color: #ffffff;
    padding: 10px 12px;
    border-radius: 6px;
    font: 13px/1.4 Arial, sans-serif;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    max-width: 320px;
  `;

  document.documentElement.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function showPromptSecuredAnimation() {
  const existing = document.getElementById("ai-safe-prompt-secured");
  if (existing) existing.remove();
  if (secureAnimationTimer) clearTimeout(secureAnimationTimer);

  const overlay = document.createElement("div");
  overlay.id = "ai-safe-prompt-secured";
  overlay.innerHTML = `
    <div class="ai-safe-prompt-secured-card">
      <div class="ai-safe-prompt-secured-orbit">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div class="ai-safe-prompt-secured-icon">✓</div>
      <div class="ai-safe-prompt-secured-title">Prompt secured successfully</div>
      <div class="ai-safe-prompt-secured-copy">Sensitive data was masked before sending.</div>
    </div>
  `;
  overlay.style.cssText = `
    position: fixed;
    top: 18px;
    left: 0;
    right: 0;
    z-index: 2147483647;
    display: flex;
    justify-content: center;
    pointer-events: none;
    background: transparent;
    animation: aiSafePromptFadeIn 180ms ease both;
  `;

  const style = document.createElement("style");
  style.id = "ai-safe-prompt-secured-style";
  style.textContent = `
    .ai-safe-prompt-secured-card {
      width: min(310px, calc(100vw - 28px));
      min-height: 64px;
      padding: 12px 16px 12px 12px;
      border-radius: 14px;
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.96), rgba(240, 255, 249, 0.94)),
        linear-gradient(120deg, rgba(47, 191, 143, 0.22), rgba(244, 163, 64, 0.2));
      border: 1px solid rgba(47, 191, 143, 0.28);
      box-shadow: 0 14px 34px rgba(12, 34, 28, 0.2);
      color: #10241e;
      font-family: Arial, sans-serif;
      text-align: left;
      position: relative;
      overflow: hidden;
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr);
      grid-template-rows: auto auto;
      column-gap: 11px;
      row-gap: 2px;
      align-items: center;
      animation: aiSafePromptCardIn 520ms cubic-bezier(.2,.9,.2,1.2) both;
    }
    .ai-safe-prompt-secured-card::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: conic-gradient(from 140deg, transparent, rgba(47,191,143,.22), rgba(47,111,237,.2), rgba(244,163,64,.2), transparent);
      animation: aiSafePromptSpin 3s linear infinite;
    }
    .ai-safe-prompt-secured-icon,
    .ai-safe-prompt-secured-title,
    .ai-safe-prompt-secured-copy,
    .ai-safe-prompt-secured-orbit {
      position: relative;
      z-index: 1;
    }
    .ai-safe-prompt-secured-icon {
      width: 38px;
      height: 38px;
      margin: 0;
      grid-row: 1 / span 2;
      grid-column: 1;
      align-self: center;
      display: grid;
      place-items: center;
      border-radius: 50%;
      color: white;
      background: linear-gradient(135deg, #18a875, #2f6fed);
      font-size: 22px;
      font-weight: 800;
      box-shadow: 0 8px 18px rgba(47, 191, 143, 0.3);
      animation: aiSafePromptCheckPop 620ms ease both;
    }
    .ai-safe-prompt-secured-title {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0;
      margin: 0 0 3px;
      grid-column: 2;
      align-self: end;
      line-height: 1.2;
      white-space: nowrap;
    }
    .ai-safe-prompt-secured-copy {
      font-size: 11px;
      color: #52645e;
      grid-column: 2;
      align-self: start;
      line-height: 1.25;
      margin: 0;
    }
    .ai-safe-prompt-secured-orbit span {
      position: absolute;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f4a340;
      animation: aiSafePromptSpark 850ms ease-out both;
    }
    .ai-safe-prompt-secured-orbit span:nth-child(1) { left: 12%; top: 8px; background: #2fbf8f; animation-delay: 60ms; }
    .ai-safe-prompt-secured-orbit span:nth-child(2) { right: 12%; top: 12px; background: #2f6fed; animation-delay: 130ms; }
    .ai-safe-prompt-secured-orbit span:nth-child(3) { left: 56%; bottom: 6px; background: #f4a340; animation-delay: 190ms; }
    @keyframes aiSafePromptFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes aiSafePromptCardIn {
      from { opacity: 0; transform: translateY(-16px) scale(.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes aiSafePromptCheckPop {
      0% { transform: scale(.45) rotate(-16deg); }
      65% { transform: scale(1.12) rotate(3deg); }
      100% { transform: scale(1) rotate(0); }
    }
    @keyframes aiSafePromptSpin {
      to { transform: rotate(360deg); }
    }
    @keyframes aiSafePromptSpark {
      0% { opacity: 0; transform: translateY(10px) scale(.5); }
      45% { opacity: 1; transform: translateY(-8px) scale(1.15); }
      100% { opacity: 0; transform: translateY(-18px) scale(.7); }
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(overlay);

  secureAnimationTimer = setTimeout(() => {
    overlay.style.animation = "aiSafePromptFadeIn 220ms ease reverse both";
    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 230);
  }, 1900);
}

function insertIntoInput(target, text) {
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  target.value = target.value.slice(0, start) + text + target.value.slice(end);
  target.selectionStart = target.selectionEnd = start + text.length;
  target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function insertIntoContentEditable(text) {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    document.execCommand("insertText", false, text);
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);

  selection.removeAllRanges();
  selection.addRange(range);
}

async function replaceWholeEditableValue(target, originalText, maskedText) {
  if (!target || originalText === maskedText) return;

  isUpdating = true;

  if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
    const cursor = target.selectionStart ?? maskedText.length;
    const delta = originalText.length - maskedText.length;
    target.value = maskedText;
    target.selectionStart = target.selectionEnd = Math.max(0, cursor - delta);
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  } else {
    target.textContent = maskedText;
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
  }

  setTimeout(() => {
    isUpdating = false;
  }, 50);
}

document.addEventListener(
  "paste",
  async (event) => {
    if (!extensionEnabled || isUpdating || !isEditableTarget(event.target)) return;

    const text = event.clipboardData?.getData("text");
    if (!text) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const masked = await maskSensitiveData(text, "paste");
    const target = getEditableElement(event.target);

    isUpdating = true;
    if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
      insertIntoInput(target, masked);
    } else {
      insertIntoContentEditable(masked);
    }
    setTimeout(() => {
      isUpdating = false;
    }, 50);

    if (masked !== text) {
      showPromptSecuredAnimation();
    }
  },
  true
);

document.addEventListener(
  "input",
  (event) => {
    if (!extensionEnabled || isUpdating || !isEditableTarget(event.target)) return;

    const target = getEditableElement(event.target);
    if (!target) return;

    const text = target.tagName === "TEXTAREA" || target.tagName === "INPUT" ? target.value : target.innerText;
    if (!text || text === lastScannedValue || text.length > MAX_LIVE_SCAN_CHARS) return;

    clearTimeout(scanTimer);
    scanTimer = setTimeout(async () => {
      const latestText =
        target.tagName === "TEXTAREA" || target.tagName === "INPUT" ? target.value : target.innerText;

      if (!latestText || latestText === lastScannedValue) return;

      const masked = await maskSensitiveData(latestText, "input");
      lastScannedValue = masked;
      await replaceWholeEditableValue(target, latestText, masked);
      if (masked !== latestText) {
        showPromptSecuredAnimation();
      }
    }, SCAN_DEBOUNCE_MS);
  },
  true
);

initState();
