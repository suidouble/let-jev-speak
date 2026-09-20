# Findings

Why `let-jev-speak` is built the way it is. Preserved from the experiment
scripts that produced these results, all measured against the live API.

## The core result

TypeSafe's `/v1/systemone` endpoint scores each option's **description** against
the input by meaning. That single fact explains everything below.

- Options that differ **semantically** discriminate well.
- Options that differ **only by a character** do not.

## Character-level decoding fails, and cannot be fixed

The first attempt treated each character of an answer as a `choice` over an
82-symbol alphabet, feeding the output back as a prefix.

It collapsed. With 82 options the returned probabilities sit near-uniform (top
option ~0.19), so argmax just tracks a fixed per-option prior — the decode
emitted runs of `" "` or `"a"` regardless of the prefix. Reversing the option
order barely moved the ranking, so this is a per-option prior, not positional
bias.

Calibration (dividing by a baseline measured on content-free prefixes) recovered
some real signal — `"Yes, becaus"` ranked `"e"` first by a wide margin — but
top-1 accuracy on obvious continuations was only ~1/5, and the usual failure was
picking a character **already present in the prefix**.

That last detail is the real result: the endpoint does bag-of-characters
similarity, with no autoregressive machinery to borrow. Character decoding needs
a next-token distribution and there isn't one here to extract. No prompt shape
fixes it.

Cost, for scale: ~160 calls and ~420k input tokens to produce a string of one
repeated letter.

## Word-level decoding works

`"sandwich"` and `"because"` genuinely differ in meaning, so context signal
survives. Given a constraining prefix the raw distribution is sharp and correct:

```
"a hot dog is not a"  ->  sandwich = 0.94
```

Three mechanisms were needed to turn that into a decoder. Each was added to fix
an observed failure, not on principle:

1. **Prior calibration** (`alpha`, default 0.45). Every option carries a fixed
   prior — `is`, `depends`, `yes` score high before any context. Across ~250
   options those priors drown the context signal and the decode emits
   `is is is`. Dividing by `prior^alpha` fixes it, but `alpha=1` over-corrects:
   function words have the *highest* priors, so removing them fully yields
   content-word salad (`a because the the bread bun hinged`). ~0.45 keeps both.

2. **Repetition penalty** (`penalty`, default 1.5). At 0.6, two-word cycles
   survive (`definition of definition of`). 1.5 breaks them.

3. **Minimum length** (`min`, default 5). `end` has a strong prior of its own
   and otherwise fires after three or four words, truncating mid-thought.

## Vocabulary is the binding constraint

The API caps a `choice` question at **255 options**. Minus 7 punctuation marks
and `end`, that leaves 247 word slots; `CORE` takes 102, leaving 145 for a
domain.

A word absent from the vocabulary **cannot be emitted at all**. This is the
single biggest lever on answer quality, and the reason for domain routing:

| Vocabulary | "Why is the sky blue?" | Judge (0–2) |
|---|---|---|
| routed (`science`) | `because light scattered by molecules shorter blue more than longer` | **1.63** |
| general | `because the makes it the is that reason end` | 0.11 |
| wrong (`shopping`) | `because the it is.` | 0.62 |

Across six questions: **routed 1.18, general 0.64, wrong 0.69**. Routing itself
scored **60/60** at 0.97 mean confidence over 28 domains, including deliberately
confusable IT pairs (`ai` / `database` / `devops` / `security` / `networking` /
`webdev`).

Caveat: the benefit is not uniform. On a short factual medical question, routed
(1.16) scored *below* general (1.28). Routing helps most where the answer needs
technical nouns.

## Limits

- **Coherence holds for roughly 5–8 words**, then decays — each step conditions
  on a prefix the decoder itself produced, so once it drifts nothing pulls it
  back. Routing improves word choice, not sentence length or grammar.
- Cost is ~11–14 calls per answer (1 route + 3 prior, cached per vocabulary +
  ~10 decode).
- Specific terms still get squeezed out at 145 slots per domain: `flexbox` and
  `center` are absent from `webdev`, so that question still degrades.

## Verdict

A working demonstration, not a production route to text. **A single well-posed
`choice` question answers the same question better, in one call, with a
calibrated confidence attached.** The library is worth having for the cases
where you genuinely want prose out of a classifier — and as a precise map of
what this endpoint can and cannot do.

## Aside: the model's self-knowledge

Probing the model about itself found a consistent split — it describes its
*category* accurately and confabulates anything specific to itself.

- Claimed cross-request memory. Tested: a planted code word scored 0.14, *below*
  a word never mentioned (0.16). The API is stateless.
- Could not name itself (`I is called the model`), though responses carry
  `jev-1.13.0`.
- Architecture claims held up — `transformer 0.87` vs `RNN 0.14`, `CNN 0.11`,
  `decision tree 0.05`, and a forced choice returned transformer at 1.00. Not
  mere acquiescence.
- Parameter count was pure guesswork — every bucket near-uniform and low.

On measured competence it is a strong generalist: 31/32 on basic and 27/28 on
expert-level ground-truth classification across medicine, law, finance, code,
science and logic, and 3/3 sarcasm detection in each of seven languages. No
weak field was found — though that means the probe hit a ceiling, which is
evidence of breadth, not proof of uniform depth.
