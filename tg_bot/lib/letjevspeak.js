// VENDORED — do not edit. Generated from ../../LetJevSpeak.js by
// scripts/sync-lib.mjs. Run `npm run sync` after changing the root library.
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

import { TypeSafe } from 'lib/typesafe';
import { buildCriteria, measurePrior, decode, MAX_CHOICES, PUNCT } from 'lib/decoder';
import { CORE, DOMAINS, DOMAIN_KEYS, DOMAIN_BUDGET, wordProblem } from 'lib/vocabs';

export class LetJevSpeak {
  #client;
  #domains;
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
   * @param {Record<string, {description: string, words: string[]|string}>} [options.domains]
   *   Extra vocabulary packs, merged over the built-ins for this instance only.
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

    // A per-instance copy, so adding a pack here never leaks into the shared
    // module object or into another instance.
    this.#domains = new Map(
      DOMAIN_KEYS.map((k) => [k, { description: DOMAINS[k].description, words: [...DOMAINS[k].words] }]),
    );

    for (const [key, pack] of Object.entries(options.domains ?? {})) {
      this.addDomain(key, pack, { replace: true });
    }
  }

  // ─────────────────────────────────────────────────────────────── getters

  /** The underlying API client, for raw choice/score/noul calls. */
  get client() { return this.#client; }

  /** Every pack: key, description, word count, and whether it is custom. */
  get domains() {
    return [...this.#domains.entries()].map(([key, pack]) => ({
      key,
      description: pack.description,
      size: pack.words.length,
      // How many of those words actually survive assembly.
      usable: Math.min(pack.words.length, DOMAIN_BUDGET),
      truncated: pack.words.length > DOMAIN_BUDGET,
      custom: !Object.hasOwn(DOMAINS, key) || pack.description !== DOMAINS[key].description,
    }));
  }

  /** Just the pack names. */
  get domainKeys() { return [...this.#domains.keys()]; }

  /** Only the packs added or replaced on this instance. */
  get customDomainKeys() {
    return this.domains.filter((d) => d.custom).map((d) => d.key);
  }

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
  has(domain) { return this.#domains.has(domain); }

  /** The full word list that would be used for a domain, CORE included. */
  vocabularyFor(domain) {
    if (!this.has(domain)) throw new Error(`Unknown domain: ${domain}`);
    return this.#assemble([domain]);
  }

  /**
   * Register a vocabulary pack on this instance. It takes part in routing like
   * any built-in, so the description carries real weight — the router picks on
   * meaning, and a vague description will lose to a sharper neighbour.
   *
   *   jev.addDomain('crypto', {
   *     description: 'Cryptocurrency, blockchains, wallets, tokens and trading',
   *     words: 'bitcoin wallet token chain block mining exchange ...',
   *   });
   *
   * Words may be an array or a whitespace-separated string, and should be
   * ordered most- to least-important: assembly truncates from the tail to fit
   * the per-domain budget, so trailing words are the first to be dropped.
   *
   * @param {string} key
   * @param {{description: string, words: string[]|string}} pack
   * @param {object}  [opts]
   * @param {boolean} [opts.replace=false]  overwrite an existing pack of the same name
   * @returns {this}  for chaining
   */
  addDomain(key, pack, { replace = false } = {}) {
    if (typeof key !== 'string' || !/^[\w-]+$/.test(key)) {
      throw new TypeError(
        `LetJevSpeak.addDomain: key must be a non-empty string of letters, digits, _ or - — got ${JSON.stringify(key)}.`,
      );
    }
    if (!replace && this.#domains.has(key)) {
      throw new Error(
        `LetJevSpeak.addDomain: "${key}" already exists. Pass { replace: true } to overwrite it.`,
      );
    }
    if (!pack || typeof pack !== 'object') {
      throw new TypeError('LetJevSpeak.addDomain: pack must be { description, words }.');
    }

    const { description } = pack;
    if (typeof description !== 'string' || description.trim().length < 10) {
      throw new TypeError(
        'LetJevSpeak.addDomain: description must be a sentence of at least 10 characters — ' +
        'the router chooses between packs by meaning.',
      );
    }

    const raw = typeof pack.words === 'string' ? pack.words.trim().split(/\s+/) : pack.words;
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new TypeError('LetJevSpeak.addDomain: words must be a non-empty array or string.');
    }

    // Each word ends up inside an option description and in the rendered
    // answer, so reject anything that would corrupt either. Failing here beats
    // a malformed prompt that merely degrades the results.
    const bad = raw
      .map((w) => [w, wordProblem(w, PUNCT)])
      .filter(([, problem]) => problem);
    if (bad.length) {
      const shown = bad.slice(0, 3).map(([w, p]) => `${JSON.stringify(w)} ${p}`).join('; ');
      throw new TypeError(
        `LetJevSpeak.addDomain: ${bad.length} unusable word(s) in "${key}" — ${shown}` +
        (bad.length > 3 ? `; and ${bad.length - 3} more.` : '.'),
      );
    }

    // Words already in CORE, or repeated, would burn a slot out of 255 for
    // nothing. Order is preserved, since assembly truncates from the tail.
    const seen = new Set(CORE);
    const wordsList = raw
      .map((w) => w.trim().replace(/_/g, ' '))
      .filter((w) => !seen.has(w) && seen.add(w));

    if (wordsList.length === 0) {
      throw new Error(
        `LetJevSpeak.addDomain: "${key}" adds nothing — every word is already in CORE.`,
      );
    }

    // Routing offers one option per domain, and that is a choice question too.
    if (!this.#domains.has(key) && this.#domains.size + 1 > MAX_CHOICES) {
      throw new Error(
        `LetJevSpeak.addDomain: cannot exceed ${MAX_CHOICES} domains — routing is itself a choice question.`,
      );
    }

    // Oversized packs are allowed — assembly truncates from the tail, so the
    // option ceiling is never breached. But silently dropping most of a
    // caller's vocabulary is the kind of thing that wastes an afternoon, so
    // say so once.
    if (wordsList.length > DOMAIN_BUDGET) {
      process.emitWarning(
        `LetJevSpeak: pack "${key}" has ${wordsList.length} words but only ${DOMAIN_BUDGET} ` +
        `fit alongside CORE — the last ${wordsList.length - DOMAIN_BUDGET} will never be used. ` +
        'Order words most- to least-important.',
        'LetJevSpeakVocabularyWarning',
      );
    }

    this.#domains.set(key, { description: description.trim(), words: wordsList });

    // A changed pack invalidates any prior measured against it.
    this.#priorCache.clear();
    return this;
  }

  /**
   * Drop a pack from this instance. `general` cannot be removed — buildVocab
   * falls back to it when routing finds no clear winner.
   *
   * @returns {boolean} whether a pack was actually removed
   */
  removeDomain(key) {
    if (key === 'general') {
      throw new Error('LetJevSpeak.removeDomain: "general" is the routing fallback and cannot be removed.');
    }
    const removed = this.#domains.delete(key);
    if (removed) this.#priorCache.clear();
    return removed;
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
      [...this.#domains.entries()].map(([k, pack]) => [k, pack.description]),
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
      for (const w of this.#domains.get(k).words) {
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
