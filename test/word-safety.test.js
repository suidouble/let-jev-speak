import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LetJevSpeak } from '../LetJevSpeak.js';
import { DOMAINS, DOMAIN_KEYS, DOMAIN_BUDGET, wordProblem, MAX_WORD_LENGTH } from '../vocabs.js';
import { buildCriteria, MAX_CHOICES, PUNCT } from '../decoder.js';

const KEY = 'test-key-123';
const D = 'A description long enough to pass validation';

describe('word safety', () => {
  const jev = () => new LetJevSpeak(KEY);
  const rejects = (words) => assert.throws(
    () => jev().addDomain('x', { description: D, words }),
    /unusable word/,
  );

  test('rejects a double quote, which nests inside the option description', () => {
    rejects(['he said "hi"']);
  });

  test('rejects control characters, which break the instructions', () => {
    rejects(['line1\nline2']);
    rejects(['a\tb']);
    rejects([`a${String.fromCharCode(7)}b`]);
    rejects([`a${String.fromCharCode(0)}b`]);
  });

  test('rejects bare punctuation, which collides with the decoder own marks', () => {
    for (const p of PUNCT) rejects([p]);
  });

  test('rejects overlong strings, which bloat every decode call', () => {
    rejects(['z'.repeat(MAX_WORD_LENGTH + 1)]);
    assert.doesNotThrow(
      () => jev().addDomain('x', { description: D, words: ['z'.repeat(MAX_WORD_LENGTH)] }),
      'a word exactly at the limit is fine',
    );
  });

  test('counts the unusable words and names a few', () => {
    assert.throws(
      () => jev().addDomain('x', { description: D, words: ['a\nb', 'c"d', '.', 'e\tf'] }),
      (err) => {
        assert.match(err.message, /4 unusable word\(s\)/);
        assert.match(err.message, /and 1 more/);
        return true;
      },
    );
  });

  test('accepts ordinary words, accents, emoji and multi-word entries', () => {
    assert.doesNotThrow(() => jev().addDomain('x', {
      description: D,
      words: ['bitcoin', 'café', '🎉', 'most_people', "don't", 'co-op'],
    }));
  });

  test('validation happens before the pack is stored', () => {
    const j = jev();
    assert.throws(() => j.addDomain('x', { description: D, words: ['ok', 'a\nb'] }));
    assert.equal(j.has('x'), false, 'a rejected pack must not be half-registered');
  });

  test('a replace that fails validation leaves the original intact', () => {
    const j = jev();
    j.addDomain('crypto', { description: D, words: ['bitcoin'] });
    assert.throws(() => j.addDomain('crypto', { description: D, words: ['a\nb'] }, { replace: true }));
    assert.deepEqual(j.vocabularyFor('crypto').slice(j.core.length), ['bitcoin']);
  });

  test('wordProblem agrees with what addDomain enforces', () => {
    assert.equal(wordProblem('bitcoin', PUNCT), null);
    assert.equal(wordProblem('most people', PUNCT), null);
    assert.match(wordProblem('a"b', PUNCT), /double quote/);
    assert.match(wordProblem('a\nb', PUNCT), /control character/);
    assert.match(wordProblem('.', PUNCT), /punctuation/);
    assert.match(wordProblem('z'.repeat(99), PUNCT), /longer than/);
    assert.match(wordProblem('', PUNCT), /empty/);
    assert.match(wordProblem(42, PUNCT), /not a string/);
  });

  test('every built-in pack satisfies the same rules', () => {
    for (const key of DOMAIN_KEYS) {
      for (const w of DOMAINS[key].words) {
        assert.equal(wordProblem(w, PUNCT), null, `${key}: ${JSON.stringify(w)} is unusable`);
      }
    }
  });
});

describe('oversized packs cannot breach the option ceiling', () => {
  test('a 5000-word pack is truncated, not overflowed', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('huge', {
      description: D, words: Array.from({ length: 5000 }, (_, i) => `word${i}`),
    });
    const options = Object.keys(buildCriteria(jev.vocabularyFor('huge'))).length;
    assert.ok(options <= MAX_CHOICES, `${options} options exceeds ${MAX_CHOICES}`);
  });

  test('a blend of two huge packs also stays within the ceiling', () => {
    const jev = new LetJevSpeak(KEY);
    const many = (p) => Array.from({ length: 5000 }, (_, i) => `${p}${i}`);
    jev.addDomain('h1', { description: D, words: many('a') });
    jev.addDomain('h2', { description: `${D} two`, words: many('b') });

    const build = jev.buildVocab({ top: [['h1', 0.5], ['h2', 0.45]] });
    assert.equal(build.mode, 'blend');
    assert.ok(Object.keys(buildCriteria(build.words)).length <= MAX_CHOICES);
  });

  test('every built-in assembles at or under the ceiling', () => {
    const jev = new LetJevSpeak(KEY);
    for (const key of jev.domainKeys) {
      const options = Object.keys(buildCriteria(jev.vocabularyFor(key))).length;
      assert.ok(options <= MAX_CHOICES, `${key} produced ${options} options`);
    }
  });

  test('domains reports usable versus stored', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('big', {
      description: D, words: Array.from({ length: 200 }, (_, i) => `w${i}`),
    });

    const big = jev.domains.find((d) => d.key === 'big');
    assert.equal(big.size, 200);
    assert.equal(big.usable, DOMAIN_BUDGET);
    assert.equal(big.truncated, true);

    const normal = jev.domains.find((d) => d.key === 'nature');
    assert.equal(normal.truncated, false);
    assert.equal(normal.usable, normal.size);
  });

  test('no built-in is silently truncated', () => {
    for (const d of new LetJevSpeak(KEY).domains) {
      assert.equal(d.truncated, false, `${d.key} does not fit its own budget`);
    }
  });

  test('truncation keeps the head of the list', () => {
    const jev = new LetJevSpeak(KEY);
    jev.addDomain('big', {
      description: D, words: Array.from({ length: 300 }, (_, i) => `w${i}`),
    });
    const domainWords = jev.vocabularyFor('big').slice(jev.core.length);
    assert.equal(domainWords[0], 'w0');
    assert.equal(domainWords.length, DOMAIN_BUDGET);
    assert.ok(!domainWords.includes('w299'));
  });

  test('emits a warning naming the unusable remainder', async () => {
    const warnings = [];
    const listener = (w) => warnings.push(w);
    process.on('warning', listener);
    try {
      new LetJevSpeak(KEY).addDomain('big', {
        description: D, words: Array.from({ length: 200 }, (_, i) => `w${i}`),
      });
      await new Promise((r) => setImmediate(r)); // emitWarning is async
    } finally {
      process.removeListener('warning', listener);
    }

    // emitWarning is async, so warnings from earlier tests can land here too.
    const mine = warnings.find((w) =>
      w.name === 'LetJevSpeakVocabularyWarning' && w.message.includes('"big"'));
    assert.ok(mine, 'expected a vocabulary warning for the "big" pack');
    assert.match(mine.message, /200 words but only 145/);
    assert.match(mine.message, /last 55 will never be used/);
  });
});
