/**
 * Minimal Node.js client for the TypeSafe API.
 * Docs: https://docs.typesafe.ai/introduction/quickstart
 *
 * Requires Node 18+ (global fetch / AbortSignal.timeout).
 */

export class TypeSafeError extends Error {
  constructor(message, { status, body, cause } = {}) {
    super(message);
    this.name = 'TypeSafeError';
    this.status = status;
    this.body = body;
    if (cause) this.cause = cause;
  }
}

export class TypeSafe {
  /**
   * @param {string|object} apiKey           API key, or an options object with { apiKey, ... }
   * @param {object}        [options]
   * @param {string}        [options.baseUrl='https://api.typesafe.ai']
   * @param {string}        [options.model='jev-latest']
   * @param {number}        [options.timeout=60000]  per-request timeout in ms
   * @param {number}        [options.maxRetries=2]   retries on 429/5xx/network errors
   * @param {typeof fetch}  [options.fetch]          custom fetch implementation
   */
  constructor(apiKey, options = {}) {
    if (apiKey && typeof apiKey === 'object') {
      options = apiKey;
      apiKey = options.apiKey;
    }
    apiKey = apiKey ?? process.env.TYPESAFE_API_KEY;
    if (!apiKey) {
      throw new TypeSafeError('Missing API key. Pass it to the constructor or set TYPESAFE_API_KEY.');
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.typesafe.ai').replace(/\/+$/, '');
    this.model = options.model ?? 'jev-latest';
    this.timeout = options.timeout ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;

    // Bound to globalThis: stored on the instance, `this.fetch(...)` would
    // otherwise call native fetch with the client as its receiver, which
    // browsers reject with "Illegal invocation". Node does not care.
    const impl = options.fetch ?? globalThis.fetch;
    this.fetch = typeof impl === 'function' ? impl.bind(globalThis) : impl;
  }

  // ---------------------------------------------------------------- core

  /**
   * POST /v1/systemone — run a set of questions against a piece of text.
   *
   * @param {string} state                 the text to analyze
   * @param {object} questions             map of key -> { type, instructions, criteria? }
   * @param {object} [opts]
   * @param {string} [opts.model]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<{model: string, answers: object, usage: {input_tokens: number, output_tokens: number}}>}
   */
  async systemOne(state, questions, opts = {}) {
    // The API accepts either a plain string or a structured object as `state`.
    if (state === null || state === undefined || (typeof state === 'string' && !state.length)) {
      throw new TypeSafeError('`state` must be a non-empty string or an object.');
    }
    if (!questions || typeof questions !== 'object' || !Object.keys(questions).length) {
      throw new TypeSafeError('`questions` must be a non-empty object.');
    }

    return this.#request('/v1/systemone', {
      state,
      model: opts.model ?? this.model,
      questions,
    }, opts.signal);
  }

  /** Alias reading closer to the docs' framing. */
  analyze(state, questions, opts) {
    return this.systemOne(state, questions, opts);
  }

  // ------------------------------------------------------------- helpers
  // Single-question conveniences that unwrap the answer for you.

  /**
   * Pick one option from a labelled set.
   * @param {string} state
   * @param {string} instructions
   * @param {Record<string,string>} criteria  option -> description
   * @returns {Promise<{choice: string, probabilities: Record<string,number>, confidence: number, usage: object}>}
   */
  async choice(state, instructions, criteria, opts = {}) {
    const res = await this.systemOne(state, {
      result: { type: 'choice', instructions, criteria },
    }, opts);
    return { ...res.answers.result, usage: res.usage };
  }

  /**
   * Place the text on an ordered scale. `criteria` is an ordered array of level
   * descriptions; the returned `score` is a float across those levels (0..n-1).
   * @returns {Promise<{score: number, legend: Record<string,string>, confidence: number, usage: object}>}
   */
  async score(state, instructions, criteria, opts = {}) {
    if (!Array.isArray(criteria) || criteria.length < 2) {
      throw new TypeSafeError('`criteria` for a score question must be an ordered array of 2+ levels.');
    }
    const res = await this.systemOne(state, {
      result: { type: 'score', instructions, criteria },
    }, opts);
    return { ...res.answers.result, usage: res.usage };
  }

  /**
   * Truth of a statement about the text, as a 0..1 value.
   * @returns {Promise<{noul: number, usage: object}>}
   */
  async noul(state, instructions, opts = {}) {
    const res = await this.systemOne(state, {
      result: { type: 'noul', instructions },
    }, opts);
    return { ...res.answers.result, usage: res.usage };
  }

  /** `noul` collapsed to a boolean. */
  async is(state, instructions, { threshold = 0.5, ...opts } = {}) {
    const { noul } = await this.noul(state, instructions, opts);
    return noul >= threshold;
  }

  /** Run the same question set over many texts, `concurrency` at a time. */
  async batch(states, questions, { concurrency = 4, ...opts } = {}) {
    const out = new Array(states.length);
    let next = 0;
    const worker = async () => {
      while (next < states.length) {
        const i = next++;
        try {
          out[i] = { ok: true, value: await this.systemOne(states[i], questions, opts) };
        } catch (err) {
          out[i] = { ok: false, error: err };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, states.length) }, worker));
    return out;
  }

  // ------------------------------------------------------------ internals

  async #request(path, body, signal) {
    const url = `${this.baseUrl}${path}`;
    let lastErr;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt) await sleep(2 ** (attempt - 1) * 500 + Math.random() * 250);

      let res;
      try {
        res = await this.fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
          signal: signal ?? AbortSignal.timeout(this.timeout),
        });
      } catch (err) {
        if (signal?.aborted) throw err;
        lastErr = new TypeSafeError(`Request to ${path} failed: ${err.message}`, { cause: err });
        continue; // network / timeout — retry
      }

      const text = await res.text();
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }

      if (res.ok) return parsed;

      lastErr = new TypeSafeError(`TypeSafe API ${res.status}: ${errorDetail(parsed) || res.statusText}`, {
        status: res.status,
        body: parsed,
      });

      // Retry only on rate limits and server errors.
      if (res.status !== 429 && res.status < 500) throw lastErr;
    }

    throw lastErr;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Pull a readable message out of an error body. The API returns FastAPI-style
 * shapes: `{detail: {error_type, message}}` for auth/runtime errors and
 * `{detail: [{loc, msg, ...}]}` for request validation errors.
 */
function errorDetail(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 300);

  const d = body.detail ?? body.error ?? body;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    return d
      .map((e) => (e?.loc ? `${e.loc.join('.')}: ${e.msg ?? e.type}` : e?.msg ?? JSON.stringify(e)))
      .join('; ')
      .slice(0, 300);
  }
  if (typeof d === 'object') return d.message ?? d.msg ?? JSON.stringify(d).slice(0, 300);
  return String(d);
}

export default TypeSafe;
