// Candidates. Decision models go through OpenRouter's Decisions API (cost is reported by OpenRouter).
// LLM prices are USD per 1M tokens, used only to estimate cost from reported token counts.
const decision = (name, model) => ({ name, provider: { kind: "decision", model } });

export const MODELS = [
  // Decision models (return a probability directly, no text generation)
  decision("jev-1.14", "typesafe/jev-1.14"),
  decision("jev-1.13", "typesafe/jev-1.13"),
  decision("gemini-decision-1", "google/gemini-decision-1"),
  decision("gpt-6-luna-decisions", "openai/gpt-6-luna-decisions"),
  decision("clef", "cloudflare/clef"),
  decision("clef-flash", "cloudflare/clef-flash"),
  decision("liquid-d1.1", "liquid/d1.1"),
  decision("pplx-decider-v1.3", "perplexity/pplx-decider-v1.3:free"),
  decision("pplx-decider-v1.2", "perplexity/pplx-decider-v1.2"),
  decision("microsoft-decision-1", "microsoft/microsoft-decision-1"),

  // Generative LLMs asked for a 0-100 score per reply as JSON
  { name: "gpt-5.4-nano", provider: { kind: "openai", model: "gpt-5.4-nano", reasoning: "none" }, price: { in: 0.2, out: 1.25 } },
  { name: "gpt-5.4-mini", provider: { kind: "openai", model: "gpt-5.4-mini", reasoning: "none" }, price: { in: 0.75, out: 4.5 } },
  { name: "gemini-3.5-flash-lite", provider: { kind: "gemini", model: "gemini-3.5-flash-lite", thinking: { thinkingLevel: "minimal" } }, price: { in: 0.3, out: 2.5 } },
  { name: "gemini-3.8-flash", provider: { kind: "gemini", model: "gemini-3.8-flash", thinking: { thinkingLevel: "low" } }, price: { in: 0.75, out: 3.75 } }
];
