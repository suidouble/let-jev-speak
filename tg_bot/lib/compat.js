/**
 * Runtime shims. The V8 isolate has no `AbortSignal`, `setTimeout` or
 * `process` — probed, not assumed:
 *
 *   AbortSignal: undefined   setTimeout: undefined   process: undefined
 *   Response:    undefined   URL:        undefined
 *
 * lib/typesafe is vendored verbatim from the root library, so rather than
 * patch it we give it the two globals it reaches for. Import this module
 * before anything that makes a request.
 */

/* eslint-disable no-undef */

// TypeSafe#request does `signal: signal ?? AbortSignal.timeout(this.timeout)`
// on every call. There is no timer to cancel with, and the platform enforces
// its own request deadline, so this is an inert signal of the right shape.
if (typeof globalThis.AbortSignal === 'undefined') {
  class InertAbortSignal {
    aborted = false;
    reason = undefined;
    onabort = null;
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return false; }
    throwIfAborted() {}
    static timeout() { return new InertAbortSignal(); }
    static abort(reason) {
      const s = new InertAbortSignal();
      s.aborted = true;
      s.reason = reason;
      return s;
    }
  }
  globalThis.AbortSignal = InertAbortSignal;
}

// Only reached on a retry, where it provides backoff. Without timers there is
// nothing to wait on, so retries happen immediately — acceptable for the two
// or three attempts the client makes, and far better than a ReferenceError.
if (typeof globalThis.setTimeout === 'undefined') {
  globalThis.setTimeout = (fn) => { Promise.resolve().then(() => fn()); return 0; };
  globalThis.clearTimeout = () => {};
}

// LetJevSpeak reads process.env only when no key is passed (the `??=`
// short-circuits otherwise) and calls process.emitWarning only for an
// oversized vocabulary pack. Both are covered rather than relied upon.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = {
    env: {},
    emitWarning: (msg, name) => console.warn(`${name ?? 'Warning'}: ${msg}`),
  };
}

export const SHIMMED = true;
