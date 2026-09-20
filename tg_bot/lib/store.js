/**
 * Config and rate-limit storage.
 */

import { db } from 'sdk';
import { eq, sql } from 'sdk/db';
import { config, usage } from 'schema';

export async function getConfig(key) {
  const row = await db.select().from(config).where(eq(config.key, key)).get();
  return row?.value ?? null;
}

export async function setConfig(key, value) {
  await db.insert(config).values({ key, value })
    .onConflictDoUpdate({ target: config.key, set: { value } })
    .run();
}

export const WINDOW_MS = 60 * 60 * 1000;   // one hour
export const WINDOW_LIMIT = 20;            // answers per user per window

/**
 * Count one answer against the caller's quota.
 *
 * @returns {{allowed: boolean, remaining: number, resetInMin: number}}
 */
export async function takeQuota(userId, { limit = WINDOW_LIMIT } = {}) {
  const now = Date.now();
  const row = await db.select().from(usage).where(eq(usage.userId, userId)).get();

  if (!row || now - row.windowStart >= WINDOW_MS) {
    await db.insert(usage)
      .values({ userId, windowStart: now, count: 1, totalAnswers: 1 })
      .onConflictDoUpdate({
        target: usage.userId,
        set: { windowStart: now, count: 1, totalAnswers: sql`${usage.totalAnswers} + 1` },
      })
      .run();
    return { allowed: true, remaining: limit - 1, resetInMin: WINDOW_MS / 60000 };
  }

  if (row.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetInMin: Math.max(1, Math.ceil((WINDOW_MS - (now - row.windowStart)) / 60000)),
    };
  }

  await db.update(usage)
    .set({ count: row.count + 1, totalAnswers: row.totalAnswers + 1 })
    .where(eq(usage.userId, userId))
    .run();

  return {
    allowed: true,
    remaining: limit - row.count - 1,
    resetInMin: Math.ceil((WINDOW_MS - (now - row.windowStart)) / 60000),
  };
}
