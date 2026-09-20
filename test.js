#!/usr/bin/env node
/**
 * Quick smoke test for the TypeSafe client.
 *
 *   TYPESAFE_API_KEY=sk-... node test.js
 *   TYPESAFE_API_KEY=sk-... node test.js "your own text to analyze"
 *   node test.js --dry            # no network: prints the request body only
 */

import { TypeSafe, TypeSafeError } from './typesafe.js';

const DRY = process.argv.includes('--dry');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const STATE =
  args[0] ??
  "Hi, I've been trying to connect my Stripe account for 3 days and it keeps failing. I'm losing sales. Please help ASAP.";

const QUESTIONS = {
  department: {
    type: 'choice',
    instructions: 'Which team should handle this',
    criteria: {
      billing: 'Payment or subscription issues',
      technical: 'Bugs or integration problems',
      sales: 'Pricing or account questions',
    },
  },
  frustration: {
    type: 'score',
    instructions: 'How frustrated the customer appears',
    criteria: ['Calm, just stating facts', 'Frustrated but civil', 'Very angry, strong language'],
  },
  is_urgent: {
    type: 'noul',
    instructions: 'The message conveys urgency or time-sensitivity',
  },
};

if (DRY) {
  console.log(JSON.stringify({ state: STATE, model: 'jev-latest', questions: QUESTIONS }, null, 2));
  process.exit(0);
}

if (!process.env.TYPESAFE_API_KEY) {
  console.error('Set TYPESAFE_API_KEY first (or run with --dry). Keys: https://console.typesafe.ai/keys');
  process.exit(1);
}

const client = new TypeSafe(process.env.TYPESAFE_API_KEY);

const show = (label, fn) =>
  fn()
    .then((v) => {
      console.log(`\n── ${label} ──`);
      console.dir(v, { depth: null });
      return v;
    })
    .catch((err) => {
      console.error(`\n── ${label} FAILED ──`);
      console.error(err instanceof TypeSafeError ? `${err.message}` : err);
      if (err?.body) console.error(err.body);
      process.exitCode = 1;
    });

console.log(`state: ${JSON.stringify(STATE)}`);

// 1. Full multi-question call.
await show('systemOne (all three question types)', () => client.systemOne(STATE, QUESTIONS));

// 2. Single-question helpers.
await show('choice()', () =>
  client.choice(STATE, 'Which team should handle this', QUESTIONS.department.criteria));

await show('score()', () =>
  client.score(STATE, 'How frustrated the customer appears', QUESTIONS.frustration.criteria));

await show('noul()', () => client.noul(STATE, 'The message conveys urgency or time-sensitivity'));

await show('is() → boolean', () => client.is(STATE, 'The customer is at risk of churning'));

// 3. Batch over several texts.
await show('batch()', () =>
  client
    .batch(
      [
        'Thanks so much, this worked perfectly!',
        'Third time asking. Still broken. Refund me.',
        'What does the Pro plan include?',
      ],
      { department: QUESTIONS.department },
      { concurrency: 3 },
    )
    .then((rows) =>
      rows.map((r) => (r.ok ? r.value.answers.department.choice : `ERROR: ${r.error.message}`)),
    ));

// 4. Error path — a bad key must raise a TypeSafeError with a status.
const bad = new TypeSafe('sk-definitely-invalid', { maxRetries: 0 });
try {
  await bad.noul(STATE, 'anything');
  console.error('\n── auth error test FAILED: bad key was accepted ──');
  process.exitCode = 1;
} catch (err) {
  console.log(`\n── auth error test ── got ${err.name} status=${err.status}: ${err.message}`);
}
