// Benchmark SlopGuard classifiers on the labeled eval set.
//   node bench/run.mjs                 # every model in bench/models.mjs
//   node bench/run.mjs jev-1.14 gpt    # only models whose name contains one of the filters
// Reads API keys from ../.env (never printed). Writes bench/results/<name>.json and bench/results/summary.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MODELS } from "./models.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { classify } = require("../src/classifier.js");

function loadEnv(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)).filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^['"]|['"]$/g, "")]));
}
const env = { ...loadEnv(join(here, "..", ".env")), ...process.env };
const keys = { openrouter: env.OPENROUTER_API_KEY, openai: env.OPENAI_API_KEY, gemini: env.GEMINI_API_KEY };

const THRESHOLD = 0.9;      // what the extension ships: hide at >= 90%
const BATCH = 10;           // replies per request, same as the extension
const CONCURRENCY = 4;
const HELDOUT_FROM = 8;
const threads = JSON.parse(readFileSync(join(here, "data", "eval.json"), "utf8"));
const filters = process.argv.slice(2);
const models = MODELS.filter((m) => !filters.length || filters.some((f) => m.name.includes(f)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, tries = 4) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= tries - 1 || ![429, 500, 502, 503, 529].includes(e.status)) throw e;
      await sleep(1000 * 2 ** i);
    }
  }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function auc(rows) {
  const pos = rows.filter((r) => r.label === 1).map((r) => r.p), neg = rows.filter((r) => r.label === 0).map((r) => r.p);
  let s = 0; for (const a of pos) for (const b of neg) s += a > b ? 1 : a === b ? 0.5 : 0;
  return pos.length && neg.length ? s / (pos.length * neg.length) : null;
}
function at(rows, t) {
  const tp = rows.filter((r) => r.label === 1 && r.p >= t).length, fp = rows.filter((r) => r.label === 0 && r.p >= t).length;
  const fn = rows.filter((r) => r.label === 1 && r.p < t).length, tn = rows.filter((r) => r.label === 0 && r.p < t).length;
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  return { t, tp, fp, fn, tn, accuracy: (tp + tn) / rows.length, precision, recall,
    f1: precision && recall ? (2 * precision * recall) / (precision + recall) : 0 };
}
const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

function costOf(model, usage) {
  if (!usage) return 0;
  if (typeof usage.cost === "number") return usage.cost;                       // OpenRouter reports cost directly
  const inTok = usage.prompt_tokens ?? usage.promptTokenCount ?? 0;
  const outTok = (usage.completion_tokens ?? 0) + (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  return (inTok * (model.price?.in || 0) + outTok * (model.price?.out || 0)) / 1e6;
}

mkdirSync(join(here, "results"), { recursive: true });
const summaryPath = join(here, "results", "summary.json");
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : {};
const totalReplies = threads.reduce((n, t) => n + t.replies.length, 0);

for (const model of models) {
  const jobs = threads.flatMap((t) => {
    const chunks = [];
    for (let i = 0; i < t.replies.length; i += BATCH) chunks.push({ thread: t, offset: i, replies: t.replies.slice(i, i + BATCH) });
    return chunks;
  });
  let errors = 0;
  const results = await pool(jobs, CONCURRENCY, async (job) => {
    const t0 = performance.now();
    try {
      const r = await withRetry(() => classify(model.provider, keys, job.thread.post, job.replies, { timeoutMs: 60000 }));
      return { job, ms: performance.now() - t0, ...r };
    } catch (e) {
      errors++; return { job, ms: performance.now() - t0, error: String(e.message || e).slice(0, 200), probs: job.replies.map(() => null) };
    }
  });
  const rows = results.flatMap((r) => r.job.replies.map((rep, i) => ({ thread: r.job.thread.id, idx: r.job.offset + i, label: rep.label, p: r.probs[i], text: rep.text.slice(0, 120) })));
  const scored = rows.filter((r) => r.p != null);
  const missing = rows.length - scored.length;
  // The prompt was tuned on threads t0-t7; t8-t14 were only used to check it.
  const heldout = scored.filter((r) => Number(r.thread.slice(1)) >= HELDOUT_FROM);
  const cost = results.reduce((s, r) => s + costOf(model, r.usage), 0);
  const lat = results.filter((r) => !r.error).map((r) => r.ms);
  const s = {
    name: model.name, provider: model.provider, servedModel: results.find((r) => r.model)?.model || null,
    n: rows.length, missing, errors, auc: auc(scored), heldoutAuc: auc(heldout), heldoutAt90: at(heldout, THRESHOLD),
    at50: at(scored, 0.5), at90: at(scored, THRESHOLD),
    brier: scored.reduce((a, r) => a + (r.p - r.label) ** 2, 0) / (scored.length || 1),
    latencyMs: { mean: lat.reduce((a, b) => a + b, 0) / (lat.length || 1), p50: pct(lat, 0.5), p90: pct(lat, 0.9) },
    costUsd: cost, costPer1kReplies: (cost / totalReplies) * 1000,
    firstError: results.find((r) => r.error)?.error || null, ranAt: new Date().toISOString()
  };
  summary[model.name] = s;
  writeFileSync(join(here, "results", `${model.name}.json`), JSON.stringify({ summary: s, rows }, null, 2));
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  const f = (x, d = 2) => (x == null ? "-" : x.toFixed(d));
  console.log(`${model.name.padEnd(26)} auc=${f(s.auc)} heldoutAuc=${f(s.heldoutAuc)} acc@.5=${f(s.at50.accuracy)} P@.9=${f(s.at90.precision)} R@.9=${f(s.at90.recall)} FP@.9=${s.at90.fp} ` +
    `lat p50=${Math.round(s.latencyMs.p50 || 0)}ms $/1k=${f(s.costPer1kReplies, 4)} missing=${missing} err=${errors}${s.firstError ? " " + s.firstError.slice(0, 120) : ""}`);
}
