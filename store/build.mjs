// Builds the Chrome Web Store upload: dist/slopguard-<version>.zip plus listing images in store/images/.
//   node test/e2e.mjs t6 --shot   # first, to capture store/raw/*.png from the real extension
//   node store/build.mjs
import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const raw = join(root, "store", "raw");
const out = join(root, "store", "images");
mkdirSync(out, { recursive: true });
mkdirSync(join(root, "dist"), { recursive: true });

// 1. Extension package: only what the extension loads.
const zip = join(root, "dist", `slopguard-${version}.zip`);
if (existsSync(zip)) rmSync(zip);
execFileSync("zip", ["-r", "-X", "-q", zip, "manifest.json", "src", "icons", "-x", "*.DS_Store", "icons/icon.svg"], { cwd: root });
console.log("wrote", zip);

// 2. Listing images.
const img = (f) => "data:image/png;base64," + readFileSync(f).toString("base64");
const icon = img(join(root, "icons", "icon128.png"));
const css = `
  *{box-sizing:border-box;margin:0}
  body{background:#f6f7f9;color:#18181b;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden}
  .brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:22px;color:#3f3f46}
  .brand img{width:40px;height:40px;border-radius:10px}
  h1{font-family:ui-serif,"New York",Georgia,serif;font-weight:700;letter-spacing:-.01em;color:#18181b}
  h1 span{color:#4a86d4}
  p{color:#52525b}
`;
const slide = (title, sub, picture, { dark = true, fit = "top" } = {}) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body{width:1280px;height:800px;display:grid;grid-template-columns:470px 1fr;gap:0}
  .l{padding:64px 40px 64px 64px;display:flex;flex-direction:column}
  h1{font-size:50px;line-height:1.08;margin-top:150px}
  p{font-size:22px;line-height:1.45;margin-top:22px}
  .r{padding:48px 56px 0 10px;display:flex;align-items:flex-start;justify-content:center}
  .frame{width:100%;height:752px;border-radius:22px 22px 0 0;overflow:hidden;background:${dark ? "#000" : "#fff"};
    box-shadow:0 30px 70px rgba(30,41,59,.18),0 0 0 1px rgba(30,41,59,.08)}
  .frame img{width:100%;height:100%;object-fit:cover;object-position:${fit}}
</style></head><body>
  <div class="l"><div class="brand"><img src="${icon}">SlopGuard</div><h1>${title}</h1><p>${sub}</p></div>
  <div class="r"><div class="frame"><img src="${picture}"></div></div>
</body></html>`;

const wide = (title, picture) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body{width:1280px;height:800px;padding:40px 64px;display:flex;flex-direction:column;align-items:center}
  .top{width:100%;display:flex;align-items:center;justify-content:space-between}
  h1{font-size:36px}
  .frame{margin-top:26px;width:1060px;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(30,41,59,.14),0 0 0 1px rgba(30,41,59,.08)}
  .frame img{display:block;width:100%}
</style></head><body>
  <div class="top"><div class="brand"><img src="${icon}">SlopGuard</div><h1>${title}</h1></div>
  <div class="frame"><img src="${picture}"></div>
</body></html>`;

const slides = [
  ["1-hides-ai-replies", slide("Hides <span>AI-bot replies</span> on X", "Replies that only echo the post and add nothing fold into a single line. Real people stay, even when they're short or rude.", img(join(raw, "folded.png")))],
  ["2-one-click-back", slide("One click brings it <span>back</span>", "Read any folded reply, hide it again, or mark the account “Not AI” so it's never hidden.", img(join(raw, "revealed.png")))],
  ["3-benchmark", wide("Half the bots hidden, <span>zero humans</span>", img(join(root, "docs", "benchmark.png")))],
  ["4-settings", slide("Your threshold, <span>your model</span>", "Hides only at 90% confidence by default. Uses the free Perplexity Decider, or pick Jev, Gemini or OpenAI.", img(join(raw, "options.png")), { fit: "top" })]
];

const tile = (w, h, big) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
  body{width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;gap:${big ? 40 : 22}px;
    background:linear-gradient(135deg,#eef4fd 0%,#f6f7f9 55%,#eaf6ee 100%)}
  img{width:${big ? 150 : 84}px;height:${big ? 150 : 84}px;border-radius:${big ? 34 : 20}px;box-shadow:0 14px 34px rgba(30,41,59,.18)}
  h1{font-size:${big ? 76 : 40}px;line-height:1}
  p{font-size:${big ? 28 : 17}px;margin-top:${big ? 14 : 8}px;line-height:1.3;max-width:${big ? 760 : 250}px}
</style></head><body><img src="${icon}"><div><h1>SlopGuard</h1><p>Hides AI-bot replies on X. One click brings them back.</p></div></body></html>`;

const b = await chromium.launch();
async function render(name, html, width, height) {
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await p.setContent(html);
  await p.waitForTimeout(150);
  await p.screenshot({ path: join(out, name + ".png") });
  await p.close();
  console.log("wrote", `store/images/${name}.png`, `${width}x${height}`);
}
for (const [name, html] of slides) await render(name, html, 1280, 800);
await render("promo-small-440x280", tile(440, 280, false), 440, 280);
await render("promo-marquee-1400x560", tile(1400, 560, true), 1400, 560);
await b.close();
