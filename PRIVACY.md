# SlopGuard privacy policy

_Last updated: 2026-11-13_

SlopGuard is a browser extension that hides AI-bot replies under posts on X (x.com). It has no server of its own and collects nothing for its developer.

## What it reads

When you open a post on X, SlopGuard reads the text and author handle of that post and of the replies shown on the page. It does not read your messages, your account details, your cookies or your browsing history, and it does nothing on other websites.

## What it sends, and to whom

To decide whether a reply is AI-generated, SlopGuard sends the post's text and author handle, and each reply's text and author handle, to the AI provider you choose in its settings:

- OpenRouter (openrouter.ai), the default, which forwards the request to the decision model you selected, or
- OpenAI (api.openai.com), or
- Google AI Studio (generativelanguage.googleapis.com).

The request is authenticated with the API key you enter. Those providers handle the data under their own privacy policies. SlopGuard's developer never receives it.

## What it stores

In your browser's local extension storage only:

- your settings and API key,
- the verdict for each reply it has checked (a reply id and a score), kept for 14 days so the same reply isn't checked twice,
- daily counts of replies checked and hidden, shown in the popup,
- the accounts you marked as "Not AI".

Nothing is synced or uploaded. Removing the extension deletes all of it, and **Clear cached verdicts** in the settings deletes the verdicts.

## What it does not do

- No analytics, tracking, ads or third-party scripts.
- No selling or sharing of data, and no use of data for anything except hiding replies.
- No remote code: everything that runs is in the published package.

## Contact

Questions or issues: https://github.com/stevyhacker/SlopGuard/issues
