// Service worker: owns the API keys, calls the model, caches verdicts per reply id.
importScripts("classifier.js", "settings.js");

const MAX_PER_REQUEST = 10;
const CACHE_LIMIT = 5000;
const CACHE_TTL_MS = 14 * 24 * 3600 * 1000;
const tabCounts = new Map();

const cacheKey = (model, id) => `v:${model}:${id}`;

async function classifyReplies(post, replies) {
  const settings = await SlopSettings.load();
  const preset = SlopSettings.preset(settings.model);
  const apiKey = settings.keys[preset.key];
  if (!apiKey) return { error: "no-key", model: preset.id };

  // Cached verdicts first: never pay twice for the same reply with the same model.
  const keys = replies.map((r) => cacheKey(preset.id, r.id));
  const cached = await chrome.storage.local.get(keys);
  const out = {};
  const todo = [];
  replies.forEach((r, i) => {
    const hit = cached[keys[i]];
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) out[r.id] = hit.p; else todo.push(r);
  });

  const fresh = {};
  let lastError = null;
  for (let i = 0; i < todo.length; i += MAX_PER_REQUEST) {
    const chunk = todo.slice(i, i + MAX_PER_REQUEST);
    try {
      let res;
      try {
        res = await SlopClassifier.classify(preset.provider, settings.keys, post, chunk, { timeoutMs: 30000 });
      } catch (e) {
        if (!preset.fallback || ![429, 502, 503].includes(e.status)) throw e;
        res = await SlopClassifier.classify(preset.fallback, settings.keys, post, chunk, { timeoutMs: 30000 });  // free tier busy
      }
      chunk.forEach((r, j) => {
        if (res.probs[j] == null) return;
        out[r.id] = res.probs[j];
        fresh[cacheKey(preset.id, r.id)] = { p: res.probs[j], ts: Date.now() };
      });
    } catch (e) {
      lastError = String(e.message || e).slice(0, 200);
      console.warn("[SlopGuard]", lastError);
    }
  }
  if (Object.keys(fresh).length) {
    await chrome.storage.local.set(fresh);
    await bumpStats(Object.keys(fresh).length);
    pruneCache();
  }
  return { results: out, model: preset.id, error: Object.keys(out).length ? null : lastError };
}

async function bumpStats(checked) {
  const day = new Date().toISOString().slice(0, 10);
  const { stats } = await chrome.storage.local.get("stats");
  const s = stats?.day === day ? stats : { day, checked: 0, hidden: 0 };
  s.checked += checked;
  await chrome.storage.local.set({ stats: s });
}

let pruning = false;
async function pruneCache() {
  if (pruning) return;
  pruning = true;
  try {
    const all = await chrome.storage.local.get(null);
    const entries = Object.entries(all).filter(([k]) => k.startsWith("v:"));
    if (entries.length <= CACHE_LIMIT) return;
    entries.sort((a, b) => a[1].ts - b[1].ts);
    await chrome.storage.local.remove(entries.slice(0, entries.length - CACHE_LIMIT * 0.8).map(([k]) => k));
  } finally { pruning = false; }
}

function setBadge(tabId, n) {
  tabCounts.set(tabId, n);
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#6b7280" });
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : "" });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "classify") {
    classifyReplies(msg.post, msg.replies).then(reply, (e) => reply({ error: String(e) }));
    return true;
  }
  if (msg.type === "hiddenCount" && sender.tab) {
    setBadge(sender.tab.id, msg.n);
    if (msg.added) chrome.storage.local.get("stats").then(({ stats }) => {
      const day = new Date().toISOString().slice(0, 10);
      const s = stats?.day === day ? stats : { day, checked: 0, hidden: 0 };
      s.hidden += msg.added;
      chrome.storage.local.set({ stats: s });
    });
    return false;
  }
  if (msg.type === "getTabCount") { reply({ n: tabCounts.get(msg.tabId) || 0 }); return false; }
  if (msg.type === "clearCache") {
    chrome.storage.local.get(null).then((all) => chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("v:")))).then(() => reply({ ok: true }));
    return true;
  }
  if (msg.type === "testConnection") {
    SlopSettings.load().then(async (settings) => {
      const preset = SlopSettings.preset(settings.model);
      if (!settings.keys[preset.key]) return reply({ ok: false, error: `Add your ${preset.key} API key first.` });
      const t0 = Date.now();
      try {
        const res = await SlopClassifier.classify(preset.provider, settings.keys,
          { handle: "founder", text: "We just shipped dark mode after 6 months of requests." },
          [{ handle: "a", text: "Great update! Shipping dark mode shows how much you value user feedback. Consistency like this is what builds loyal communities 🚀" },
           { handle: "b", text: "finally lol. now do the mobile app" }], { timeoutMs: 30000 });
        reply({ ok: true, ms: Date.now() - t0, probs: res.probs, model: res.model });
      } catch (e) { reply({ ok: false, error: String(e.message || e).slice(0, 300) }); }
    });
    return true;
  }
  if (msg.type === "openOptions") { chrome.runtime.openOptionsPage(); return false; }
  return false;
});

chrome.runtime.onInstalled.addListener((d) => { if (d.reason === "install") chrome.runtime.openOptionsPage(); });
chrome.tabs.onRemoved.addListener((id) => tabCounts.delete(id));
