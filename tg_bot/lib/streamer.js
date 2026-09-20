/**
 * Live-draft streaming.
 *
 * `sendMessageDraft` shows a partial message while it is being generated. The
 * draft is ephemeral — it lives about 30 seconds and disappears when a real
 * message arrives — so the answer is persisted with a final `sendMessage`.
 *
 * Rate limits (core.telegram.org/api/bots/ai): 20 calls in 5 seconds and 40 in
 * 30 seconds per recipient. We emit a word roughly every 620ms, so per-word
 * streaming sits well inside both; MIN_INTERVAL_MS is flood insurance, not the
 * primary pacing. There are no timers in this runtime, so throttling is done
 * by comparing Date.now() at each word rather than by scheduling.
 */

import { api } from 'sdk';

const MIN_INTERVAL_MS = 300;

export class DraftStream {
  #chatId;
  #randomId;
  #last = 0;
  #lastText = '';
  #floodUntil = 0;

  constructor(chatId, randomId = Date.now()) {
    this.#chatId = chatId;
    this.#randomId = randomId;
    this.frames = 0;
    this.skipped = 0;
  }

  /**
   * Show `text` as the current draft. Throttled, and safe to call per word.
   * Never throws: a lost frame is cosmetic, and the final message is what the
   * user keeps.
   */
  async show(text, { force = false } = {}) {
    const now = Date.now();
    if (!text || text === this.#lastText) return;
    if (!force && now < this.#floodUntil) { this.skipped++; return; }
    if (!force && now - this.#last < MIN_INTERVAL_MS) { this.skipped++; return; }

    this.#last = now;
    this.#lastText = text;

    try {
      await api.sendMessageDraft({
        chat_id: this.#chatId,
        random_id: this.#randomId,
        text,
      });
      this.frames++;
    } catch (err) {
      if (err?.code === 429) {
        const wait = (err.parameters?.retry_after ?? 1) * 1000;
        this.#floodUntil = Date.now() + wait;
        this.skipped++;
        return;
      }
      // Drafts are decoration. Losing one must never abort a decode.
      console.warn(`draft failed: ${err?.description ?? err}`);
    }
  }

  /** Persist the finished answer. The draft disappears once this lands. */
  async finish(text, extra = {}) {
    return api.sendMessage({ chat_id: this.#chatId, text, ...extra });
  }
}
