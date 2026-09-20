/**
 * Word-level decoder over TypeSafe's `choice` endpoint.
 *
 * Used by LetJevSpeak, which supplies a vocabulary per question. See
 * FINDINGS.md for why this works at word level and not at character level.
 */

export const PUNCT = ['.', ',', '?', '!', ';', ':', '—'];

// The API caps a choice question at 255 options. That is the binding limit on
// vocabulary size — not the model's ability to tell words apart.
export const MAX_CHOICES = 255;

export function buildCriteria(vocab) {
  const criteria = Object.fromEntries([
    ...vocab.map((w) => [`w:${w}`, `The next word is "${w}"`]),
    ...PUNCT.map((p) => [`p:${p}`, `The next thing is the punctuation mark "${p}"`]),
    ['end', 'The sentence is finished and grammatically complete'],
  ]);
  const n = Object.keys(criteria).length;
  if (n > MAX_CHOICES) {
    throw new Error(
      `Vocabulary too large: ${n} options exceeds the API's ${MAX_CHOICES}-choice ` +
      `limit. Remove ${n - MAX_CHOICES} word(s).`,
    );
  }
  return criteria;
}

export const tokenText = (key) => (key === 'end' ? null : key.slice(2));
export const isPunct = (key) => key.startsWith('p:');

export function render(tokens) {
  let out = '';
  for (const t of tokens) {
    if (PUNCT.includes(t)) out += t;
    else out += (out ? ' ' : '') + t;
  }
  return out;
}

export function createRequest(question, tokens, criteria, preamble = '') {
  const answerSoFar = render(tokens);
  return {
    state: { question, answer_so_far: answerSoFar },
    model: 'jev-latest',
    questions: {
      next_word: {
        type: 'choice',
        instructions:
          (preamble ? `${preamble}\n\n` : '') +
          `Question: ${question}\n\n` +
          `The answer so far reads: "${answerSoFar}"\n\n` +
          `Continue this answer. What is the single next word? ` +
          `Do not repeat or restart the answer so far. ` +
          `Select "end" only when the answer is already complete and grammatical.`,
        criteria,
      },
    },
  };
}

/**
 * Every option carries a fixed prior — some words score high before any context
 * is considered. Across a large vocabulary those priors drown the context
 * signal and the decode locks onto one word, so we measure the prior on
 * content-free prefixes and divide it back out.
 */
export async function measurePrior(client, question, criteria, preamble) {
  const probes = await Promise.all(
    ['', ' ', 'xqz zzz'].map((p) => {
      const r = createRequest(question, [p].filter(Boolean), criteria, preamble);
      return client.systemOne(r.state, r.questions, { model: r.model });
    }),
  );
  const prior = {};
  for (const res of probes) {
    for (const [k, v] of Object.entries(res.answers.next_word.probabilities ?? {})) {
      prior[k] = (prior[k] ?? 0) + v / probes.length;
    }
  }
  return prior;
}

/**
 * Decode one answer, word by word. Returns { text, tokens, steps, usage }.
 *
 * Tuning (defaults from the sweep documented in FINDINGS.md):
 *   alpha   0.45  how much of the per-option prior to divide out
 *   penalty 1.5   damping on words already used, to break loops
 *   min     5     suppress "end" until the answer has this many words
 */
export async function decode(client, {
  question,
  criteria,
  prior,
  preamble = '',
  max = 10,
  min = 5,
  alpha = 0.45,
  penalty = 1.5,
  onWord,
} = {}) {
  const tokens = [];
  const counts = new Map();
  let steps = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let stop = 'length';

  while (tokens.length < max) {
    const req = createRequest(question, tokens, criteria, preamble);
    const res = await client.systemOne(req.state, req.questions, { model: req.model });

    steps++;
    inputTokens += res.usage?.input_tokens ?? 0;
    outputTokens += res.usage?.output_tokens ?? 0;

    const a = res.answers.next_word;
    const ranked = Object.entries(a.probabilities ?? {})
      .map(([k, v]) => [
        k,
        (v / Math.max(prior[k] ?? 0, 0.01) ** alpha) / (1 + penalty * (counts.get(k) ?? 0)),
      ])
      .sort((x, y) => y[1] - x[1]);

    const prev = tokens[tokens.length - 1];
    const eligible = ranked.filter(([k]) => {
      if (k === 'end') return tokens.length >= min;
      const w = tokenText(k);
      if (w === prev) return false;                          // no "between between"
      if (isPunct(k) && PUNCT.includes(prev)) return false;  // no ".."
      if (isPunct(k) && tokens.length === 0) return false;   // no leading punctuation
      return true;
    });

    const key = eligible.length ? eligible[0][0] : a.choice;
    if (key === 'end') { stop = 'end'; break; }

    const word = tokenText(key);
    if (word == null) { stop = 'bad-option'; break; }

    counts.set(key, (counts.get(key) ?? 0) + 1);
    tokens.push(word);
    onWord?.(word, isPunct(key));
  }

  return { text: render(tokens), tokens, steps, stop, inputTokens, outputTokens };
}
