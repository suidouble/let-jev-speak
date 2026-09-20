/**
 * The browser-side speaker.
 *
 * Requests go to /api, which the Vite dev server proxies to api.typesafe.ai
 * with the Authorization header attached in Node. Two reasons it works this
 * way rather than calling the API directly:
 *
 *   1. api.typesafe.ai returns no Access-Control-Allow-Origin, so a browser
 *      blocks a direct call before the response can be read.
 *   2. A key in the bundle is a key anyone can read. This keeps it in Node.
 *
 * The placeholder key below is never used for auth — the proxy overwrites the
 * header — but the client requires a non-empty string.
 */

import { LetJevSpeak } from '../LetJevSpeak.js';

export const MAX_WORDS = Number(import.meta.env.VITE_JEV_MAX_WORDS ?? 8);
export const API_BASE = import.meta.env.VITE_JEV_API_BASE ?? '/api';

export function createJev() {
  return new LetJevSpeak('proxied-by-vite', {
    baseUrl: API_BASE,
    max: MAX_WORDS,
    min: 4,
  });
}

/**
 * Ask a question, reporting the answer as it decodes.
 *
 * @param {LetJevSpeak} jev
 * @param {string} question
 * @param {(soFar: string) => void} onProgress  called with the full text so far
 */
export async function ask(jev, question, onProgress) {
  const words = [];
  const result = await jev.answer(question, {
    onWord: (word, isPunct) => {
      words.push(word);
      // Punctuation attaches to the previous word rather than being spaced.
      const text = words.reduce(
        (acc, w) => (/^[.,!?;:—]$/.test(w) ? acc + w : acc ? `${acc} ${w}` : w),
        '',
      );
      onProgress?.(text);
    },
  });

  return {
    text: result.text,
    domain: result.domain,
    calls: result.calls ?? result.steps + 1,
    routing: result.routing,
  };
}
