/**
 * Answering a question, word by word.
 *
 * Routing and vocabulary assembly come from LetJevSpeak; the decode is driven
 * here rather than through `jev.answer()` so the precomputed prior from
 * lib/priors can be supplied directly. That skips the three calls
 * `measurePrior` would otherwise make — ~1.9s per answer at this runtime's
 * ~620ms per call.
 */

import 'lib/compat';

import { fetch as sdkFetch } from 'sdk';
import { TypeSafe } from 'lib/typesafe';
import { LetJevSpeak } from 'lib/letjevspeak';
import { buildCriteria, decode, render } from 'lib/decoder';
import { PRIORS } from 'lib/priors';

export const MAX_WORDS = 8;
export const MIN_WORDS = 4;

/**
 * @param {string} apiKey  the TypeSafe key, read from the config table
 */
export function createSpeaker(apiKey) {
  // The client takes an injected fetch, which is why the platform's fetch can
  // stand in for the global one that does not exist here.
  const client = new TypeSafe(apiKey, { fetch: sdkFetch, maxRetries: 1 });

  // blend:false keeps every answer on a single pack, which is what the
  // precomputed priors cover — a blended pair would need its own prior.
  return new LetJevSpeak(client, { blend: false, max: MAX_WORDS, min: MIN_WORDS });
}

/**
 * Decode an answer, reporting the text so far through `onWord`.
 *
 * @returns {{text, tokens, domain, routing, stop, calls}}
 */
export async function answerQuestion(jev, question, { onWord, max = MAX_WORDS } = {}) {
  const routing = await jev.route(question);
  const build = jev.buildVocab(routing);
  const domain = build.domains[0];

  const criteria = buildCriteria(build.words);
  const prior = PRIORS[domain] ?? {};

  const tokens = [];
  const r = await decode(jev.client, {
    question,
    criteria,
    prior,
    max,
    min: MIN_WORDS,
    alpha: jev.alpha,
    penalty: jev.penalty,
    onWord: async (word, isPunct) => {
      tokens.push(word);
      if (onWord) await onWord(render(tokens), word, isPunct);
    },
  });

  return {
    text: r.text,
    tokens: r.tokens,
    domain,
    routing,
    stop: r.stop,
    calls: 1 + r.steps,
  };
}
