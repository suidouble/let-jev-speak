# tg_bot — @jefstalks_bot

A Telegram bot that answers questions one word at a time, on
[Telegram's serverless platform](https://core.telegram.org/bots/serverless).

There is no language model writing sentences here. Each word is a separate
`choice` question put to TypeSafe's **classification** API — "what is the next
word?" — over a vocabulary picked to match the question. The partial answer is
streamed as a [live draft](https://core.telegram.org/api/bots/ai#live-response-streaming)
so you watch it assemble itself.

```
Why do cats purr?
  → because happy are they and also comfort in
    — nature · 9 calls · 5.5s
```

The library doing the decoding is [`let-jev-speak`](../README.md) in the parent
directory; see [FINDINGS.md](../FINDINGS.md) for why this works at word level
and not at character level.

## Layout

| Path | What it is |
|---|---|
| `handlers/message.js` | The only update handler — commands, quota, streaming |
| `lib/answer.js` | Routing + decode, with precomputed priors |
| `lib/streamer.js` | `sendMessageDraft` throttling and flood handling |
| `lib/store.js` | Config and per-user rate limiting |
| `lib/compat.js` | Shims for globals the isolate lacks |
| `lib/priors.js` | **Generated** — per-domain priors |
| `lib/{typesafe,decoder,vocabs,letjevspeak}.js` | **Vendored** from the root library |
| `schema.js` | `config` and `usage` tables |

## Why the library is vendored

The platform resolves modules by bare name inside the project — `from 'lib/x'`.
A relative import reaching `../../LetJevSpeak.js` will not compile, and there
are no npm packages at runtime. So the four library modules are copied in:

```bash
npm run sync     # copy from ../, rewriting './decoder.js' -> 'lib/decoder'
npm run check    # fail if lib/ has drifted from the root
```

`npm test` runs `check`, so a stale copy fails the suite.

## Setup

```bash
npm install
export TGCLOUD_TOKEN=app<id>:<secret>    # BotFather -> bot -> Serverless -> CLI Access

npm run priors                            # measure per-domain priors (84 API calls)
npx tgcloud push                          # deploy modules
npx tgcloud migrate --safe                # create the config and usage tables
```

The platform offers no environment variables or secret store, so the TypeSafe
key lives in the `config` table. Seed it out-of-band — this path is reachable
only via `tgcloud run`, never from a chat message, so the key never appears in
a conversation or in git:

```bash
npx tgcloud run message "{ __setkey: '$TYPESAFE_API_KEY', chat: { id: 0 } }"
```

## Checking it works

```bash
npx tgcloud run message "{ __dry: true, text: 'Why do cats purr?', chat: { id: 0 }, from: { id: 0 } }"
```

`__dry` runs routing and decoding with no Telegram calls and returns the timing
of every frame — the quickest way to confirm a deploy.

## What this runtime does not have

Probed, not assumed:

```
AbortSignal: undefined   setTimeout: undefined   process: undefined
Response:    undefined   URL:        undefined
```

`lib/compat.js` installs shims, because `lib/typesafe.js` is vendored verbatim
and calls `AbortSignal.timeout` on every request. Without timers, retries have
no backoff and draft throttling compares `Date.now()` rather than scheduling.

**Two traps cost real time, and are now covered by `npm test`:**

1. **Raw control characters** anywhere in a source file fail compilation. The
   root `vocabs.js` had literal `0x00`/`0x1F`/`0x7F` bytes inside a regex — valid
   JavaScript, and all 191 root tests passed, but the compiler rejected the
   module with no line number.
2. **Top-level references to absent globals** fail compilation. Inside a
   function body they are fine; at module scope `process.env.X` is fatal.

Compilation errors arrive as a bare `Compilation failed` with no location, so
bisecting by pushing one module at a time is the fastest way in.

## Costs and limits

An answer is **1 routing call + up to 8 decode calls**, at ~620ms each from the
platform — around 5.5s. Precomputing the priors (`lib/priors.js`) removes the 3
calls `measurePrior` would otherwise add to every answer.

There is **no 5-second handler limit**: a probe ran 30 sequential requests over
19.2s and completed. The constraint is the user's patience, which is what the
streaming draft is for.

Per-user quota is 20 answers per hour (`lib/store.js`), because an open bot is
an open invoice against the API key.

Draft streaming stays inside Telegram's limits — 20 calls per 5s and 40 per 30s
per recipient — with a 300ms floor as insurance and `retry_after` respected on
429. A dropped frame is cosmetic: the final `sendMessage` is what persists.

## Commands

| Command | Does |
|---|---|
| `/start` | What the bot is, and honest expectations |
| `/help` | Usage and the quota |
| `/domains` | The 28 vocabularies |
| anything else | Routed and answered |

## Answer quality

Answers are 8 words or fewer and often ungrammatical. That is inherent: each
step conditions on a prefix the decoder itself produced, so coherence holds for
5–8 words and then drifts. A word absent from the chosen vocabulary can never be
emitted at all. This is a demonstration that a classifier can be made to talk —
not a chat assistant.
