import { table, integer, text } from 'sdk/db';

/**
 * The platform provides no environment variables or secret store, so the
 * TypeSafe API key lives here. It is seeded out-of-band with
 * `tgcloud run message` (see README) so the key never passes through a chat
 * message or the repository.
 */
export const config = table('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * Per-user throttling. An answer costs ~9 TypeSafe calls, so an open bot is an
 * open invoice: this caps it. A fixed window is enough here — precision is not
 * worth a second table.
 */
export const usage = table('usage', {
  userId: integer('user_id').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull().default(0),
  totalAnswers: integer('total_answers').notNull().default(0),
});
