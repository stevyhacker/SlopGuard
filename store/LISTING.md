# Chrome Web Store listing

Everything to paste into the Chrome Web Store developer dashboard. Build the package and images first:

```bash
node test/e2e.mjs t6 --shot   # captures store/raw/*.png from the real extension
node store/build.mjs          # writes dist/slopguard-<version>.zip and store/images/*.png
```

## Package

- Upload `dist/slopguard-0.1.0.zip`.

## Store listing tab

**Name** (from manifest): SlopGuard

**Summary** (from manifest, 132 characters max): Hides AI-bot slop replies under posts on X. One click brings any of them back.

**Category:** Social & Communication

**Language:** English

**Description:**

```
SlopGuard folds away AI-bot replies under posts on X, so the thread is just people again.

You know the replies: they restate the post back to its author, praise it in generic terms, add nothing new and read like an assistant wrote them. SlopGuard spots them and folds each one into a single line. Real people stay, even when they're short, rude, joking or wrong.

HOW IT WORKS
• Open any post on X. As replies load, SlopGuard checks them in small batches with an AI decision model.
• A reply is folded only when the model is at least 90% sure it's an AI bot. You can change the threshold.
• Click a folded reply to read it, hide it again, or mark the account "Not AI" so it's never hidden.
• A small counter shows how many replies were hidden, with "Show all".

PICKED BY BENCHMARK
We tested 14 models on 165 labeled replies from real X threads. The default, Perplexity Decider, hid about half of the AI replies and none of the 125 human ones. It's free on OpenRouter. You can also choose TypeSafe Jev, Google Gemini or OpenAI models. The full benchmark is open source.

SETUP
1. Get an API key from openrouter.ai (free models available).
2. Paste it into SlopGuard's settings and click Test connection.

PRIVACY
• No SlopGuard server, no analytics, no tracking.
• Only the post and reply text and handles are sent, and only to the AI provider you choose, using your own key.
• Your key and settings stay in your browser.

Open source (MIT): https://github.com/stevyhacker/SlopGuard
```

**Icon:** `icons/icon128.png`

**Screenshots** (1280×800, in this order):

1. `store/images/1-hides-ai-replies.png`
2. `store/images/2-one-click-back.png`
3. `store/images/3-benchmark.png`
4. `store/images/4-settings.png`

**Small promo tile** (440×280): `store/images/promo-small-440x280.png`

**Marquee promo tile** (1400×560, optional): `store/images/promo-marquee-1400x560.png`

**Homepage URL:** https://github.com/stevyhacker/SlopGuard

**Support URL:** https://github.com/stevyhacker/SlopGuard/issues

## Privacy practices tab

**Single purpose:**

```
SlopGuard hides AI-generated bot replies under posts on x.com. It reads the replies on the post you are viewing, asks an AI model the user chose whether each one is AI-generated, and folds the ones the model is confident about. The user can unhide any reply.
```

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings, their API key, the list of accounts they marked "Not AI", and cached verdicts so the same reply isn't checked twice. Everything stays in local extension storage. |
| Host `https://openrouter.ai/*` | Sends the post and reply text to the decision model the user selected, through OpenRouter's Decisions API, using the user's own API key. This is the default provider. |
| Host `https://api.openai.com/*` | Used only if the user picks an OpenAI model in settings: sends the post and reply text to OpenAI with the user's key. |
| Host `https://generativelanguage.googleapis.com/*` | Used only if the user picks a Google Gemini model in settings: sends the post and reply text to Google AI Studio with the user's key. |
| Content script on `https://x.com/*`, `https://twitter.com/*` | Reads the replies on the X post the user is viewing and folds the ones classified as AI bots, with a button to show each one again. |

**Remote code:** No, I am not using remote code. All JavaScript is in the package.

**Data usage** (check these boxes):

- **Website content**: the text and author handles of the post and its replies are sent to the AI provider the user selected, only to classify the replies.
- **Authentication information**: the API key the user enters is stored locally and sent only to that provider to authenticate requests.

Leave every other category unchecked. Then certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/stevyhacker/SlopGuard/blob/main/PRIVACY.md

## Distribution tab

- Visibility: Public
- Regions: All regions
- Pricing: Free
