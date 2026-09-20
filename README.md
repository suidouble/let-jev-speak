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
git clone git@github.com:jeka-kiselyov/let-jev-speak.git
cd let-jev-speak
export TYPESAFE_API_KEY=your-key-here   # https://console.typesafe.ai/keys
```

## Use

```js
import { LetJevSpeak } from 'let-jev-speak';

const jev = new LetJevSpeak();               // reads TYPESAFE_API_KEY
const r = await jev.answer('Why do cats purr?');

r.text;      // "because happy are cats so purr."
r.domain;    // "nature"
r.routing;   // { choice, probabilities, confidence, top }
jev.stats;   // { calls, routeCalls, priorCalls, decodeCalls, inputTokens, ... }
```

The constructor also takes a key, an options object, or an existing client:

```js
new LetJevSpeak('sk-...');
new LetJevSpeak({ apiKey, max: 12, alpha: 0.45, penalty: 1.5, blend: true });
new LetJevSpeak(existingTypeSafeClient);
```

### CLI

```bash
node ask.js "Should I add an index to this column?"
node ask.js "What is a bond?" --domain finance   # skip routing
node ask.js --domains                            # list the packs
node ask.js --vocab twitter                      # dump a pack's word list
```

### Just the API client

The underlying client is useful on its own, and is the thing you should reach
for if you want answers rather than prose:

```js
import { TypeSafe } from 'let-jev-speak/client';

const ts = new TypeSafe();
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

Adding one is a `vocabs.js` entry: a contrastive description (the router picks
on meaning) and a list of words ordered most- to least-important, since
assembling a vocabulary truncates from the tail.

## Limits

- **Coherence holds for about 5–8 words**, then decays. Each step conditions on
  a prefix the decoder itself produced, so once it drifts nothing pulls it back.
- **The API caps a `choice` question at 255 options.** After punctuation and
  `CORE` that leaves 145 slots per domain — and a word absent from the pack can
  never be emitted.
- **Cost is ~11–14 API calls per answer.**

## Tests

```bash
npm run eval            # routing accuracy, routing benefit, vocabulary coverage
npm run eval:coverage   # local, no API calls
npm test                # API client smoke test
```

## License

MIT
