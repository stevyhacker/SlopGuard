// node --test test/unit.test.js
const test = require("node:test");
const assert = require("node:assert");
const c = require("../src/classifier.js");

const post = { handle: "author", text: "We shipped dark mode." };
const replies = [{ handle: "a", text: "Great update! This shows real care for users 🚀" }, { handle: "b", text: "finally lol" }];

test("decision request asks two questions per reply over one shared state", () => {
  const req = c.buildDecisionRequest("perplexity/pplx-decider-v1.3:free", post, replies);
  assert.deepStrictEqual(Object.keys(req.questions).sort(), ["ai_0", "ai_1", "tone_0", "tone_1"]);
  assert.match(req.questions.ai_1.instructions, /`replies\.r1`/);
  assert.strictEqual(req.state.replies.r0.author, "@a");
  assert.strictEqual(req.state.original_post.text, post.text);
});

test("score is the higher of the two answers, null when both are missing", () => {
  const probs = c.parseDecision({ answers: { ai_0: { noul: 0.2 }, tone_0: { noul: 0.93 }, ai_1: { noul: 0.1 } } }, 3);
  assert.deepStrictEqual(probs, [0.93, 0.1, null]);
});

test("LLM scores are percentages and are clamped", () => {
  assert.deepStrictEqual(c.parseLLM('{"scores":{"r0":95,"r1":1,"r2":140}}', 4), [0.95, 0.01, 1, null]);
  assert.deepStrictEqual(c.parseLLM("```json\n{\"scores\":{\"r0\":50}}\n```", 1), [0.5]);
  assert.deepStrictEqual(c.parseLLM("not json", 1), [null]);
});

test("long text is clipped before it is sent", () => {
  const s = c.buildState({ handle: "x", text: "a".repeat(5000) }, [{ handle: "y", text: "b".repeat(5000) }]);
  assert.strictEqual(s.original_post.text.length, 1000);
  assert.strictEqual(s.replies.r0.text.length, c.MAX_REPLY);
});

test("classify sends only to OpenRouter's Decisions endpoint with the key", async () => {
  let seen;
  const fetch = async (url, init) => { seen = { url, init }; return { ok: true, text: async () => JSON.stringify({ model: "m", answers: { ai_0: { noul: 0.97 }, tone_0: { noul: 0.4 }, ai_1: { noul: 0.02 }, tone_1: { noul: 0.05 } } }) }; };
  const r = await c.classify({ kind: "decision", model: "m" }, { openrouter: "sk-test" }, post, replies, { fetch });
  assert.strictEqual(seen.url, "https://openrouter.ai/api/alpha/decisions");
  assert.strictEqual(seen.init.headers.Authorization, "Bearer sk-test");
  assert.deepStrictEqual(r.probs, [0.97, 0.05]);
});

test("HTTP errors carry the status so the worker can fall back on 429", async () => {
  const fetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(c.classify({ kind: "decision", model: "m" }, { openrouter: "k" }, post, replies, { fetch }), (e) => e.status === 429);
});
