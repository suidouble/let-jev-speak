#!/usr/bin/env node
/**
 * Ask a question and let the model pick its own vocabulary.
 *
 *   node ask.js "Why do cats purr?"
 *   node ask.js "Is a hot dog a sandwich?" --max 12
 *   node ask.js "What is a bond?" --domain finance   # skip routing
 *   node ask.js --domains                            # list the packs
 *   node ask.js --vocab nature                       # show a pack's word list
 */

import { LetJevSpeak } from './LetJevSpeak.js';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};

if (!process.env.TYPESAFE_API_KEY) {
  console.error('Set TYPESAFE_API_KEY first.');
  process.exit(1);
}

const jev = new LetJevSpeak({ max: Number(flag('max', 10)) });

if (argv.includes('--domains')) {
  for (const d of jev.domains) {
    console.log(`${d.key.padEnd(15)} ${String(d.size).padStart(3)} words  ${d.description}`);
  }
  console.log(`\n${jev.domainKeys.length} domains · ${jev.core.length} core words · ` +
    `${jev.domainBudget} domain slots · ${jev.maxChoices} option ceiling`);
  process.exit(0);
}

const showVocab = flag('vocab', null);
if (showVocab) {
  if (!jev.has(showVocab)) {
    console.error(`Unknown domain ${JSON.stringify(showVocab)}. Known: ${jev.domainKeys.join(', ')}`);
    process.exit(1);
  }
  const v = jev.vocabularyFor(showVocab);
  console.log(`${showVocab}: ${v.length} words (${jev.core.length} core + ${v.length - jev.core.length} domain)\n`);
  console.log(v.slice(jev.core.length).join(' '));
  process.exit(0);
}

const flagArgs = new Set();
for (const n of ['max', 'domain', 'vocab']) {
  const i = argv.indexOf(`--${n}`);
  if (i !== -1) flagArgs.add(argv[i + 1]);
}
const question = argv.find((a) => !a.startsWith('--') && !flagArgs.has(a));

if (!question) {
  console.error('Usage: node ask.js "your question"');
  process.exit(1);
}

console.log(`Q: ${question}`);
process.stdout.write('A: ');

let first = true;
const r = await jev.answer(question, {
  domain: flag('domain', null) ?? undefined,
  onWord: (w, punct) => {
    process.stdout.write(punct || first ? w : ` ${w}`);
    first = false;
  },
});
console.log('\n');

const routeLine = r.routing
  ? r.routing.top.slice(0, 3).map(([k, p]) => `${k}=${p.toFixed(2)}`).join('  ')
  : '(forced)';
console.log(`domain:  ${r.domains.join(' + ')}  [${r.vocabMode}]`);
console.log(`routing: ${routeLine}`);
console.log(`vocab:   ${r.vocabSize} words → ${r.optionCount} options`);

const { calls, routeCalls, priorCalls, decodeCalls, inputTokens, outputTokens } = jev.stats;
console.log(`cost:    ${calls} calls (${routeCalls} route + ${priorCalls} prior + ${decodeCalls} decode) · ` +
  `${inputTokens} in / ${outputTokens} out`);
