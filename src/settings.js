// Settings shared by the service worker, popup and options page.
(function (root) {
  // Models offered in Options. The first one is the default, picked from bench/results (see README).
  const PRESETS = [
    { id: "pplx-decider-v1.3", label: "Perplexity Decider v1.3 (decision model, via OpenRouter)", key: "openrouter",
      provider: { kind: "decision", model: "perplexity/pplx-decider-v1.3:free" },
      fallback: { kind: "decision", model: "perplexity/pplx-decider-v1.2" },
      note: "Best in our benchmark: hid 53% of AI replies at 90% with no human reply hidden. Free on OpenRouter; when the free tier is rate limited it falls back to the paid v1.2 (about $0.007 per 1,000 replies)." },
    { id: "pplx-decider-v1.2", label: "Perplexity Decider v1.2 (decision model, via OpenRouter)", key: "openrouter",
      provider: { kind: "decision", model: "perplexity/pplx-decider-v1.2" },
      note: "Paid, about $0.007 per 1,000 replies. More conservative: hid 35% of AI replies at 90%, no humans." },
    { id: "jev-1.14", label: "TypeSafe Jev 1.14 (decision model, via OpenRouter)", key: "openrouter",
      provider: { kind: "decision", model: "typesafe/jev-1.14" },
      note: "Fast (about 230 ms) and ranks replies well, but its probabilities stay under 90%, so lower the threshold to about 60% if you use it." },
    { id: "gpt-6-luna-decisions", label: "OpenAI GPT-6 Luna Decisions (via OpenRouter)", key: "openrouter",
      provider: { kind: "decision", model: "openai/gpt-6-luna-decisions" },
      note: "Ranks replies well but is cautious: lower the threshold to about 60% if you use it." },
    { id: "gemini-decision-1", label: "Google Gemini Decision 1 (via OpenRouter)", key: "openrouter",
      provider: { kind: "decision", model: "google/gemini-decision-1" }, note: "" },
    { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (Google AI Studio key)", key: "gemini",
      provider: { kind: "gemini", model: "gemini-3.8-flash", thinking: { thinkingLevel: "low" } },
      note: "Accurate and never hid a human at 90%, but slow (about 1.8 s per batch) and about $0.10 per 1,000 replies." },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini (OpenAI key)", key: "openai",
      provider: { kind: "openai", model: "gpt-5.4-mini", reasoning: "none" },
      note: "Hid 7 human replies at 90% in our benchmark. Not recommended." }
  ];


  const DEFAULTS = {
    enabled: true,
    model: PRESETS[0].id,
    threshold: 0.9,          // hide only when the model is at least this sure
    scope: "all",            // "all" posts, or only "mine"
    hideGrok: true,          // @grok answers are AI replies by definition; hidden without an API call
    trusted: [],             // handles the user marked "not AI": never hidden
    keys: { openrouter: "", openai: "", gemini: "" }
  };

  async function load() {
    const got = await chrome.storage.local.get("settings");
    const s = { ...DEFAULTS, ...(got.settings || {}) };
    s.keys = { ...DEFAULTS.keys, ...(got.settings?.keys || {}) };
    return s;
  }
  async function save(patch) {
    const cur = await load();
    const next = { ...cur, ...patch, keys: { ...cur.keys, ...(patch.keys || {}) } };
    await chrome.storage.local.set({ settings: next });
    return next;
  }
  const preset = (id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

  root.SlopSettings = { PRESETS, DEFAULTS, load, save, preset };
})(typeof globalThis !== "undefined" ? globalThis : self);
