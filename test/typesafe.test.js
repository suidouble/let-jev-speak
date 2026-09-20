import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { TypeSafe, TypeSafeError } from '../typesafe.js';
import { stubClient, failingClient, withEnvKey } from './helpers.js';

describe('TypeSafe construction', () => {
  test('accepts a key positionally', () => {
    assert.equal(new TypeSafe('abc').apiKey, 'abc');
  });

  test('accepts a key in an options object', () => {
    assert.equal(new TypeSafe({ apiKey: 'abc' }).apiKey, 'abc');
  });

  test('falls back to TYPESAFE_API_KEY', () => {
    withEnvKey('env-key', () => assert.equal(new TypeSafe().apiKey, 'env-key'));
  });

  test('throws when no key is available anywhere', () => {
    withEnvKey(null, () => {
      assert.throws(() => new TypeSafe(), TypeSafeError);
    });
  });

  test('applies defaults and overrides', () => {
    const ts = new TypeSafe('k', { baseUrl: 'https://example.test/', model: 'custom', timeout: 5 });
    assert.equal(ts.baseUrl, 'https://example.test', 'trailing slash stripped');
    assert.equal(ts.model, 'custom');
    assert.equal(ts.timeout, 5);
    assert.equal(new TypeSafe('k').model, 'jev-latest');
  });
});

describe('TypeSafe.systemOne', () => {
  test('sends key, model and questions', async () => {
    const { client, bodies } = stubClient(() => ({ type: 'noul', noul: 1 }));
    await client.systemOne('hello', { q: { type: 'noul', instructions: 'i' } });

    assert.equal(bodies[0].state, 'hello');
    assert.equal(bodies[0].model, 'jev-latest');
    assert.deepEqual(Object.keys(bodies[0].questions), ['q']);
  });

  test('accepts an object as state', async () => {
    const { client, bodies } = stubClient(() => ({ type: 'noul', noul: 1 }));
    await client.systemOne({ a: 1 }, { q: { type: 'noul', instructions: 'i' } });
    assert.deepEqual(bodies[0].state, { a: 1 });
  });

  test('rejects empty or missing state', async () => {
    const { client } = stubClient(() => ({}));
    const q = { q: { type: 'noul', instructions: 'i' } };
    await assert.rejects(() => client.systemOne('', q), TypeSafeError);
    await assert.rejects(() => client.systemOne(null, q), TypeSafeError);
  });

  test('rejects an empty question set', async () => {
    const { client } = stubClient(() => ({}));
    await assert.rejects(() => client.systemOne('x', {}), TypeSafeError);
  });

  test('per-call model overrides the default', async () => {
    const { client, bodies } = stubClient(() => ({ type: 'noul', noul: 1 }));
    await client.systemOne('x', { q: { type: 'noul', instructions: 'i' } }, { model: 'other' });
    assert.equal(bodies[0].model, 'other');
  });
});

describe('TypeSafe helpers', () => {
  test('choice unwraps the answer and attaches usage', async () => {
    const { client } = stubClient(() => ({
      type: 'choice', choice: 'a', probabilities: { a: 0.8, b: 0.2 }, confidence: 0.6,
    }));
    const r = await client.choice('text', 'pick', { a: 'A', b: 'B' });
    assert.equal(r.choice, 'a');
    assert.equal(r.confidence, 0.6);
    assert.equal(r.usage.input_tokens, 10);
  });

  test('score requires an ordered array of at least two levels', async () => {
    const { client } = stubClient(() => ({ type: 'score', score: 1, legend: {}, confidence: 1 }));
    await assert.rejects(() => client.score('t', 'i', ['only one']), TypeSafeError);
    await assert.rejects(() => client.score('t', 'i', 'not an array'), TypeSafeError);
    const r = await client.score('t', 'i', ['low', 'high']);
    assert.equal(r.score, 1);
  });

  test('noul returns the raw value', async () => {
    const { client } = stubClient(() => ({ type: 'noul', noul: 0.99 }));
    assert.equal((await client.noul('t', 'i')).noul, 0.99);
  });

  test('is() thresholds noul into a boolean', async () => {
    const { client } = stubClient(() => ({ type: 'noul', noul: 0.6 }));
    assert.equal(await client.is('t', 'i'), true);
    assert.equal(await client.is('t', 'i', { threshold: 0.7 }), false);
  });

  test('batch returns one result per input, preserving order', async () => {
    const { client } = stubClient(({ body }) => ({
      type: 'noul', noul: body.state === 'b' ? 1 : 0,
    }));
    const out = await client.batch(['a', 'b', 'c'], { q: { type: 'noul', instructions: 'i' } });
    assert.equal(out.length, 3);
    assert.ok(out.every((r) => r.ok));
    assert.equal(out[1].value.answers.q.noul, 1);
  });

  test('batch isolates a failure to its own entry', async () => {
    let n = 0;
    const client = new TypeSafe('k', {
      maxRetries: 0,
      fetch: async () => {
        n++;
        if (n === 2) return new Response('{"detail":"boom"}', { status: 400 });
        return new Response(JSON.stringify({
          model: 'm', answers: { q: { type: 'noul', noul: 1 } }, usage: {},
        }), { status: 200 });
      },
    });
    const out = await client.batch(['a', 'b'], { q: { type: 'noul', instructions: 'i' } },
      { concurrency: 1 });
    assert.equal(out[0].ok, true);
    assert.equal(out[1].ok, false);
    assert.ok(out[1].error instanceof TypeSafeError);
  });
});

describe('TypeSafe errors', () => {
  test('unwraps a FastAPI object detail', async () => {
    const { client } = failingClient(401, {
      detail: { error_type: 'authentication_error', message: 'Cannot authenticate' },
    });
    await assert.rejects(
      () => client.noul('t', 'i'),
      (err) => {
        assert.ok(err instanceof TypeSafeError);
        assert.equal(err.status, 401);
        assert.match(err.message, /Cannot authenticate/);
        return true;
      },
    );
  });

  test('unwraps a FastAPI validation array', async () => {
    const { client } = failingClient(422, {
      detail: [{ type: 'missing', loc: ['body', 'questions', 'q'], msg: 'Field required' }],
    });
    await assert.rejects(() => client.noul('t', 'i'), (err) => {
      assert.match(err.message, /body\.questions\.q: Field required/);
      return true;
    });
  });

  test('keeps the parsed body on the error', async () => {
    const { client } = failingClient(400, { detail: 'nope' });
    await assert.rejects(() => client.noul('t', 'i'), (err) => {
      assert.deepEqual(err.body, { detail: 'nope' });
      return true;
    });
  });

  test('does not retry a 4xx', async () => {
    const { client, calls } = failingClient(400, { detail: 'bad' }, { maxRetries: 3 });
    await assert.rejects(() => client.noul('t', 'i'));
    assert.equal(calls(), 1);
  });

  test('retries a 5xx up to maxRetries, then throws', async () => {
    const { client, calls } = failingClient(500, { detail: 'server' }, { maxRetries: 2 });
    await assert.rejects(() => client.noul('t', 'i'));
    assert.equal(calls(), 3, 'initial attempt plus two retries');
  });

  test('retries a 429', async () => {
    const { client, calls } = failingClient(429, { detail: 'slow down' }, { maxRetries: 1 });
    await assert.rejects(() => client.noul('t', 'i'));
    assert.equal(calls(), 2);
  });

  test('recovers when a retry succeeds', async () => {
    let n = 0;
    const client = new TypeSafe('k', {
      maxRetries: 2,
      fetch: async () => {
        n++;
        if (n === 1) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({
          model: 'm', answers: { result: { type: 'noul', noul: 0.5 } }, usage: {},
        }), { status: 200 });
      },
    });
    assert.equal((await client.noul('t', 'i')).noul, 0.5);
    assert.equal(n, 2);
  });
});
