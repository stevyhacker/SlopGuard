# SlopGuard

A Chrome extension that folds away AI-bot replies under posts on X, the "Great insight! This highlights…" kind that restate the post, add nothing, and read like an assistant wrote them.

Folded replies collapse into a one-line bar. Click it to bring the reply back, click **Hide again** to fold it, or **Not AI** to always trust that account. A small pill in the corner counts what was hidden and has **Show all**.

![SlopGuard on a thread](docs/screenshot.png)

## How it works

1. On a post's page (`x.com/<user>/status/<id>`), the content script reads the post and each reply as X renders them.
2. Replies are sent in batches of up to 10, together with the post, to a **decision model** through [OpenRouter's Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request). A decision model returns probabilities instead of text, so it is fast and cheap.
3. Each reply gets two yes/no questions: *was this written by an AI reply bot?* and *does it have an AI-assistant / ghostwriter tone?* The reply's score is the higher of the two. The questions are in [`src/classifier.js`](src/classifier.js).
4. A reply is folded when its score is **at least 90%** (adjustable in Settings).

Skipped without an API call: the post author's own replies, your own replies, accounts you trusted, and replies shorter than 16 characters. `@grok` answers are folded by rule (toggle in Settings). Verdicts are cached for 14 days, so a reply is never paid for twice.

## Install

1. Clone this repo.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the repo folder.
3. The settings page opens. Paste an [OpenRouter key](https://openrouter.ai/settings/keys), click **Save**, then **Test connection**.
4. Open any post on X.

Optional: **Only replies under my own posts** limits it to your posts. Other models (Jev, Gemini, OpenAI) are selectable in Settings.

## Benchmark

`bench/` compares 14 classifiers on a labeled set of real X replies. The default model was picked from these results.

**Data.** 15 recent English threads from large tech, AI, crypto and creator accounts (DHH, Paul Graham, Naval, Balaji, Guillermo Rauch, Greg Isenberg, Dan Koe, CZ, Saylor, David Sacks), 12 replies each, collected verbatim via Grok. 15 replies that were `@grok` itself or too ambiguous to call were dropped, leaving **165 replies: 40 AI slop, 125 human**. Labels are one person's judgment by the criteria above. Reply handles are replaced with hashes in [`bench/data/eval.json`](bench/data/eval.json).

**Method.** Same request format the extension uses (batches of 10, post + replies). The question wording was tuned on threads t0 to t7 and checked on the held-out threads t8 to t14. "Hidden @90%" is what the extension actually does at its default threshold. AUC measures how well a model ranks slop above human replies, independent of threshold. Cost is per 1,000 replies.

| Model | AUC | Held-out AUC | Slop hidden @90% | Humans hidden @90% | Held-out slop · humans @90% | p50 latency / batch | $ / 1k replies |
|---|---|---|---|---|---|---|---|
| **perplexity/pplx-decider-v1.3** (default) | **0.97** | **0.97** | **21/40** | **0/125** | 7/16 · 0/62 | 406 ms | free |
| perplexity/pplx-decider-v1.2 | 0.96 | 0.96 | 14/40 | 0/125 | 5/16 · 0/62 | 420 ms | $0.007 |
| gemini-3.8-flash (LLM) | 0.95 | 0.98 | 12/40 | 0/125 | 5/16 · 0/62 | 1834 ms | $0.097 |
| openai/gpt-6-luna-decisions | 0.96 | 0.95 | 2/40 | 0/125 | 0/16 · 0/62 | 343 ms | $0.060 |
| liquid/d1.1 | 0.94 | 0.94 | 28/40 | 6/125 | 9/16 · 5/62 | 614 ms | $0.007 |
| microsoft/microsoft-decision-1 | 0.92 | 0.91 | 23/40 | 3/125 | 9/16 · 3/62 | 521 ms | $0.015 |
| typesafe/jev-1.14 | 0.91 | 0.89 | 0/40 | 0/125 | 0/16 · 0/62 | 224 ms | $0.017 |
| typesafe/jev-1.13 | 0.91 | 0.89 | 0/40 | 0/125 | 0/16 · 0/62 | 212 ms | $0.017 |
| cloudflare/clef | 0.93 | 0.90 | 1/40 | 0/125 | 0/16 · 0/62 | 509 ms | $0.099 |
| google/gemini-decision-1 | 0.86 | 0.84 | 4/40 | 0/125 | 0/16 · 0/62 | 429 ms | $0.044 |
| cloudflare/clef-flash | 0.84 | 0.86 | 0/40 | 0/125 | 0/16 · 0/62 | 429 ms | $0.011 |
| gemini-3.5-flash-lite (LLM) | 0.90 | 0.85 | 18/40 | 4/125 | 6/16 · 3/62 | 797 ms | $0.049 |
| gpt-5.4-mini (LLM) | 0.86 | 0.84 | 19/40 | 7/125 | 5/16 · 6/62 | 952 ms | $0.108 |
| gpt-5.4-nano (LLM) | 0.78 | 0.76 | 2/40 | 3/125 | 0/16 · 1/62 | 1222 ms | $0.029 |

Run on 2026-11-13. Full per-reply scores are in [`bench/results/`](bench/results).

**Why Perplexity Decider v1.3.** It ranks best (AUC 0.97 on both halves), and it is the only model that reaches 90% often: it hides about half of the AI replies while hiding none of the 125 human ones. A repeat run gave the same numbers. It is free on OpenRouter; when the free tier is rate limited, the extension falls back to the paid v1.2, which is equally safe but hides fewer.

**Jev** ranks replies well (AUC 0.91) and is the fastest, but it never gives a probability above 90% on this task, so at the requested threshold it hides nothing. If you prefer Jev, pick it in Settings and lower the threshold to about 60%.

**Caveats.** 165 replies is a small set labeled by one person, and the question wording was tuned on part of it. The held-out half (78 replies) is the more honest number. The 90% default favors never hiding a real person over catching every bot, so expect roughly half of AI replies to stay visible.

### Reproduce

```bash
cp .env.example .env   # add OPENROUTER_API_KEY, and OPENAI_API_KEY / GEMINI_API_KEY for the LLM rows
node bench/run.mjs                  # all models
node bench/run.mjs pplx jev         # only models whose name matches
```

## Development

```bash
npm install          # Playwright, for the end-to-end test only
npm test             # unit tests (mocked network)
npm run check        # syntax + manifest
npm run test:e2e     # loads the extension in Chromium on a simulated X thread from the eval set, calls the real model
```

The end-to-end test serves a page that mimics X's DOM at an `x.com` URL, loads the unpacked extension, and checks that slop folds, humans stay, and Show / Hide again / Show all work.

## Privacy

Your API key stays in the extension's local storage and goes only to the provider you selected. For each reply, the provider receives the post's text and author handle and the reply's text and handle. Nothing else is sent, and nothing is sent to us.

## Limitations

- X changes its DOM often. SlopGuard relies on `data-testid="tweet"`, `tweetText` and the status links inside each post.
- Only post pages are filtered, not the home timeline.
- Text only. Images, videos and quoted posts are not judged.

## Credits

Inspired by [x-reply-filter](https://github.com/zhuyansen/x-reply-filter) and [x-reply-judge-jev](https://github.com/liaocaoxuezhe/x-reply-judge-jev). No code was copied.

MIT License.
