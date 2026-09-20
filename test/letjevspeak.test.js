import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LetJevSpeak } from '../LetJevSpeak.js';
import Default from '../LetJevSpeak.js';
import { TypeSafe } from '../typesafe.js';
import { CORE, DOMAINS, DOMAIN_KEYS, DOMAIN_BUDGET } from '../vocabs.js';
import { MAX_CHOICES, buildCriteria } from '../decoder.js';
import { stubClient, distribution, withEnvKey } from './helpers.js';

const KEY = 'test-key-123';

/** A LetJevSpeak wired to a stub: routes to `domain`, then emits `word`. */
function stubbed({ domain = 'nature', word = 'alpha', routeWeight = 0.95, options = {} } = {}) {
  const stub = stubClient(({ questionKey, question }) => {
    if (questionKey === 'result') {
      // routing goes through client.choice, which uses the key "result"
      return {
        type: 'choice',
        choice: domain,
        probabilities: distribution(question.criteria, domain, routeWeight),
        confidence: routeWeight,
      };
    }
    const key = `w:${word}` in question.criteria ? `w:${word}` : Object.keys(question.criteria)[0];
    return { type: 'choice', choice: key, probabilities: distribution(question.criteria, key, 0.9) };
  });
  return { jev: new LetJevSpeak(stub.client, options), ...stub };
}

describe('construction', () => {
  test('accepts a key string', () => {
    withEnvKey(null, () => assert.equal(new LetJevSpeak(KEY).client.apiKey, KEY));
  });

  test('accepts a key with options', () => {
    withEnvKey(null, () => {
      const jev = new LetJevSpeak(KEY, { max: 12 });
      assert.equal(jev.client.apiKey, KEY);
      assert.equal(jev.max, 12);
    });
  });

  test('accepts an options object carrying apiKey', () => {
    withEnvKey(null, () => {
      const jev = new LetJevSpeak({ apiKey: KEY, max: 7, alpha: 0.9 });
      assert.equal(jev.client.apiKey, KEY);
      assert.equal(jev.max, 7);
      assert.equal(jev.alpha, 0.9);
    });
  });

  test('accepts an existing client', () => {
    withEnvKey(null, () => {
      const client = new TypeSafe(KEY);
      assert.equal(new LetJevSpeak(client).client, client);
    });
  });

  test('falls back to TYPESAFE_API_KEY', () => {
    withEnvKey('env-key', () => assert.equal(new LetJevSpeak().client.apiKey, 'env-key'));
  });

  test('an explicit key beats the environment', () => {
    withEnvKey('env-key', () => assert.equal(new LetJevSpeak(KEY).client.apiKey, KEY));
  });

  test('throws a named error when no key is available', () => {
    withEnvKey(null, () => {
      assert.throws(() => new LetJevSpeak(), (err) => {
        assert.match(err.message, /^LetJevSpeak: no TypeSafe API key/);
        assert.match(err.message, /TYPESAFE_API_KEY/);
        return true;
      });
    });
  });

  test('rejects a first argument of the wrong type', () => {
    withEnvKey(KEY, () => {
      assert.throws(() => new LetJevSpeak(12345), TypeError);
      assert.throws(() => new LetJevSpeak(true), TypeError);
    });
  });

  test('applies documented defaults', () => {
    withEnvKey(KEY, () => {
      assert.deepEqual(new LetJevSpeak().settings, {
        max: 10, min: 5, alpha: 0.45, penalty: 1.5, blend: true, priorMode: 'vocab',
      });
    });
  });

  test('the default export is the class', () => {
    assert.equal(Default, LetJevSpeak);
  });
});

describe('getters', () => {
  const jev = new LetJevSpeak(KEY);

  test('domains describes every pack', () => {
    assert.equal(jev.domains.length, DOMAIN_KEYS.length);
    for (const d of jev.domains) {
      assert.ok(d.key && d.description && d.size > 0);
    }
  });

  test('domainKeys, core and punctuation return copies', () => {
    jev.domainKeys.push('injected');
    jev.core.push('injected');
    jev.punctuation.push('injected');
    assert.equal(jev.domainKeys.length, DOMAIN_KEYS.length, 'domainKeys must not be mutable');
    assert.equal(jev.core.length, CORE.length, 'core must not be mutable');
  });

  test('exposes the budget constants', () => {
    assert.equal(jev.domainBudget, DOMAIN_BUDGET);
    assert.equal(jev.maxChoices, MAX_CHOICES);
  });

  test('stats start at zero and reset', () => {
    const fresh = new LetJevSpeak(KEY);
    assert.deepEqual(fresh.stats, {
      calls: 0, routeCalls: 0, priorCalls: 0, decodeCalls: 0,
      inputTokens: 0, outputTokens: 0, answers: 0,
    });
  });

  test('stats is a copy, not the live object', () => {
    const fresh = new LetJevSpeak(KEY);
    fresh.stats.calls = 999;
    assert.equal(fresh.stats.calls, 0);
  });
});

describe('has and vocabularyFor', () => {
  const jev = new LetJevSpeak(KEY);

  test('has recognises known packs only', () => {
    assert.equal(jev.has('nature'), true);
    assert.equal(jev.has('twitter'), true);
    assert.equal(jev.has('nope'), false);
    assert.equal(jev.has('toString'), false, 'must not match inherited properties');
  });

  test('vocabularyFor prefixes CORE and stays in budget', () => {
    const v = jev.vocabularyFor('nature');
    assert.deepEqual(v.slice(0, CORE.length), CORE);
    assert.equal(new Set(v).size, v.length, 'no duplicates');
    assert.doesNotThrow(() => buildCriteria(v));
  });

  test('vocabularyFor throws on an unknown pack', () => {
    assert.throws(() => jev.vocabularyFor('nope'), /Unknown domain/);
  });

  test('every pack assembles within the option ceiling', () => {
    for (const k of DOMAIN_KEYS) {
      assert.ok(jev.vocabularyFor(k).length + 8 <= MAX_CHOICES, `${k} overflows`);
    }
  });
});

describe('buildVocab', () => {
  const jev = new LetJevSpeak(KEY);
  const routing = (top) => ({ top });

  test('a clear winner uses one pack', () => {
    const b = jev.buildVocab(routing([['nature', 0.9], ['science', 0.05]]));
    assert.equal(b.mode, 'single');
    assert.deepEqual(b.domains, ['nature']);
  });

  test('a close call blends the top two', () => {
    const b = jev.buildVocab(routing([['nature', 0.5], ['science', 0.45]]));
    assert.equal(b.mode, 'blend');
    assert.deepEqual(b.domains, ['nature', 'science']);
    assert.doesNotThrow(() => buildCriteria(b.words), 'a blend must stay within the ceiling');
  });

  test('a flat distribution falls back to general', () => {
    const b = jev.buildVocab(routing([['nature', 0.1], ['science', 0.09]]));
    assert.equal(b.mode, 'fallback');
    assert.deepEqual(b.domains, ['general']);
  });

  test('blend:false always picks a single pack', () => {
    const solo = new LetJevSpeak(KEY, { blend: false });
    const b = solo.buildVocab(routing([['nature', 0.5], ['science', 0.45]]));
    assert.equal(b.mode, 'single');
  });

  test('a blend favours the winner', () => {
    const b = jev.buildVocab(routing([['nature', 0.5], ['science', 0.45]]));
    const nature = new Set(DOMAINS.nature.words);
    const science = new Set(DOMAINS.science.words);
    const domainWords = b.words.slice(CORE.length);
    const fromFirst = domainWords.filter((w) => nature.has(w)).length;
    const fromSecond = domainWords.filter((w) => science.has(w) && !nature.has(w)).length;
    assert.ok(fromFirst > fromSecond, `winner contributed ${fromFirst}, runner-up ${fromSecond}`);
  });
});

describe('route', () => {
  test('returns the pick plus a ranked list, and counts the call', async () => {
    const { jev } = stubbed({ domain: 'finance' });
    const r = await jev.route('Why do bond prices fall?');

    assert.equal(r.choice, 'finance');
    assert.equal(r.top[0][0], 'finance');
    assert.ok(r.top.length === DOMAIN_KEYS.length);
    assert.equal(jev.stats.routeCalls, 1);
  });

  test('offers every domain as an option', async () => {
    const { jev, bodies } = stubbed();
    await jev.route('anything');
    const criteria = bodies[0].questions.result.criteria;
    assert.deepEqual(Object.keys(criteria).sort(), [...DOMAIN_KEYS].sort());
  });
});

describe('answer', () => {
  test('routes, decodes and reports', async () => {
    const { jev } = stubbed({ domain: 'nature', word: 'animal' });
    const r = await jev.answer('Why do cats purr?', { max: 3 });

    assert.equal(r.domain, 'nature');
    assert.equal(r.vocabMode, 'single');
    assert.ok(r.text.length > 0);
    assert.ok(r.tokens.includes('animal'));
    assert.ok(r.routing, 'routing detail is returned');
    assert.ok(r.optionCount <= MAX_CHOICES);
  });

  test('a forced domain skips the routing call', async () => {
    const { jev } = stubbed({ word: 'animal' });
    const r = await jev.answer('Q', { domain: 'nature', max: 2 });

    assert.equal(r.vocabMode, 'forced');
    assert.equal(r.routing, null);
    assert.equal(jev.stats.routeCalls, 0);
  });

  test('rejects an unknown forced domain before calling out', async () => {
    const { jev, calls } = stubbed();
    await assert.rejects(() => jev.answer('Q', { domain: 'nope' }), /Unknown domain/);
    assert.equal(calls(), 0);
  });

  test('accounts for every call it makes', async () => {
    const { jev, calls } = stubbed({ word: 'animal' });
    await jev.answer('Q', { domain: 'nature', max: 4 });

    const s = jev.stats;
    assert.equal(s.answers, 1);
    assert.equal(s.priorCalls, 3);
    assert.equal(s.decodeCalls, 4);
    assert.equal(s.calls, s.routeCalls + s.priorCalls + s.decodeCalls);
    assert.equal(calls(), s.calls, 'stats must match calls actually issued');
  });

  test('caches the prior per vocabulary', async () => {
    const { jev } = stubbed({ word: 'animal' });
    await jev.answer('First?', { domain: 'nature', max: 2 });
    assert.equal(jev.priorCacheSize, 1);
    assert.equal(jev.stats.priorCalls, 3);

    await jev.answer('Second?', { domain: 'nature', max: 2 });
    assert.equal(jev.stats.priorCalls, 3, 'the second answer reuses the cached prior');

    await jev.answer('Third?', { domain: 'finance', max: 2 });
    assert.equal(jev.stats.priorCalls, 6, 'a new vocabulary measures its own prior');
    assert.equal(jev.priorCacheSize, 2);
  });

  test("priorMode 'question' re-measures every time", async () => {
    const { jev } = stubbed({ word: 'animal', options: { priorMode: 'question' } });
    await jev.answer('First?', { domain: 'nature', max: 1 });
    await jev.answer('Second?', { domain: 'nature', max: 1 });
    assert.equal(jev.stats.priorCalls, 6);
    assert.equal(jev.priorCacheSize, 0);
  });

  test('clearPriorCache and resetStats restore a clean slate', async () => {
    const { jev } = stubbed({ word: 'animal' });
    await jev.answer('Q', { domain: 'nature', max: 2 });

    jev.clearPriorCache();
    jev.resetStats();
    assert.equal(jev.priorCacheSize, 0);
    assert.equal(jev.stats.calls, 0);
  });

  test('streams words through onWord in order', async () => {
    const seen = [];
    const { jev } = stubbed({ word: 'animal' });
    const r = await jev.answer('Q', {
      domain: 'nature', max: 3, onWord: (w) => seen.push(w),
    });
    assert.deepEqual(seen, r.tokens);
  });

  test('sends a preamble through to the decoder', async () => {
    const { jev, bodies } = stubbed({ word: 'animal' });
    await jev.answer('Q', { domain: 'nature', max: 1, preamble: 'BE BRIEF' });
    const decodeBody = bodies.at(-1);
    assert.match(decodeBody.questions.next_word.instructions, /^BE BRIEF/);
  });
});

describe('client options are forwarded, not swallowed', () => {
  // Both of these were found only when the library first ran in a browser:
  // baseUrl was dropped, so requests bypassed the dev-server proxy and were
  // blocked by CORS; and native fetch was invoked with the client as its
  // receiver, which browsers reject.

  test('baseUrl reaches the client', () => {
    const jev = new LetJevSpeak(KEY, { baseUrl: '/api' });
    assert.equal(jev.client.baseUrl, '/api');
  });

  test('timeout, model and fetch reach the client', () => {
    const fake = async () => new Response('{}');
    const jev = new LetJevSpeak(KEY, { timeout: 1234, model: 'jev-test', fetch: fake });
    assert.equal(jev.client.timeout, 1234);
    assert.equal(jev.client.model, 'jev-test');
    assert.equal(typeof jev.client.fetch, 'function');
  });

  test('defaults are untouched when nothing is passed', () => {
    const jev = new LetJevSpeak(KEY);
    assert.equal(jev.client.baseUrl, 'https://api.typesafe.ai');
    assert.equal(jev.client.model, 'jev-latest');
  });

  test('a request routes through baseUrl', async () => {
    const seen = [];
    const fake = async (url) => {
      seen.push(url);
      return new Response(JSON.stringify({
        model: 'm', answers: { result: { type: 'noul', noul: 1 } }, usage: {},
      }), { status: 200 });
    };
    const jev = new LetJevSpeak(KEY, { baseUrl: '/api', fetch: fake });
    await jev.client.noul('x', 'y');
    assert.equal(seen[0], '/api/v1/systemone');
  });

  test('fetch is callable without the client as receiver', async () => {
    // Native fetch throws "Illegal invocation" in a browser when called as a
    // method. Asserting the stored reference is not bare `globalThis.fetch`.
    const jev = new LetJevSpeak(KEY);
    const bare = jev.client.fetch;
    assert.doesNotThrow(() => bare, 'fetch must be detachable');
    assert.notEqual(jev.client.fetch, globalThis.fetch, 'fetch must be bound, not the raw global');
  });
});
