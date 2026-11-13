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
const replies = [...thread.replies.map((r, i) => ({ ...r, id: String(1900000000000000100n + BigInt(i)) })),
  { key: "grok", handle: "grok", label: 1, text: "Great question! Based on recent reports, the post highlights an important trend worth watching.", id: "1900000000000000999" }];

const article = (handle, id, text, focal) => `
  <div data-testid="cellInnerDiv"><div><div>
    <article data-testid="tweet" role="article" tabindex="${focal ? -1 : 0}" style="padding:12px 16px;border-bottom:1px solid #2f3336">
      <div data-testid="User-Name"><a href="/${handle}"><b>${handle}</b></a> <span>@${handle}</span> · <a href="/${handle}/status/${id}"><time datetime="2026-11-13T10:00:00Z">2h</time></a></div>
      <div data-testid="tweetText" lang="en" style="margin-top:4px;${focal ? "font-size:17px" : ""}"><span>${esc(text)}</span></div>
      <div role="group"><button data-testid="reply">💬</button><button data-testid="like">♥</button></div>
    </article>
  </div></div></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><title>X</title></head>
<body style="margin:0;background:#000;color:#e7e9ea;font:15px -apple-system,system-ui,sans-serif">
  <nav><a data-testid="AppTabBar_Profile_Link" href="/someviewer">Profile</a></nav>
  <main style="max-width:600px;margin:0 auto;border-left:1px solid #2f3336;border-right:1px solid #2f3336">
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
