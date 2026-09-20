import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { CORE, DOMAINS, DOMAIN_KEYS, DOMAIN_BUDGET } from '../vocabs.js';
import { buildCriteria, MAX_CHOICES, PUNCT } from '../decoder.js';

describe('CORE', () => {
  test('has no duplicates', () => {
    assert.equal(new Set(CORE).size, CORE.length);
  });

  test('leaves room for a domain within the option ceiling', () => {
    assert.equal(DOMAIN_BUDGET, MAX_CHOICES - PUNCT.length - 1 - CORE.length);
    assert.ok(DOMAIN_BUDGET > 100, `only ${DOMAIN_BUDGET} slots left for domain words`);
  });

  test('carries the function words grammar depends on', () => {
    for (const w of ['the', 'a', 'is', 'because', 'not', 'and', 'but', 'it', 'of', 'to']) {
      assert.ok(CORE.includes(w), `CORE is missing "${w}"`);
    }
  });
});

describe('domain packs', () => {
  test('every key resolves to a pack', () => {
    assert.ok(DOMAIN_KEYS.length >= 20);
    for (const k of DOMAIN_KEYS) assert.ok(DOMAINS[k], `no pack for ${k}`);
  });

  test('a general fallback pack exists', () => {
    assert.ok(DOMAINS.general, 'buildVocab falls back to `general`');
  });

  for (const key of DOMAIN_KEYS) {
    test(`${key}: well formed and within budget`, () => {
      const pack = DOMAINS[key];

      assert.ok(pack.description?.length > 20,
        'the router picks on meaning, so descriptions must be substantive');
      assert.ok(pack.words.length > 40, `only ${pack.words.length} words`);
      assert.ok(pack.words.length <= DOMAIN_BUDGET,
        `${pack.words.length} words exceeds the ${DOMAIN_BUDGET} budget`);

      assert.equal(new Set(pack.words).size, pack.words.length, 'duplicate words waste slots');

      const shadowed = pack.words.filter((w) => CORE.includes(w));
      assert.deepEqual(shadowed, [], 'words already in CORE waste slots');

      assert.ok(pack.words.every((w) => typeof w === 'string' && w.length > 0));
      assert.ok(pack.words.every((w) => !w.includes('_')), 'underscores should be expanded');
    });
  }

  test('descriptions are distinct', () => {
    const seen = new Map();
    for (const k of DOMAIN_KEYS) {
      const d = DOMAINS[k].description.toLowerCase();
      assert.ok(!seen.has(d), `${k} and ${seen.get(d)} share a description`);
      seen.set(d, k);
    }
  });

  test('every pack fits the API ceiling once assembled with CORE', () => {
    for (const k of DOMAIN_KEYS) {
      const vocab = [...CORE, ...DOMAINS[k].words];
      assert.doesNotThrow(() => buildCriteria(vocab), `${k} overflows when combined with CORE`);
    }
  });

  test('any two packs fit when blended', () => {
    // buildVocab splits the budget 65/35, so the worst case is the two largest.
    const largest = [...DOMAIN_KEYS].sort((a, b) => DOMAINS[b].words.length - DOMAINS[a].words.length);
    const [a, b] = largest;
    const vocab = [...CORE,
      ...DOMAINS[a].words.slice(0, Math.floor(DOMAIN_BUDGET * 0.65)),
      ...DOMAINS[b].words.slice(0, Math.floor(DOMAIN_BUDGET * 0.35))];
    assert.doesNotThrow(() => buildCriteria([...new Set(vocab)]));
  });
});

describe('coverage — a word absent from a pack can never be emitted', () => {
  // Moved here from router-eval.js: this needs no network, so it belongs in
  // the unit suite where it runs on every commit.
  const NEEDED = {
    general: ['thing', 'people', 'reason', 'know', 'time'],
    food: ['bread', 'bun', 'meat', 'eat', 'cook'],
    science: ['light', 'scatter', 'energy', 'water', 'atmosphere'],
    medicine: ['doctor', 'pain', 'infection', 'treat', 'fever'],
    law: ['contract', 'court', 'rights', 'valid', 'breach'],
    finance: ['price', 'market', 'rate', 'profit', 'invest'],
    software: ['code', 'function', 'error', 'thread', 'data'],
    support: ['refund', 'account', 'order', 'charge', 'ticket'],
    emotion: ['happy', 'angry', 'feel', 'sad', 'tone'],
    sports: ['team', 'game', 'score', 'player', 'win'],
    travel: ['city', 'country', 'flight', 'hotel', 'distance'],
    education: ['student', 'teacher', 'exam', 'learn', 'class'],
    history: ['war', 'century', 'government', 'king', 'past'],
    'art-music': ['music', 'song', 'paint', 'film', 'book'],
    nature: ['animal', 'tree', 'sound', 'live', 'young'],
    weather: ['rain', 'wind', 'temperature', 'cloud', 'season'],
    technology: ['computer', 'internet', 'data', 'device', 'network'],
    psychology: ['mind', 'feel', 'habit', 'trust', 'stress'],
    'math-logic': ['number', 'valid', 'logic', 'prove', 'probability'],
    shopping: ['product', 'price', 'review', 'buy', 'quality'],
    ai: ['model', 'training', 'neural', 'prompt', 'accuracy'],
    database: ['query', 'table', 'index', 'join', 'transaction'],
    devops: ['deploy', 'server', 'container', 'pipeline', 'scale'],
    security: ['password', 'encrypt', 'vulnerability', 'attack', 'access'],
    networking: ['protocol', 'request', 'latency', 'packet', 'dns'],
    webdev: ['browser', 'page', 'css', 'render', 'button'],
    'data-analytics': ['metric', 'average', 'trend', 'report', 'sample'],
    twitter: ['tweet', 'reply', 'follower', 'viral', 'hashtag'],
  };

  test('every domain has an expectation listed', () => {
    for (const k of DOMAIN_KEYS) {
      assert.ok(NEEDED[k], `no coverage expectation for the ${k} pack`);
    }
  });

  for (const [domain, needed] of Object.entries(NEEDED)) {
    test(`${domain} can say its own vocabulary`, () => {
      const have = new Set([...(DOMAINS[domain]?.words ?? []), ...CORE]);
      const missing = needed.filter((w) => !have.has(w));
      assert.deepEqual(missing, [], `${domain} cannot emit: ${missing.join(', ')}`);
    });
  }
});
