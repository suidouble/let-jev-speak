#!/usr/bin/env node
/**
 * Precompute the per-option prior for every domain vocabulary and write it to
 * lib/priors.js.
 *
 * Measuring a prior costs 3 API calls. On the platform each call is ~620ms, so
 * doing it at runtime adds ~1.9s to every answer and cannot be cached across
 * invocations without a database round trip. The prior is a property of the
 * option set, not of the question, so it can be measured once here instead.
 *
 *   TYPESAFE_API_KEY=... node scripts/build-priors.mjs
 */

import { writeFileSync } from 'node:fs';
import { LetJevSpeak } from '../../LetJevSpeak.js';
import { buildCriteria, measurePrior } from '../../decoder.js';
import { TypeSafe } from '../../typesafe.js';

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  console.error('Set TYPESAFE_API_KEY.');
  process.exit(1);
}

const client = new TypeSafe(key, { maxRetries: 3 });
// blend:false — the bot uses one pack per answer, so only 28 vocabularies
// exist. Blended pairs would need 28x27 priors.
const jev = new LetJevSpeak(client, { blend: false });

const NEUTRAL = 'Answer the question.';
const priors = {};

let n = 0;
for (const domain of jev.domainKeys) {
  const criteria = buildCriteria(jev.vocabularyFor(domain));
  const prior = await measurePrior(client, NEUTRAL, criteria, '');

  // Three decimals keeps the module small; the prior is a smoothing term and
  // the decoder floors it at 0.01 anyway.
  priors[domain] = Object.fromEntries(
    Object.entries(prior)
      .map(([k, v]) => [k, Number(v.toFixed(3))])
      .filter(([, v]) => v > 0),
  );

  n += 3;
  console.log(`${domain.padEnd(16)} ${Object.keys(priors[domain]).length} non-zero options`);
}

const body = `/**
 * Per-option priors, measured once per domain vocabulary by
 * scripts/build-priors.mjs. Regenerate whenever CORE or a domain pack changes:
 *
 *   TYPESAFE_API_KEY=... node scripts/build-priors.mjs
 *
 * Measuring these at runtime would cost 3 API calls (~1.9s) per answer.
 * Options absent from a map fall back to the decoder's floor.
 */

export const PRIORS = ${JSON.stringify(priors, null, 0)};

export default PRIORS;
`;

writeFileSync(new URL('../lib/priors.js', import.meta.url), body);

const bytes = Buffer.byteLength(body);
console.log(`\nwrote lib/priors.js — ${jev.domainKeys.length} domains, ` +
  `${(bytes / 1024).toFixed(0)}KB, ${n} API calls`);
