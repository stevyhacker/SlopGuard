// End-to-end test: loads the unpacked extension in Chromium, serves an X-like conversation page at
// https://x.com/<author>/status/<id> (built from a real thread in bench/data/eval.json), and checks that
// the extension folds the replies the live model is confident about, unfolds on click, and leaves humans alone.
//   OPENROUTER_API_KEY=... node test/e2e.mjs [threadId]    (or put the key in .env)
import { chromium } from "playwright";
import { readFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = existsSync(join(root, ".env")) ? Object.fromEntries(readFileSync(join(root, ".env"), "utf8").split("\n").map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v])) : {};
const KEY = process.env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY;
if (!KEY) { console.error("Set OPENROUTER_API_KEY"); process.exit(1); }

const threadId = process.argv[2] || "t6";
const thread = JSON.parse(readFileSync(join(root, "bench/data/eval.json"), "utf8")).find((t) => t.id === threadId);
const STATUS = "1900000000000000000";
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let replies = [...thread.replies.map((r, i) => ({ ...r, id: String(1900000000000000100n + BigInt(i)) })),
  { key: "grok", handle: "grok", label: 1, text: "Great question! Based on recent reports, the post highlights an important trend worth watching.", id: "1900000000000000999" }];
const SHOT = process.argv.includes("--shot");
// For the README screenshot, interleave a few replies so folded and normal ones both sit near the top.
const SHOT_ORDER = ["6.1", "6.0", "6.3", "6.11", "6.9", "grok", "6.5", "6.2"];
if (SHOT && threadId === "t6") replies = [...SHOT_ORDER.map((k) => replies.find((r) => r.key === k)), ...replies.filter((r) => !SHOT_ORDER.includes(r.key))];

// Markup mirrors the parts of X's DOM SlopGuard reads (data-testid, status links, cellInnerDiv), styled like X's dark theme.
const NAMES = ["Maya R.", "Jordan Lee", "Priya S.", "Tom Becker", "Lina Ortiz", "Sam Okafor", "Noah W.", "Ava Chen", "Leo Marin", "Iris N.", "Kai Duarte", "Ruth B.", "Omar F."];
const COLORS = ["#7856ff", "#00ba7c", "#f91880", "#ffd400", "#1d9bf0", "#ff7a00", "#8b98a5"];
const icon = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICONS = [
  icon('<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.1-5.7A8.4 8.4 0 1 1 21 11.5Z"/>'),
  icon('<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  icon('<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z"/>'),
  icon('<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>')
];
let n = 0;
const article = (handle, id, text, focal) => {
  const i = n++;
  const name = focal ? handle.toUpperCase().replace(/^THEDANKOE$/, "DAN KOE") : NAMES[i % NAMES.length];
  const counts = [3 + (i * 7) % 40, (i * 3) % 9, 12 + (i * 37) % 300, `${1 + (i * 13) % 9}.${i % 10}K`];
  return `
  <div data-testid="cellInnerDiv"><div><div>
    <article data-testid="tweet" role="article" tabindex="${focal ? -1 : 0}" class="tw${focal ? " focal" : ""}">
      <div class="av" style="background:${COLORS[i % COLORS.length]}">${name[0]}</div>
      <div class="bd">
        <div data-testid="User-Name" class="un"><a href="/${handle}" class="nm">${name}</a><span class="mu">@${handle}</span><span class="mu">·</span><a class="mu" href="/${handle}/status/${id}"><time datetime="2026-11-13T10:00:00Z">${focal ? "8h" : (1 + i % 7) + "h"}</time></a></div>
        <div data-testid="tweetText" lang="en" class="tx"><span>${esc(text)}</span></div>
        <div role="group" class="ac">${ICONS.map((ic, k) => `<span data-testid="${["reply", "retweet", "like", "views"][k]}">${ic}<i>${counts[k]}</i></span>`).join("")}</div>
      </div>
    </article>
  </div></div></div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><title>X</title><style>
  body{margin:0;background:#000;color:#e7e9ea;font:15px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:inherit;text-decoration:none}
  nav{display:none}
  main{max-width:600px;margin:0 auto;border-left:1px solid #2f3336;border-right:1px solid #2f3336;min-height:100vh}
  .hdr{position:sticky;top:0;padding:14px 16px;font-weight:700;font-size:20px;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);z-index:3}
  .tw{display:flex;gap:10px;padding:12px 16px;border-bottom:1px solid #2f3336}
  .av{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#fff}
  .bd{flex:1;min-width:0}
  .un{display:flex;gap:4px;align-items:baseline}.nm{font-weight:700}.mu{color:#71767b}
  .tx{margin-top:2px;white-space:pre-wrap;word-wrap:break-word}
  .focal .tx{font-size:17px;line-height:24px;margin-top:8px}
  .ac{display:flex;justify-content:space-between;max-width:425px;margin-top:10px;color:#71767b;font-size:13px}
  .ac span{display:flex;align-items:center;gap:4px}.ac i{font-style:normal}
</style></head>
<body>
  <nav><a data-testid="AppTabBar_Profile_Link" href="/someviewer">Profile</a></nav>
  <main>
    <div class="hdr">Post</div>
    <div aria-label="Timeline: Conversation"><div id="tl">
      ${article(thread.post.handle, STATUS, thread.post.text, true)}
      ${replies.slice(0, 6).map((r) => article(r.handle, r.id, r.text)).join("")}
    </div></div>
  </main>
  <script>
    // Like X: more replies stream in as you scroll.
    const later = ${JSON.stringify(replies.slice(6).map((r) => article(r.handle, r.id, r.text)))};
    setTimeout(() => document.getElementById("tl").insertAdjacentHTML("beforeend", later.join("")), 1500);
  </script>
</body></html>`;

const outDir = join(root, "test", "out");
mkdirSync(outDir, { recursive: true });
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "slopguard-")), {
  headless: true, channel: "chromium", viewport: { width: 700, height: 1400 }, deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`]
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
await sw.evaluate((k) => chrome.storage.local.set({ settings: { keys: { openrouter: k } } }), KEY);
// Opening options on install opens a tab; close it.
for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();

await ctx.route("https://x.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
const page = await ctx.newPage();
page.on("console", (m) => { if (/SlopGuard/.test(m.text())) console.log("  page:", m.text()); });
await page.goto(`https://x.com/${thread.post.handle}/status/${STATUS}`);
await page.screenshot({ path: join(outDir, "before.png") });

// Wait until every reply is either folded or judged clean (pending count reaches zero).
const t0 = Date.now();
await page.waitForFunction((n) => document.querySelectorAll("article[data-sg-id]").length >= n && !/checking/.test(document.querySelector(".sg-pill")?.textContent || ""), replies.length, { timeout: 60000 });
await page.waitForTimeout(400);
const ms = Date.now() - t0;
await page.screenshot({ path: join(outDir, "after.png") });
if (SHOT) {
  // README screenshot: reveal one folded reply so both states show, crop to the column with the pill in view.
  const firstHidden = await page.$eval("article.sg-hidden", (a) => a.dataset.sgId).catch(() => null);
  if (firstHidden) { await page.click(`.sg-bar[data-id="${firstHidden}"]`); await page.waitForTimeout(400); }
  await page.setViewportSize({ width: 700, height: 1180 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const box = await page.$eval("main", (m) => { const r = m.getBoundingClientRect(); return { x: r.x, width: r.width }; });
  await page.screenshot({ path: join(root, "docs", "screenshot.png"), clip: { x: box.x - 40, y: 0, width: box.width + 80, height: 1180 } });
  console.log("wrote docs/screenshot.png");
}

const hiddenIds = await page.$$eval("article.sg-hidden", (as) => as.map((a) => a.dataset.sgId));
const rows = replies.map((r) => ({ key: r.key, label: r.label, hidden: hiddenIds.includes(r.id), text: r.text.slice(0, 70) }));
for (const r of rows) console.log(`${r.hidden ? "HIDDEN" : "shown "} ${r.label ? "slop " : "human"} ${r.key.padEnd(5)} ${r.text}`);
const humansHidden = rows.filter((r) => r.hidden && !r.label).length;
const slopHidden = rows.filter((r) => r.hidden && r.label).length;
console.log(`\n${slopHidden}/${rows.filter((r) => r.label).length} slop folded, ${humansHidden} human replies folded, all judged in ${ms} ms`);

// Unhide one by clicking its bar, then fold it again, then "Show all".
let ok = humansHidden === 0 && slopHidden > 0;
if (hiddenIds.length) {
  await page.click(`.sg-bar[data-id="${hiddenIds[0]}"]`);
  await page.waitForTimeout(400);
  const visible = await page.$eval(`article[data-sg-id="${hiddenIds[0]}"]`, (a) => !a.classList.contains("sg-hidden") && a.offsetHeight > 20);
  await page.screenshot({ path: join(outDir, "unhidden.png") });
  await page.click(`.sg-bar[data-id="${hiddenIds[0]}"] [data-act="hide"]`);
  await page.waitForTimeout(400);
  const refolded = await page.$eval(`article[data-sg-id="${hiddenIds[0]}"]`, (a) => a.classList.contains("sg-hidden"));
  await page.click('.sg-pill [data-act="showall"]');
  await page.waitForTimeout(400);
  const remaining = await page.$$eval("article.sg-hidden", (as) => as.length);
  console.log(`click to show: ${visible ? "ok" : "FAIL"}, hide again: ${refolded ? "ok" : "FAIL"}, show all: ${remaining === 0 ? "ok" : "FAIL"}`);
  ok = ok && visible && refolded && remaining === 0;
}
await ctx.close();
console.log(ok ? "PASS" : "FAIL");
process.exit(ok ? 0 : 1);
