import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LetJevSpeak } from '../LetJevSpeak.js';
import { CORE, DOMAINS, DOMAIN_KEYS, DOMAIN_BUDGET } from '../vocabs.js';
import { buildCriteria, MAX_CHOICES } from '../decoder.js';
import { stubClient, distribution } from './helpers.js';

const KEY = 'test-key-123';

const CRYPTO = {
  description: 'Cryptocurrency, blockchains, wallets, tokens, mining and trading',
  words: 'bitcoin ethereum blockchain wallet token coin mining exchange ledger chain',
};

describe('addDomain', () => {
  test('registers a pack that shows up everywhere', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('crypto', CRYPTO);

    assert.equal(jev.has('crypto'), true);
    assert.ok(jev.domainKeys.includes('crypto'));
    assert.ok(jev.customDomainKeys.includes('crypto'));

    const entry = jev.domains.find((d) => d.key === 'crypto');
    assert.equal(entry.description, CRYPTO.description);
    assert.equal(entry.custom, true);
    assert.equal(entry.size, 10);
  });

  test('returns this, so calls chain', () => {
    const jev = new LetJevSpeak(KEY);
    const out = jev
      .addDomain('crypto', CRYPTO)
      .addDomain('knitting', { description: 'Knitting, yarn, needles and stitch patterns', words: ['yarn', 'stitch'] });
    assert.equal(out, jev);
    assert.equal(jev.customDomainKeys.length, 2);
  });

  test('accepts words as an array or a string', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('a', { description: 'A domain about alpha things', words: ['zebra', 'yak'] });
    jev.addDomain('b', { description: 'A domain about beta things', words: 'zebra yak' });
    assert.deepEqual(
      jev.vocabularyFor('a').slice(CORE.length),
      jev.vocabularyFor('b').slice(CORE.length),
    );
  });

  test('drops words already in CORE, which would waste a slot', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('x', { description: 'A domain with redundant words', words: ['the', 'is', 'bitcoin'] });
    assert.deepEqual(jev.domains.find((d) => d.key === 'x').size, 1);
    assert.deepEqual(jev.vocabularyFor('x').slice(CORE.length), ['bitcoin']);
  });

  test('drops repeated words but keeps order', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('x', { description: 'A domain with repeated words', words: 'zebra yak zebra xerus' });
    assert.deepEqual(jev.vocabularyFor('x').slice(CORE.length), ['zebra', 'yak', 'xerus']);
  });

  test('expands underscores into multi-word entries', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('x', { description: 'A domain with a compound entry', words: ['most_people'] });
    assert.deepEqual(jev.vocabularyFor('x').slice(CORE.length), ['most people']);
  });

  test('a custom pack assembles within the API ceiling', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('crypto', CRYPTO);
    assert.doesNotThrow(() => buildCriteria(jev.vocabularyFor('crypto')));
  });

  test('an oversized pack truncates from the tail at assembly', () => {
    const jev = new LetJevSpeak(KEY);
    const many = Array.from({ length: DOMAIN_BUDGET + 50 }, (_, i) => `word${i}`);
    jev.addDomain('big', { description: 'A deliberately oversized pack', words: many });

    const vocab = jev.vocabularyFor('big');
    assert.doesNotThrow(() => buildCriteria(vocab), 'assembly must respect the ceiling');
    assert.equal(vocab.length - CORE.length, DOMAIN_BUDGET);
    assert.ok(vocab.includes('word0'), 'the most important words survive');
    assert.ok(!vocab.includes(`word${DOMAIN_BUDGET + 49}`), 'the tail is dropped');
  });
});

describe('addDomain validation', () => {
  const jev = () => new LetJevSpeak(KEY);

  test('rejects a bad key', () => {
    assert.throws(() => jev().addDomain('', CRYPTO), TypeError);
    assert.throws(() => jev().addDomain('has space', CRYPTO), TypeError);
    assert.throws(() => jev().addDomain(42, CRYPTO), TypeError);
  });

  test('rejects a missing or vague description', () => {
    assert.throws(() => jev().addDomain('x', { words: ['a'] }), TypeError);
    assert.throws(() => jev().addDomain('x', { description: 'short', words: ['a'] }), /at least 10/);
  });

  test('rejects empty or malformed words', () => {
    assert.throws(() => jev().addDomain('x', { description: 'A valid description here', words: [] }), TypeError);
    assert.throws(() => jev().addDomain('x', { description: 'A valid description here', words: [1, 2] }), TypeError);
    assert.throws(() => jev().addDomain('x', { description: 'A valid description here' }), TypeError);
  });

  test('rejects a pack that is entirely CORE', () => {
    assert.throws(
      () => jev().addDomain('x', { description: 'Only function words in here', words: ['the', 'is', 'a'] }),
      /adds nothing/,
    );
  });

  test('refuses to overwrite silently', () => {
    const j = jev();
    j.addDomain('crypto', CRYPTO);
    assert.throws(() => j.addDomain('crypto', CRYPTO), /already exists/);
    assert.throws(() => j.addDomain('finance', CRYPTO), /already exists/);
  });

  test('replaces when told to', () => {
    const j = jev();
    j.addDomain('finance', {
      description: 'My own finance vocabulary, replacing the built-in one',
      words: ['satoshi'],
    }, { replace: true });

    assert.deepEqual(j.vocabularyFor('finance').slice(CORE.length), ['satoshi']);
    assert.ok(j.customDomainKeys.includes('finance'));
  });
});

describe('removeDomain', () => {
  test('removes a pack and reports whether it did', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('crypto', CRYPTO);

    assert.equal(jev.removeDomain('crypto'), true);
    assert.equal(jev.has('crypto'), false);
    assert.equal(jev.removeDomain('crypto'), false, 'removing twice is a no-op');
  });

  test('can remove a built-in on this instance only', () => {
    const jev = new LetJevSpeak(KEY);
    assert.equal(jev.removeDomain('twitter'), true);
    assert.equal(jev.has('twitter'), false);
    assert.ok(DOMAINS.twitter, 'the shared pack is untouched');
    assert.ok(new LetJevSpeak(KEY).has('twitter'), 'a fresh instance still has it');
  });

  test('refuses to remove the routing fallback', () => {
    const jev = new LetJevSpeak(KEY);
    assert.throws(() => jev.removeDomain('general'), /fallback/);
    assert.equal(jev.has('general'), true);
  });
});

describe('isolation', () => {
  test('a custom pack does not leak into other instances', () => {
    const a = new LetJevSpeak(KEY);
    const b = new LetJevSpeak(KEY);
    a.addDomain('crypto', CRYPTO);

    assert.equal(a.has('crypto'), true);
    assert.equal(b.has('crypto'), false);
  });

  test('the shared module registry is never mutated', () => {
    const before = DOMAIN_KEYS.length;
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('crypto', CRYPTO);
    jev.addDomain('finance', { description: 'A replacement finance pack', words: ['satoshi'] }, { replace: true });

    assert.equal(DOMAIN_KEYS.length, before);
    assert.equal(DOMAINS.crypto, undefined);
    assert.ok(DOMAINS.finance.words.includes('price'), 'the built-in finance pack is intact');
  });

  test('editing a returned word list does not corrupt the pack', () => {
    const jev = new LetJevSpeak(KEY);
    jev.vocabularyFor('nature').push('INJECTED');
    assert.ok(!jev.vocabularyFor('nature').includes('INJECTED'));
  });
});

describe('constructor domains option', () => {
  test('registers packs up front', () => {
    const jev = new LetJevSpeak(KEY, { domains: { crypto: CRYPTO } });
    assert.equal(jev.has('crypto'), true);
    assert.deepEqual(jev.customDomainKeys, ['crypto']);
  });

  test('may override a built-in without an explicit replace flag', () => {
    const jev = new LetJevSpeak(KEY, {
      domains: { finance: { description: 'A replacement finance pack for tests', words: ['satoshi'] } },
    });
    assert.deepEqual(jev.vocabularyFor('finance').slice(CORE.length), ['satoshi']);
  });

  test('works alongside apiKey in a single options object', () => {
    const jev = new LetJevSpeak({ apiKey: KEY, max: 4, domains: { crypto: CRYPTO } });
    assert.equal(jev.max, 4);
    assert.equal(jev.has('crypto'), true);
  });

  test('propagates validation errors from the constructor', () => {
    assert.throws(
      () => new LetJevSpeak(KEY, { domains: { bad: { description: 'no', words: [] } } }),
      TypeError,
    );
  });
});

describe('custom packs take part in routing and decoding', () => {
  /** Routes to `domain`, then always picks `word` if the vocabulary has it. */
  function stubbed(domain, word) {
    const stub = stubClient(({ questionKey, question }) => {
      if (questionKey === 'result') {
        return {
          type: 'choice',
          choice: domain,
          probabilities: distribution(question.criteria, domain, 0.95),
          confidence: 0.95,
        };
      }
      const key = `w:${word}` in question.criteria ? `w:${word}` : Object.keys(question.criteria)[0];
      return { type: 'choice', choice: key, probabilities: distribution(question.criteria, key, 0.9) };
    });
    return stub;
  }

  test('a custom pack is offered to the router', async () => {
    const stub = stubbed('crypto', 'bitcoin');
    const jev = new LetJevSpeak(stub.client, { domains: { crypto: CRYPTO } });
    await jev.route('What is a hardware wallet?');

    const criteria = stub.bodies[0].questions.result.criteria;
    assert.ok(Object.hasOwn(criteria, 'crypto'), 'custom domain must be a routing option');
    assert.equal(criteria.crypto, CRYPTO.description);
  });

  test('a removed pack is not offered to the router', async () => {
    const stub = stubbed('general', 'thing');
    const jev = new LetJevSpeak(stub.client);
    jev.removeDomain('twitter');
    await jev.route('anything');

    assert.ok(!Object.hasOwn(stub.bodies[0].questions.result.criteria, 'twitter'));
  });

  test('routing to a custom pack decodes over its words', async () => {
    const stub = stubbed('crypto', 'bitcoin');
    const jev = new LetJevSpeak(stub.client, { domains: { crypto: CRYPTO }, max: 3 });
    const r = await jev.answer('What is a hardware wallet?');

    assert.equal(r.domain, 'crypto');
    assert.ok(r.tokens.includes('bitcoin'), `expected a custom word, got ${r.text}`);
  });

  test('a custom pack can be forced directly', async () => {
    const stub = stubbed('crypto', 'ledger');
    const jev = new LetJevSpeak(stub.client, { domains: { crypto: CRYPTO } });
    const r = await jev.answer('Q', { domain: 'crypto', max: 2 });

    assert.equal(r.vocabMode, 'forced');
    assert.equal(r.domain, 'crypto');
    assert.equal(jev.stats.routeCalls, 0);
  });

  test('routing still fits the option ceiling with customs added', () => {
    const jev = new LetJevSpeak(KEY);
    for (let i = 0; i < 20; i++) {
      jev.addDomain(`extra${i}`, { description: `An extra domain number ${i} for testing`, words: [`w${i}`] });
    }
    assert.ok(jev.domainKeys.length <= MAX_CHOICES);
  });

  test('refuses to exceed the routing ceiling', () => {
    const jev = new LetJevSpeak(KEY);
    let added = 0;
    assert.throws(() => {
      while (added < MAX_CHOICES + 5) {
        jev.addDomain(`d${added}`, { description: `Filler domain number ${added}`, words: [`w${added}`] });
        added++;
      }
    }, /cannot exceed 255 domains/);
  });
});

describe('prior cache invalidation', () => {
  test('adding a pack clears cached priors', async () => {
    const stub = stubClient(({ question }) => ({
      type: 'choice',
      choice: Object.keys(question.criteria)[0],
      probabilities: distribution(question.criteria, Object.keys(question.criteria)[0], 0.9),
      confidence: 0.9,
    }));
    const jev = new LetJevSpeak(stub.client);
    await jev.answer('Q', { domain: 'nature', max: 1 });
    assert.equal(jev.priorCacheSize, 1);

    jev.addDomain('crypto', CRYPTO);
    assert.equal(jev.priorCacheSize, 0, 'a changed registry invalidates measured priors');
  });

  test('removing a pack clears cached priors', async () => {
    const stub = stubClient(({ question }) => ({
      type: 'choice',
      choice: Object.keys(question.criteria)[0],
      probabilities: distribution(question.criteria, Object.keys(question.criteria)[0], 0.9),
      confidence: 0.9,
    }));
    const jev = new LetJevSpeak(stub.client);
    await jev.answer('Q', { domain: 'nature', max: 1 });
    jev.removeDomain('twitter');
    assert.equal(jev.priorCacheSize, 0);
  });
});
