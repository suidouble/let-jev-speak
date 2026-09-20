/**
 * LetJevSpeak — free-text answers from TypeSafe's classification API, with the
 * model choosing its own vocabulary.
 *
 * Two `choice` mechanisms stacked:
 *   1. Routing — one call picks the domain that fits the question, from 28
 *      packs described in plain language.
 *   2. Decoding — one call per word over CORE + that domain's words.
 *
 * Both work for the same reason: the endpoint scores option descriptions by
 * meaning, so options that differ semantically (domains, words) discriminate
 * well, while options that differ only by a character do not. See FINDINGS.md.
 */

import { TypeSafe } from './typesafe.js';
import { buildCriteria, measurePrior, decode, MAX_CHOICES, PUNCT } from './decoder.js';
import { CORE, DOMAINS, DOMAIN_KEYS, DOMAIN_BUDGET } from './vocabs.js';

export class LetJevSpeak {
  #client;
  #priorCache = new Map();
  #stats = { calls: 0, routeCalls: 0, priorCalls: 0, decodeCalls: 0, inputTokens: 0, outputTokens: 0, answers: 0 };

  /**
   * Four ways to supply credentials, in order of precedence:
   *
   *   new LetJevSpeak('tsk-...')                  a TYPESAFE_API_KEY string
   *   new LetJevSpeak({ apiKey: 'tsk-...' })      the same, as an option
   *   new LetJevSpeak(existingTypeSafeClient)     an already-configured client
   *   new LetJevSpeak()                           falls back to process.env
   *
   * @param {string|TypeSafe|object} [apiKeyOrClient]
   *   A TYPESAFE_API_KEY, an existing TypeSafe client, or an options object.
   *   Omit it entirely to read TYPESAFE_API_KEY from the environment.
   * @param {object}  [options]
   * @param {string}  [options.apiKey]       TYPESAFE_API_KEY, if not passed positionally
   * @param {number}  [options.maxRetries=3] retries on 429/5xx/network errors
   * @param {number}  [options.max=10]       maximum words per answer
   * @param {number}  [options.min=5]        suppress "end" below this length
   * @param {number}  [options.alpha=0.45]   how much per-option prior to remove
   * @param {number}  [options.penalty=1.5]  repetition damping
   * @param {boolean} [options.blend=true]   mix the top two domains when routing is close
   * @param {'vocab'|'question'} [options.priorMode='vocab']  prior cache granularity
   */
  constructor(apiKeyOrClient, options = {}) {
    let key = apiKeyOrClient;

    if (apiKeyOrClient instanceof TypeSafe) {
      this.#client = apiKeyOrClient;
      key = null;
    } else if (apiKeyOrClient && typeof apiKeyOrClient === 'object') {
      // An options object in the first position; a second argument, if any,
      // still wins for the decode settings.
      options = { ...apiKeyOrClient, ...options };
      key = options.apiKey;
    } else if (apiKeyOrClient !== undefined && typeof apiKeyOrClient !== 'string') {
      throw new TypeError(
        'LetJevSpeak: first argument must be an API key string, a TypeSafe client, ' +
        `or an options object — got ${typeof apiKeyOrClient}.`,
      );
    }

    key ??= options.apiKey ?? process.env.TYPESAFE_API_KEY;

    if (!this.#client && !key) {
      throw new Error(
        'LetJevSpeak: no TypeSafe API key. Pass one as new LetJevSpeak(apiKey), ' +
        'as new LetJevSpeak({ apiKey }), or set TYPESAFE_API_KEY in the environment. ' +
        'Keys: https://console.typesafe.ai/keys',
      );
    }

    // Builds its own client so callers need nothing else to get an answer.
    this.#client ??= new TypeSafe(key, { maxRetries: options.maxRetries ?? 3 });

    this.max = options.max ?? 10;
    this.min = options.min ?? 5;
    this.alpha = options.alpha ?? 0.45;
    this.penalty = options.penalty ?? 1.5;
    this.blend = options.blend ?? true;
    this.priorMode = options.priorMode ?? 'vocab';
  }

  // ─────────────────────────────────────────────────────────────── getters

  /** The underlying API client, for raw choice/score/noul calls. */
  get client() { return this.#client; }

  /** Every pack: key, description and word count. */
  get domains() {
    return DOMAIN_KEYS.map((k) => ({
      key: k,
      description: DOMAINS[k].description,
      size: DOMAINS[k].words.length,
    }));
  }

  /** Just the pack names. */
  get domainKeys() { return [...DOMAIN_KEYS]; }

  /** Shared function words present in every assembled vocabulary. */
  get core() { return [...CORE]; }

  /** Word slots a single domain may contribute, after CORE is accounted for. */
  get domainBudget() { return DOMAIN_BUDGET; }

  /** The API's hard ceiling on options per choice question. */
  get maxChoices() { return MAX_CHOICES; }

  /** Punctuation tokens the decoder can emit. */
  get punctuation() { return [...PUNCT]; }

  /** Current decode tuning, as a plain object. */
  get settings() {
    const { max, min, alpha, penalty, blend, priorMode } = this;
    return { max, min, alpha, penalty, blend, priorMode };
  }

  /** Cumulative API cost for this instance. */
  get stats() { return { ...this.#stats }; }

  /** How many vocabularies have a cached prior. */
  get priorCacheSize() { return this.#priorCache.size; }

  // ─────────────────────────────────────────────────────────────── methods

  /** Is this a known pack? */
  has(domain) { return Object.hasOwn(DOMAINS, domain); }

  /** The full word list that would be used for a domain, CORE included. */
  vocabularyFor(domain) {
    if (!this.has(domain)) throw new Error(`Unknown domain: ${domain}`);
    return this.#assemble([domain]);
  }

  /** Drop cached priors — call after changing alpha or the packs. */
  clearPriorCache() { this.#priorCache.clear(); }

  /** Reset the cumulative cost counters. */
  resetStats() {
    this.#stats = { calls: 0, routeCalls: 0, priorCalls: 0, decodeCalls: 0, inputTokens: 0, outputTokens: 0, answers: 0 };
  }

  /**
   * Ask the model which domain a question belongs to — one `choice` call over
   * the pack descriptions.
   *
   * @returns {Promise<{choice: string, probabilities: object, confidence: number,
   *                    top: [string, number][]}>}
   */
  async route(question) {
    const criteria = Object.fromEntries(
      DOMAIN_KEYS.map((k) => [k, DOMAINS[k].description]),
    );
    const r = await this.#client.choice(
      question,
      'Which subject area does this question belong to? Pick the single best fit.',
      criteria,
    );
    this.#stats.calls++;
    this.#stats.routeCalls++;
    this.#stats.inputTokens += r.usage?.input_tokens ?? 0;
    this.#stats.outputTokens += r.usage?.output_tokens ?? 0;

    const top = Object.entries(r.probabilities ?? {}).sort((a, b) => b[1] - a[1]);
    return { choice: r.choice, probabilities: r.probabilities, confidence: r.confidence, top };
  }

  /**
   * Turn a routing result into a word list.
   *
   * A word absent from the vocabulary cannot be emitted at all, so when two
   * domains are close we spend the budget across both rather than guessing —
   * "is a hot dog a sandwich" is food plus definitional logic, "why do cats
   * purr" is nature plus science.
   */
  buildVocab(routing) {
    const [first, second] = routing.top;
    const p1 = first?.[1] ?? 0;
    const p2 = second?.[1] ?? 0;

    // Flat distribution — no domain actually fits, so stay general.
    if (p1 < 0.25) {
      return { words: this.#assemble(['general']), domains: ['general'], mode: 'fallback' };
    }

    // Clear winner.
    if (!this.blend || p1 - p2 > 0.2) {
      return { words: this.#assemble([first[0]]), domains: [first[0]], mode: 'single' };
    }

    // Close call — split the budget, favouring the winner.
    return {
      words: this.#assemble([first[0], second[0]], [0.65, 0.35]),
      domains: [first[0], second[0]],
      mode: 'blend',
    };
  }

  /**
   * Answer a question in words.
   *
   * @param {string} question
   * @param {object} [opts]
   * @param {string} [opts.domain]    force a pack, skipping the routing call
   * @param {number} [opts.max]
   * @param {string} [opts.preamble]
   * @param {(word: string, isPunct: boolean) => void} [opts.onWord]
   */
  async answer(question, opts = {}) {
    let routing = null;
    let build;

    if (opts.domain) {
      if (!this.has(opts.domain)) throw new Error(`Unknown domain: ${opts.domain}`);
      build = { words: this.#assemble([opts.domain]), domains: [opts.domain], mode: 'forced' };
    } else {
      routing = await this.route(question);
      build = this.buildVocab(routing);
    }

    const criteria = buildCriteria(build.words);
    const vocabKey = `${build.domains.join('+')}:${build.mode}`;
    const preamble = opts.preamble ?? '';
    const prior = await this.#prior(question, criteria, vocabKey, preamble);

    const r = await decode(this.#client, {
      question,
      criteria,
      prior,
      preamble,
      max: opts.max ?? this.max,
      min: this.min,
      alpha: this.alpha,
      penalty: this.penalty,
      onWord: opts.onWord,
    });

    this.#stats.calls += r.steps;
    this.#stats.decodeCalls += r.steps;
    this.#stats.inputTokens += r.inputTokens;
    this.#stats.outputTokens += r.outputTokens;
    this.#stats.answers++;

    return {
      text: r.text,
      tokens: r.tokens,
      domain: build.domains[0],
      domains: build.domains,
      vocabMode: build.mode,
      vocabSize: build.words.length,
      optionCount: Object.keys(criteria).length,
      routing,
      steps: r.steps,
      stop: r.stop,
      usage: { input_tokens: r.inputTokens, output_tokens: r.outputTokens },
    };
  }

  // ────────────────────────────────────────────────────────────── internals

  #assemble(keys, split = [1]) {
    const out = [...CORE];
    const seen = new Set(CORE);
    keys.forEach((k, i) => {
      const slots = Math.floor(DOMAIN_BUDGET * (split[i] ?? 0));
      let taken = 0;
      for (const w of DOMAINS[k].words) {
        if (taken >= slots) break;
        if (seen.has(w)) continue;
        seen.add(w);
        out.push(w);
        taken++;
      }
    });
    return out;
  }

  /**
   * The prior is a property of the option set, not of the question, so it is
   * cached per vocabulary by default — the first question routed to a domain
   * pays 3 calls, every later one pays none. priorMode:'question' measures it
   * fresh each time, which router-eval.js uses to check the cache is safe.
   */
  async #prior(question, criteria, vocabKey, preamble) {
    if (this.priorMode === 'question') {
      this.#stats.calls += 3;
      this.#stats.priorCalls += 3;
      return measurePrior(this.#client, question, criteria, preamble);
    }
    if (!this.#priorCache.has(vocabKey)) {
      this.#stats.calls += 3;
      this.#stats.priorCalls += 3;
      this.#priorCache.set(vocabKey, await measurePrior(this.#client, question, criteria, preamble));
    }
    return this.#priorCache.get(vocabKey);
  }
}

export { DOMAIN_KEYS, DOMAINS, CORE, MAX_CHOICES, PUNCT };
export default LetJevSpeak;
