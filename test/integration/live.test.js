/**
 * Live API tests. Skipped unless TYPESAFE_API_KEY is set, so `npm test` stays
 * offline and deterministic by default.
 *
 *   TYPESAFE_API_KEY=... npm run test:integration
 *
 * These assert on shape and on judgements the model should get right with high
 * confidence — never on exact wording, which is not stable.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TypeSafe, TypeSafeError } from '../../typesafe.js';
import { LetJevSpeak } from '../../LetJevSpeak.js';

const KEY = process.env.TYPESAFE_API_KEY;
const skip = KEY ? false : 'TYPESAFE_API_KEY is not set';

describe('live API', { skip }, () => {
  const client = () => new TypeSafe(KEY, { maxRetries: 3 });

  test('choice returns a calibrated distribution', async () => {
    const r = await client().choice(
      'My card was charged twice for a single order.',
      'Which team should handle this?',
      {
        billing: 'A payment or billing problem',
        technical: 'A software defect',
        sales: 'A pricing question',
      },
    );
    assert.equal(r.choice, 'billing');
    const total = Object.values(r.probabilities).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 0.05, `probabilities sum to ${total}`);
    assert.ok(r.usage.input_tokens > 0);
  });

  test('score places text on the scale and echoes the legend', async () => {
    const r = await client().score(
      'This is absolutely unacceptable. Third time this week.',
      'How frustrated is the customer?',
      ['Calm', 'Frustrated but civil', 'Very angry'],
    );
    assert.ok(r.score >= 1, `expected clear frustration, got ${r.score}`);
    assert.equal(Object.keys(r.legend).length, 3);
  });

  test('noul answers a statement, and its negation inversely', async () => {
    const ts = client();
    const text = 'Please help, my site has been down for an hour and we are losing sales.';
    const [urgent, notUrgent] = await Promise.all([
      ts.noul(text, 'The message conveys urgency'),
      ts.noul(text, 'The message is relaxed and not time-sensitive'),
    ]);
    assert.ok(urgent.noul > 0.6, `urgency scored ${urgent.noul}`);
    assert.ok(notUrgent.noul < urgent.noul, 'the negation must score lower');
  });

  test('batch preserves order across concurrent calls', async () => {
    const out = await client().batch(
      ['This is wonderful, thank you!', 'Broken on arrival, never again.'],
      { s: { type: 'choice', instructions: 'Sentiment?', criteria: { pos: 'Positive', neg: 'Negative' } } },
      { concurrency: 2 },
    );
    assert.ok(out.every((r) => r.ok));
    assert.equal(out[0].value.answers.s.choice, 'pos');
    assert.equal(out[1].value.answers.s.choice, 'neg');
  });

  test('an invalid key raises a 401 TypeSafeError', async () => {
    const bad = new TypeSafe('definitely-not-a-valid-key', { maxRetries: 0 });
    await assert.rejects(() => bad.noul('x', 'y'), (err) => {
      assert.ok(err instanceof TypeSafeError);
      assert.equal(err.status, 401);
      return true;
    });
  });

  test('a malformed question raises a readable 422', async () => {
    await assert.rejects(
      () => client().systemOne('x', { q: { type: 'choice', instructions: 'missing criteria' } }),
      (err) => {
        assert.equal(err.status, 422);
        assert.match(err.message, /criteria/);
        return true;
      },
    );
  });
});

describe('live routing and decoding', { skip }, () => {
  test('routes questions to the expected packs', async () => {
    const jev = new LetJevSpeak(KEY);
    const cases = [
      ['Why do cats purr?', 'nature'],
      ['Should I add an index to this column?', 'database'],
      ['How do I store user passwords safely?', 'security'],
      ['Why do bond prices fall when interest rates rise?', 'finance'],
    ];
    const results = await Promise.all(cases.map(([q]) => jev.route(q)));
    results.forEach((r, i) => {
      assert.equal(r.choice, cases[i][1], `"${cases[i][0]}" routed to ${r.choice}`);
    });
  });

  test('answers a question end to end', async () => {
    const jev = new LetJevSpeak(KEY, { max: 8 });
    const r = await jev.answer('Why is the sky blue?');

    assert.equal(r.domain, 'science');
    assert.ok(r.tokens.length > 0 && r.tokens.length <= 8);
    assert.ok(r.text.length > 0);
    assert.equal(r.stats ?? jev.stats.answers, 1);
    assert.ok(jev.stats.calls >= r.steps + 4, 'route + prior + decode all counted');
  });

  test('the prior cache spares the second answer three calls', async () => {
    const jev = new LetJevSpeak(KEY, { max: 3 });
    await jev.answer('Why do cats purr?', { domain: 'nature' });
    const afterFirst = jev.stats.priorCalls;
    await jev.answer('How do trees survive winter?', { domain: 'nature' });
    assert.equal(jev.stats.priorCalls, afterFirst, 'prior was re-measured');
  });
});
