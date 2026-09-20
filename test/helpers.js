/**
 * Test helpers — a stubbed TypeSafe client, so unit tests never touch the network.
 */

import { TypeSafe } from '../typesafe.js';

/**
 * Build a TypeSafe client whose fetch is driven by `handler`.
 *
 * @param {(ctx: {questionKey: string, question: object, body: object, calls: number}) => object} handler
 *   Returns the answer object for the single question in the request.
 * @param {object} [opts]
 * @param {object} [opts.clientOptions]  passed through to the TypeSafe constructor
 * @returns {{client: TypeSafe, calls: () => number, bodies: object[]}}
 */
export function stubClient(handler, { clientOptions = {} } = {}) {
  let calls = 0;
  const bodies = [];

  const fetchStub = async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    bodies.push(body);

    const questionKey = Object.keys(body.questions)[0];
    const answer = handler({
      questionKey,
      question: body.questions[questionKey],
      body,
      calls,
    });

    return new Response(
      JSON.stringify({
        model: 'jev-test',
        answers: { [questionKey]: answer },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };

  return {
    client: new TypeSafe('test-key', { fetch: fetchStub, maxRetries: 0, ...clientOptions }),
    calls: () => calls,
    bodies,
  };
}

/** A client that returns a fixed HTTP status and body, for error-path tests. */
export function failingClient(status, body, { maxRetries = 0 } = {}) {
  let calls = 0;
  const fetchStub = async () => {
    calls++;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return {
    client: new TypeSafe('test-key', { fetch: fetchStub, maxRetries }),
    calls: () => calls,
  };
}

/** Uniform probabilities over a criteria map, with one option boosted. */
export function distribution(criteria, favour, weight = 0.9) {
  const keys = Object.keys(criteria);
  const rest = (1 - weight) / Math.max(keys.length - 1, 1);
  return Object.fromEntries(keys.map((k) => [k, k === favour ? weight : rest]));
}

/**
 * Run a function with TYPESAFE_API_KEY set to `value` (or removed when null),
 * restoring the previous value afterwards.
 */
export function withEnvKey(value, fn) {
  const previous = process.env.TYPESAFE_API_KEY;
  if (value === null) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = previous;
  }
}
