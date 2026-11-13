// SlopGuard content script: on a post's page, score the replies and fold away the AI slop.
(() => {
  const BATCH_DELAY_MS = 600;
  const MIN_CHARS = 16;            // tiny replies ("lol", "Amen!") are never AI slop worth paying to check
  const STATUS_RE = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/;

  let settings = null;
  let route = "";                  // status id of the page we are on
  let focal = null;                // { id, handle, text } of the post whose replies we judge
  let ancestors = new Set();       // thread posts above the focal post (not replies)
  const verdicts = new Map();      // tweet id -> { p, reason, state: "hidden" | "shown" | "clean" | "pending" }
  let queue = new Map();           // tweet id -> reply payload waiting to be sent
  let timer = null;
  let pill = null;
  let notice = "";
  let lastSentCount = -1;
  let checkedHere = 0;             // replies judged by the model on this page
  let recapUntil = 0;
  let dead = false;

  const alive = () => !dead && !!chrome.runtime?.id;
  function teardown() { dead = true; observer.disconnect(); pill?.remove(); }
  async function send(msg) {
    if (!alive()) return teardown();
    try { return await chrome.runtime.sendMessage(msg); }
    catch (e) { if (/context invalidated/i.test(String(e))) teardown(); return null; }
  }

  // ---------- reading X's DOM ----------
  const $ = (el, sel) => el.querySelector(sel);
  function textOf(el) {
    if (!el) return "";
    let s = "";
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeName === "IMG") s += n.getAttribute("alt") || "";
      else if (n.nodeType === 1) s += textOf(n);
    });
    return s.trim();
  }
  function identify(article) {
    for (const t of article.querySelectorAll("a[href*='/status/'] time")) {
      const m = (t.closest("a")?.getAttribute("href") || "").match(STATUS_RE);
      if (m) return { handle: m[1], id: m[2] };
    }
    return null;
  }
  function viewerHandle() {
    return ($(document, 'a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute("href") || "").replace("/", "").toLowerCase();
  }
  const isPromoted = (a) => !!$(a, '[data-testid="placementTracking"]') || /\bAd\b/.test($(a, '[data-testid="User-Name"]')?.parentElement?.innerText || "") && !identify(a);

  // ---------- folding ----------
  const pct = (p) => Math.round(p * 100) + "%";

  function barFor(article, id) {
    let bar = article.previousElementSibling;
    if (bar?.classList?.contains("sg-bar") && bar.dataset.id === id) return bar;
    bar = document.createElement("div");
    bar.className = "sg-bar";
    bar.dataset.id = id;
    article.parentElement.insertBefore(bar, article);
    return bar;
  }

  function renderBar(bar, v) {
    if (v.state === "hidden") {
      bar.className = "sg-bar sg-folded";
      bar.innerHTML = `<span class="sg-shield" aria-hidden="true"></span><span class="sg-text">Reply hidden by SlopGuard</span>` +
        `<span class="sg-chip">${v.reason}${v.p < 1 ? " · " + pct(v.p) : ""}</span><button class="sg-btn" data-act="show">Show</button>`;
      bar.setAttribute("role", "button");
      bar.title = "Click to show this reply";
    } else {
      bar.className = "sg-bar sg-revealed";
      bar.innerHTML = `<span class="sg-text">SlopGuard flagged this · ${v.reason}${v.p < 1 ? " " + pct(v.p) : ""}</span>` +
        `<button class="sg-btn" data-act="hide">Hide again</button><button class="sg-btn" data-act="trust">Not AI, trust @${v.handle}</button>`;
      bar.removeAttribute("role");
      bar.title = "";
    }
  }

  function fold(article, animate) {
    if (article.classList.contains("sg-hidden")) return;
    if (!animate) { article.classList.add("sg-hidden"); return; }
    const h = article.offsetHeight;
    article.style.maxHeight = h + "px";
    article.classList.add("sg-anim");
    requestAnimationFrame(() => requestAnimationFrame(() => { article.style.maxHeight = "0px"; article.style.opacity = "0"; }));
    setTimeout(() => { article.classList.add("sg-hidden"); article.classList.remove("sg-anim"); article.style.maxHeight = ""; article.style.opacity = ""; }, 260);
  }
  function unfold(article) {
    if (!article.classList.contains("sg-hidden")) return;
    article.classList.remove("sg-hidden");
    const h = article.scrollHeight;
    article.classList.add("sg-anim");
    article.style.maxHeight = "0px"; article.style.opacity = "0";
    requestAnimationFrame(() => requestAnimationFrame(() => { article.style.maxHeight = h + "px"; article.style.opacity = "1"; }));
    setTimeout(() => { article.classList.remove("sg-anim"); article.style.maxHeight = ""; article.style.opacity = ""; }, 260);
  }

  function apply(article, id, animate) {
    const v = verdicts.get(id);
    article.dataset.sgId = id;
    if (v) { article.dataset.sgState = v.state; if (v.state !== "pending") article.dataset.sgP = v.p.toFixed(2); }
    if (!v || v.state === "clean" || v.state === "pending") {
      if (article.previousElementSibling?.classList?.contains("sg-bar")) article.previousElementSibling.remove();
      if (article.classList.contains("sg-hidden")) article.classList.remove("sg-hidden");
      return;
    }
    const bar = barFor(article, id);
    if (bar.dataset.state !== v.state) { renderBar(bar, v); bar.dataset.state = v.state; }
    if (v.state === "hidden") fold(article, animate); else unfold(article);
  }

  function setState(id, state) {
    const v = verdicts.get(id);
    if (!v) return;
    v.state = state;
    document.querySelectorAll(`article[data-sg-id="${id}"]`).forEach((a) => apply(a, id, true));
    report();
  }

  document.addEventListener("click", async (e) => {
    const bar = e.target.closest?.(".sg-bar");
    if (!bar) return;
    e.preventDefault(); e.stopPropagation();
    const id = bar.dataset.id, v = verdicts.get(id);
    if (!v) return;
    const act = e.target.closest("[data-act]")?.dataset.act || (v.state === "hidden" ? "show" : null);
    if (act === "show") setState(id, "shown");
    if (act === "hide") setState(id, "hidden");
    if (act === "trust") {
      const trusted = [...new Set([...(settings.trusted || []), v.handle.toLowerCase()])];
      settings.trusted = trusted;
      const cur = (await chrome.storage.local.get("settings")).settings || {};
      await chrome.storage.local.set({ settings: { ...cur, trusted } });
      for (const [vid, vv] of verdicts) if (vv.handle?.toLowerCase() === v.handle.toLowerCase()) setState(vid, "clean");
    }
  }, true);

  // ---------- pill + badge ----------
  function report(added = 0) {
    const n = [...verdicts.values()].filter((v) => v.state === "hidden").length;
    const pending = [...verdicts.values()].filter((v) => v.state === "pending").length;
    if (n !== lastSentCount || added) { lastSentCount = n; send({ type: "hiddenCount", n, added }); }
    if (!pill) {
      pill = document.createElement("div");
      pill.className = "sg-pill";
      pill.addEventListener("click", (e) => {
        const act = e.target.closest("[data-act]")?.dataset.act;
        if (act === "showall") for (const [id, v] of verdicts) if (v.state === "hidden") setState(id, "shown");
        if (act === "options") send({ type: "openOptions" });
      });
      document.body.appendChild(pill);
    }
    const recap = Date.now() < recapUntil;   // brief "checked N" note so a clean thread doesn't look broken
    const show = settings?.enabled && route && (n || pending || notice || recap);
    pill.classList.toggle("sg-pill-on", !!show);
    if (!show) return;
    const markup = `<span class="sg-shield" aria-hidden="true"></span><b>SlopGuard</b>` +
      (notice ? `<span>${notice}</span><a data-act="options">Settings</a>` :
        !n && !pending ? `<span>checked ${checkedHere} ${checkedHere === 1 ? "reply" : "replies"} · none hidden</span>` :
        `<span>${n} hidden${pending ? ` · checking ${pending}` : ""}</span>${n ? '<a data-act="showall">Show all</a>' : ""}`);
    if (pill.innerHTML !== markup) pill.innerHTML = markup;
  }

  // ---------- scanning ----------
  function resetRoute(id) {
    route = id; focal = null; ancestors = new Set(); queue = new Map(); notice = ""; checkedHere = 0; recapUntil = 0;
    for (const [k, v] of verdicts) if (v.state === "pending") verdicts.delete(k);
    report();
  }

  function scan() {
    if (!settings?.enabled) return;
    const m = location.pathname.match(STATUS_RE);
    const id = m?.[2] || "";
    if (id !== route) resetRoute(id);
    if (!route) return;

    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    let focalEl = null;
    for (const a of articles) if (identify(a)?.id === route) { focalEl = a; break; }
    if (focalEl && !focal) {
      const who = identify(focalEl);
      focal = { id: who.id, handle: who.handle, text: textOf($(focalEl, '[data-testid="tweetText"]')) };
    }
    if (!focal) return;
    if (settings.scope === "mine" && focal.handle.toLowerCase() !== viewerHandle()) return;

    const me = viewerHandle();
    const trusted = new Set((settings.trusted || []).map((h) => h.toLowerCase()));
    for (const a of articles) {
      if (a === focalEl || a.closest(".sg-bar")) continue;
      const who = identify(a);
      if (!who || who.id === route || ancestors.has(who.id)) continue;
      if (focalEl && (a.compareDocumentPosition(focalEl) & Node.DOCUMENT_POSITION_FOLLOWING)) { ancestors.add(who.id); continue; }
      const h = who.handle.toLowerCase();
      if (h === focal.handle.toLowerCase() || h === me || trusted.has(h) || isPromoted(a)) continue;

      if (!verdicts.has(who.id)) {
        const text = textOf($(a, '[data-testid="tweetText"]'));
        if (h === "grok" && settings.hideGrok) verdicts.set(who.id, { p: 1, reason: "Grok answer", handle: who.handle, state: "hidden" });
        else if (text.replace(/\s/g, "").length < MIN_CHARS) verdicts.set(who.id, { p: 0, handle: who.handle, state: "clean" });
        else { verdicts.set(who.id, { p: 0, handle: who.handle, state: "pending" }); queue.set(who.id, { id: who.id, handle: who.handle, text }); }
        if (verdicts.get(who.id).state === "hidden") report(1);
      }
      apply(a, who.id, false);
    }
    if (queue.size && !timer) timer = setTimeout(flush, BATCH_DELAY_MS);
    report();
  }

  async function flush() {
    timer = null;
    if (!queue.size || !focal) return;
    const batch = [...queue.values()];
    queue = new Map();
    const forRoute = route;
    report();
    const res = await send({ type: "classify", post: focal, replies: batch });
    if (forRoute !== route) return;
    if (!res || res.error === "no-key") notice = "add an API key to start";
    else if (res.error && !Object.keys(res.results || {}).length) notice = "model unavailable, nothing hidden";
    else notice = "";
    let added = 0;
    for (const r of batch) {
      const v = verdicts.get(r.id);
      if (!v || v.state !== "pending") continue;
      const p = res?.results?.[r.id];
      if (typeof p !== "number") { verdicts.delete(r.id); continue; }  // retry on a later scan
      v.p = p;
      v.reason = "likely AI reply";
      v.state = p >= settings.threshold ? "hidden" : "clean";
      if (v.state === "hidden") added++;
      document.querySelectorAll(`article[data-sg-id="${r.id}"]`).forEach((a) => apply(a, r.id, true));
    }
    const judged = batch.filter((r) => verdicts.get(r.id) && verdicts.get(r.id).state !== "pending").length;
    checkedHere += judged;
    console.info(`[SlopGuard] ${res?.model || "?"}: checked ${judged}/${batch.length} replies, hid ${added}` + (res?.error ? ` (error: ${res.error})` : ""));
    if (judged && !added) { recapUntil = Date.now() + 4000; setTimeout(() => report(), 4100); }
    report(added);
    scan();
  }

  // Ignore mutations we caused ourselves (pill, bars), or scanning would retrigger itself forever.
  const ours = (n) => n.nodeType === 1 && (n.classList?.contains("sg-pill") || n.classList?.contains("sg-bar") || n.closest?.(".sg-pill, .sg-bar"));
  const observer = new MutationObserver((muts) => { if (muts.every((m) => ours(m.target) || [...m.addedNodes, ...m.removedNodes].every(ours) && m.type === "childList" && (m.addedNodes.length || m.removedNodes.length))) return; if (!scanQueued) { scanQueued = true; requestAnimationFrame(() => { scanQueued = false; if (alive()) scan(); else teardown(); }); } });
  let scanQueued = false;

  async function init() {
    const got = await chrome.storage.local.get("settings");
    settings = { enabled: true, threshold: 0.9, scope: "all", hideGrok: true, trusted: [], ...(got.settings || {}) };
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  }
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.settings || !alive()) return;
    const before = settings;
    settings = { ...settings, ...changes.settings.newValue };
    if (before.enabled && !settings.enabled) for (const [id, v] of verdicts) if (v.state === "hidden") setState(id, "shown");
    if (before.model !== settings.model || before.threshold !== settings.threshold) { verdicts.clear(); document.querySelectorAll(".sg-bar").forEach((b) => b.remove()); document.querySelectorAll("article.sg-hidden").forEach((a) => a.classList.remove("sg-hidden")); }
    scan(); report();
  });
  init();
})();
