import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCriteria, tokenText, isPunct, render, createRequest, measurePrior, decode,
  MAX_CHOICES, PUNCT,
} from '../decoder.js';
import { stubClient, distribution } from './helpers.js';

describe('buildCriteria', () => {
  test('emits one option per word, per punctuation mark, plus end', () => {
    const c = buildCriteria(['alpha', 'beta']);
    assert.equal(Object.keys(c).length, 2 + PUNCT.length + 1);
    assert.ok(c['w:alpha']);
    assert.ok(c['p:.']);
    assert.ok(c.end);
    assert.match(c['w:alpha'], /"alpha"/);
  });

  test('throws above the API option ceiling, naming the overage', () => {
    const tooMany = Array.from({ length: MAX_CHOICES }, (_, i) => `w${i}`);
    assert.throws(() => buildCriteria(tooMany), (err) => {
      assert.match(err.message, new RegExp(`${MAX_CHOICES}-choice`));
      assert.match(err.message, /Remove \d+ word/);
      return true;
    });
  });

  test('accepts a vocabulary exactly at the ceiling', () => {
    const exact = Array.from({ length: MAX_CHOICES - PUNCT.length - 1 }, (_, i) => `w${i}`);
    assert.equal(Object.keys(buildCriteria(exact)).length, MAX_CHOICES);
  });
});

describe('token helpers', () => {
  test('tokenText strips the type prefix', () => {
    assert.equal(tokenText('w:hello'), 'hello');
    assert.equal(tokenText('p:.'), '.');
    assert.equal(tokenText('end'), null);
  });

  test('isPunct distinguishes punctuation options', () => {
    assert.equal(isPunct('p:.'), true);
    assert.equal(isPunct('w:period'), false);
    assert.equal(isPunct('end'), false);
  });
});

describe('render', () => {
  test('space-joins words', () => {
    assert.equal(render(['a', 'b', 'c']), 'a b c');
  });

  test('attaches punctuation to the preceding word', () => {
    assert.equal(render(['yes', '.', 'because', 'it', 'is']), 'yes. because it is');
    assert.equal(render(['a', ',', 'b']), 'a, b');
  });

  test('handles the empty case', () => {
    assert.equal(render([]), '');
  });
});

describe('createRequest', () => {
  test('carries question and prefix into state and instructions', () => {
    const criteria = buildCriteria(['x']);
    const r = createRequest('Why?', ['because', 'it', 'is'], criteria);
    assert.equal(r.state.question, 'Why?');
    assert.equal(r.state.answer_so_far, 'because it is');
    assert.match(r.questions.next_word.instructions, /Why\?/);
    assert.match(r.questions.next_word.instructions, /because it is/);
    assert.equal(r.questions.next_word.type, 'choice');
  });

  test('prepends a preamble when given', () => {
    const r = createRequest('Q', [], buildCriteria(['x']), 'PREAMBLE HERE');
    assert.match(r.questions.next_word.instructions, /^PREAMBLE HERE/);
  });
});

describe('measurePrior', () => {
  test('averages three content-free probes', async () => {
    const criteria = buildCriteria(['alpha', 'beta']);
    const { client, calls } = stubClient(({ question }) =>
      ({ type: 'choice', choice: 'w:alpha', probabilities: distribution(question.criteria, 'w:alpha', 0.6) }));

    const prior = await measurePrior(client, 'Q', criteria, '');
    assert.equal(calls(), 3);
    assert.ok(Math.abs(prior['w:alpha'] - 0.6) < 1e-9);
  });
});

describe('decode', () => {
  const criteria = buildCriteria(['alpha', 'beta', 'gamma']);
  const flatPrior = Object.fromEntries(Object.keys(criteria).map((k) => [k, 0.1]));

  test('stops at max and reports the reason', async () => {
    const { client } = stubClient(({ question }) =>
      ({ type: 'choice', choice: 'w:alpha', probabilities: distribution(question.criteria, 'w:alpha') }));

    const r = await decode(client, { question: 'Q', criteria, prior: flatPrior, max: 3, min: 0 });
    assert.equal(r.stop, 'length');
    assert.equal(r.steps, 3);
    assert.equal(r.tokens.length, 3);
  });

  test('stops on end once past the minimum', async () => {
    const { client } = stubClient(({ question }) =>
      ({ type: 'choice', choice: 'end', probabilities: distribution(question.criteria, 'end') }));

    const r = await decode(client, { question: 'Q', criteria, prior: flatPrior, max: 9, min: 0 });
    assert.equal(r.stop, 'end');
    assert.equal(r.tokens.length, 0);
  });

  test('suppresses end below the minimum length', async () => {
    const { client } = stubClient(({ question }) => ({
      type: 'choice',
      choice: 'end',
      probabilities: { ...distribution(question.criteria, 'end', 0.95) },
    }));

    const r = await decode(client, { question: 'Q', criteria, prior: flatPrior, max: 8, min: 4 });
    assert.ok(r.tokens.length >= 4, `expected at least 4 words, got ${r.tokens.length}`);
  });

  test('never repeats the immediately preceding word', async () => {
    // Always favours the same word; only the repeat guard can break the tie.
    const { client } = stubClient(({ question }) =>
      ({ type: 'choice', choice: 'w:alpha', probabilities: distribution(question.criteria, 'w:alpha', 0.99) }));

    const r = await decode(client, {
      question: 'Q', criteria, prior: flatPrior, max: 6, min: 0, penalty: 0,
    });
    for (let i = 1; i < r.tokens.length; i++) {
      assert.notEqual(r.tokens[i], r.tokens[i - 1], `repeated ${r.tokens[i]} at ${i}`);
    }
  });

  test('never emits leading or doubled punctuation', async () => {
    const { client } = stubClient(({ question }) =>
      ({ type: 'choice', choice: 'p:.', probabilities: distribution(question.criteria, 'p:.', 0.99) }));

    const r = await decode(client, {
      question: 'Q', criteria, prior: flatPrior, max: 6, min: 0, penalty: 0,
    });
    assert.notEqual(r.tokens[0], '.', 'answer must not start with punctuation');
    for (let i = 1; i < r.tokens.length; i++) {
      assert.ok(!(PUNCT.includes(r.tokens[i]) && PUNCT.includes(r.tokens[i - 1])),
        'punctuation must not double up');
    }
  });

  test('the repetition penalty spreads word choice', async () => {
    const handler = ({ question }) =>
      ({ type: 'choice', choice: 'w:alpha', probabilities: distribution(question.criteria, 'w:alpha', 0.9) });

    const a = await decode(stubClient(handler).client, {
      question: 'Q', criteria, prior: flatPrior, max: 6, min: 0, penalty: 0,
    });
    const b = await decode(stubClient(handler).client, {
      question: 'Q', criteria, prior: flatPrior, max: 6, min: 0, penalty: 5,
    });
    assert.ok(new Set(b.tokens).size >= new Set(a.tokens).size,
      'a higher penalty should not reduce variety');
  });

  test('alpha re-ranks against the prior', async () => {
    // beta is likelier in context, alpha is likelier a priori.
    const probabilities = { 'w:alpha': 0.5, 'w:beta': 0.4, 'w:gamma': 0.1 };
    const prior = { 'w:alpha': 0.9, 'w:beta': 0.05, 'w:gamma': 0.05 };
    const handler = () => ({ type: 'choice', choice: 'w:alpha', probabilities });

    const raw = await decode(stubClient(handler).client, {
      question: 'Q', criteria, prior, max: 1, min: 0, alpha: 0,
    });
    const calibrated = await decode(stubClient(handler).client, {
      question: 'Q', criteria, prior, max: 1, min: 0, alpha: 1,
    });
    assert.equal(raw.tokens[0], 'alpha', 'alpha=0 follows the raw distribution');
    assert.equal(calibrated.tokens[0], 'beta', 'alpha=1 divides the prior out');
  });

  test('accumulates token usage and invokes onWord', async () => {
    const seen = [];
    const { client } = stubClient(({ question }) =>
      ({ type: 'choice', choice: 'w:alpha', probabilities: distribution(question.criteria, 'w:alpha') }));

    const r = await decode(client, {
      question: 'Q', criteria, prior: flatPrior, max: 3, min: 0,
      onWord: (w, punct) => seen.push([w, punct]),
    });
    assert.equal(seen.length, r.tokens.length);
    assert.equal(r.inputTokens, 10 * r.steps);
    assert.equal(r.text, render(r.tokens));
  });
});
