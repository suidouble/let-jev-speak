# let-jev-speak

Coax free-text answers out of [TypeSafe](https://docs.typesafe.ai)'s
classification API by decoding one word at a time.

TypeSafe's `/v1/systemone` endpoint classifies text — it returns a `choice`, a
`score`, or a probability. It does not generate prose. This library makes it
generate prose anyway: every word of the answer is a separate `choice` question
over a vocabulary, and the loop feeds its own output back in as the prefix.

```
$ let-jev-speak "Why is the sky blue?"
Q: Why is the sky blue?
A: because light scattered by molecules shorter blue more than longer

domain:  science  [single]
routing: science=1.00  weather=0.00  nature=0.00
vocab:   199 words → 207 options
cost:    14 calls (1 route + 3 prior + 10 decode)
```

The model picks its own vocabulary: one `choice` call routes the question to one
of 28 domain packs, and the decode runs over that pack's words. Routing scores
**60/60** on a labelled set, and roughly doubles answer quality versus a generic
vocabulary.

> **Is this a good idea?** No. A single well-posed `choice` question answers the
> same question better, in one call, with a calibrated confidence attached. This
> is a working demonstration of what the endpoint can be pushed into doing, and
> a fairly precise map of where it stops. See [FINDINGS.md](FINDINGS.md).

## Install

Requires Node 18+ (global `fetch`). No dependencies.

```bash
git clone git@github.com:suidouble/let-jev-speak.git
cd let-jev-speak
```

Get a key from [console.typesafe.ai/keys](https://console.typesafe.ai/keys).

## Use

```js
import { LetJevSpeak } from 'let-jev-speak';

const jev = new LetJevSpeak(TYPESAFE_API_KEY);
const r = await jev.answer('Why do cats purr?');

r.text;      // "because happy are cats so purr."
r.domain;    // "nature"
r.routing;   // { choice, probabilities, confidence, top }
jev.stats;   // { calls, routeCalls, priorCalls, decodeCalls, inputTokens, ... }
```

### Credentials

Four ways to supply the key, in order of precedence:

```js
new LetJevSpeak(TYPESAFE_API_KEY);                    // a key string
new LetJevSpeak({ apiKey: TYPESAFE_API_KEY });        // the same, as an option
new LetJevSpeak(existingTypeSafeClient);              // a configured client
new LetJevSpeak();                                    // process.env.TYPESAFE_API_KEY
```

A key passed explicitly always beats the environment. With neither, the
constructor throws immediately rather than failing on the first request.

### Options

Passed as the second argument, or alongside `apiKey` in the first:

```js
new LetJevSpeak(TYPESAFE_API_KEY, { max: 12, alpha: 0.45 });
new LetJevSpeak({ apiKey: TYPESAFE_API_KEY, max: 12, alpha: 0.45 });
```

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | `process.env.TYPESAFE_API_KEY` | TypeSafe API key |
| `max` | `10` | Maximum words per answer |
| `min` | `5` | Suppress `end` below this length |
| `alpha` | `0.45` | How much of the per-option prior to divide out |
| `penalty` | `1.5` | Repetition damping |
| `blend` | `true` | Mix the top two domains when routing is close |
| `priorMode` | `'vocab'` | Cache priors per vocabulary, or per `'question'` |
| `maxRetries` | `3` | Retries on 429/5xx/network errors |

### CLI

```bash
export TYPESAFE_API_KEY=your-key-here            # or pass --key

node ask.js "Should I add an index to this column?"
node ask.js "What is a bond?" --domain finance   # skip routing
node ask.js "Why is the sky blue?" --key tsk-... # explicit key
node ask.js --domains                            # list the packs
node ask.js --vocab twitter                      # dump a pack's word list
```

### Just the API client

The underlying client is useful on its own, and is the thing you should reach
for if you want answers rather than prose:

```js
import { TypeSafe } from 'let-jev-speak/client';

const ts = new TypeSafe(TYPESAFE_API_KEY);   // or omit to read the environment
await ts.choice(text, 'Which team should handle this?', {
  billing: 'Payment or subscription issues',
  technical: 'Bugs or integration problems',
});
await ts.score(text, 'How frustrated is the customer?', [...levels]);
await ts.noul(text, 'The message conveys urgency');
await ts.batch(texts, questions, { concurrency: 4 });
```

It handles retries with backoff on 429/5xx, unwraps the API's FastAPI-style
error bodies into readable messages, and exposes `TypeSafeError` with `.status`
and `.body`.

## How it works

1. **Route** — one `choice` call over 28 domain descriptions picks the pack.
   When the top two are close the word budget splits across both; when nothing
   fits, it falls back to `general`.
2. **Calibrate** — measure each option's prior on content-free prefixes, cached
   per vocabulary.
3. **Decode** — one `choice` call per word over `CORE` + the domain's words,
   re-ranked by `probability / prior^alpha` with a repetition penalty.

Three constants matter, all tuned against the live API and explained in
[FINDINGS.md](FINDINGS.md): `alpha=0.45`, `penalty=1.5`, `min=5`.

## Domains

`general` `food` `science` `medicine` `law` `finance` `software` `support`
`emotion` `sports` `travel` `education` `history` `art-music` `nature`
`weather` `technology` `psychology` `math-logic` `shopping` `ai` `database`
`devops` `security` `networking` `webdev` `data-analytics` `twitter`

### Custom vocabularies

Register your own pack and it takes part in routing like any built-in:

```js
const jev = new LetJevSpeak(TYPESAFE_API_KEY);

jev.addDomain('crypto', {
  description: 'Cryptocurrency, blockchains, wallets, tokens, mining and exchanges',
  words: 'bitcoin wallet token chain block mining exchange ledger cold storage seed',
});

await jev.answer('What is a hardware wallet?');
// → { domain: 'crypto', text: 'is a secure wallet cold storage' }
```

Or declare them up front, which may override a built-in:

```js
new LetJevSpeak(TYPESAFE_API_KEY, { domains: { crypto: { description, words } } });
```

| Member | Purpose |
|---|---|
| `addDomain(key, pack, { replace })` | Register a pack. Throws on a name clash unless `replace: true`. Chainable. |
| `removeDomain(key)` | Drop a pack; returns whether one was removed. `general` is protected — it is the routing fallback. |
| `customDomainKeys` | Packs added or replaced on this instance |
| `vocabularyFor(key)` | The exact word list a pack would decode over, `CORE` included |

Two things to get right:

- **The description does real work.** The router picks between packs by meaning,
  so a vague description loses to a sharper neighbour. Make it contrastive
  against whatever it sits next to — this is why `software` says *"writing
  program code"* rather than *"technology"*.
- **Order words most- to least-important.** Assembly truncates from the tail to
  fit the per-domain budget (145 slots), so trailing words are dropped first.
  Oversized packs are accepted and simply truncated.

Words may be an array or a whitespace-separated string. Words already in `CORE`
and repeats are dropped automatically, since each would waste one of the 255
option slots; `most_people` expands to the two-word entry `most people`.

#### What is validated

Each word ends up inside an option description — `The next word is "<word>"` —
and in the rendered answer, so `addDomain` rejects anything that would corrupt
either, naming every offender:

| Rejected | Why |
|---|---|
| `he said "hi"` | A double quote nests inside the description and makes it ambiguous |
| `line1\nline2` | Control characters break the instructions' structure |
| `.` `,` `?` | Bare punctuation collides with the decoder's own punctuation options |
| 41+ characters | Bloats all ~10 decode calls (`MAX_WORD_LENGTH` is 40) |

Accents, emoji, apostrophes, hyphens and multi-word entries are all fine.

Oversized packs cannot breach the API ceiling — assembly truncates them, and
this is asserted for a 5000-word pack and for a blend of two. You get a
`LetJevSpeakVocabularyWarning` when it happens, and `domains` reports it:

```js
jev.domains.find(d => d.key === 'big');
// { size: 200, usable: 145, truncated: true, ... }
```

Packs are **per-instance** — `addDomain` never mutates the shared module
registry or another instance, so one `LetJevSpeak` cannot leak vocabulary into
the next.

To ship a pack as a built-in instead, add it to `vocabs.js` under the same two
rules, plus a coverage expectation in `test/vocabs.test.js`.

## Limits

- **Coherence holds for about 5–8 words**, then decays. Each step conditions on
  a prefix the decoder itself produced, so once it drifts nothing pulls it back.
- **The API caps a `choice` question at 255 options.** After punctuation and
  `CORE` that leaves 145 slots per domain — and a word absent from the pack can
  never be emitted.
- **Cost is ~11–14 API calls per answer.**

## Tests

Unit tests use the built-in `node:test` runner — no dependencies. They stub
`fetch`, so they are offline and deterministic.

```bash
npm test                 # 191 unit tests, no network
npm run test:watch       # re-run on change
npm run test:integration  # live API, needs TYPESAFE_API_KEY (skips without it)
```

| Suite | Covers |
|---|---|
| `test/typesafe.test.js` | Client construction, request shape, helpers, retry policy, error unwrapping |
| `test/decoder.test.js` | Option building, the 255 ceiling, rendering, prior measurement, decode guards |
| `test/vocabs.test.js` | Pack invariants, budget limits, and that each pack can say its own words |
| `test/letjevspeak.test.js` | Credentials, getters, vocabulary assembly, routing, prior caching, accounting |
| `test/custom-domains.test.js` | Registering, replacing and removing packs; validation; instance isolation |
| `test/word-safety.test.js` | Word validation, oversized packs, and the option ceiling under truncation |
| `test/integration/live.test.js` | Real API calls — shape and high-confidence judgements only |

Separately, `router-eval.js` *measures* live behaviour rather than asserting on
it — routing accuracy over a labelled set, and routed vs general vs deliberately
wrong vocabularies. It costs real API calls:

```bash
npm run eval             # both measurements
npm run eval:routing
npm run eval:benefit
```

## License

MIT
