#!/usr/bin/env node
/**
 * Verification for LetJevSpeak. Three checks, because every assumption in this
 * project so far has broken on contact with the API:
 *
 *   1. routing   — does the model put questions in the right pack?
 *   2. benefit   — does routing beat a general vocabulary, and does a
 *                  deliberately wrong pack actually hurt? If routed ≈ general
 *                  the routing call is not earning its cost.
 *   3. coverage  — does each pack contain the words its answers need?
 *
 *   node router-eval.js              # all three
 *   node router-eval.js --routing
 *   node router-eval.js --benefit
 *   node router-eval.js --coverage   # local, no API calls
 */

import { LetJevSpeak } from './LetJevSpeak.js';
import { CORE, DOMAINS } from './vocabs.js';

const argv = process.argv.slice(2);
const runAll = !argv.some((a) => ['--routing', '--benefit', '--coverage'].includes(a));
const want = (n) => runAll || argv.includes(`--${n}`);

// ── 1. routing accuracy ──────────────────────────────────────────────────
const LABELLED = [
  ['Is a hot dog a sandwich?', 'food'],
  ['How long should I boil pasta?', 'food'],
  ['Why is the sky blue?', 'science'],
  ['What causes a rainbow?', 'science'],
  ['I have had a fever for three days, should I see a doctor?', 'medicine'],
  ['What does an antibiotic actually do?', 'medicine'],
  ['Can my landlord evict me without notice?', 'law'],
  ['What makes a contract legally binding?', 'law'],
  ['Why do bond prices fall when interest rates rise?', 'finance'],
  ['Is it better to pay off debt or invest?', 'finance'],
  ['What is a race condition in code?', 'software'],
  ['Why does my function return undefined?', 'software'],
  ['I was charged twice for my subscription.', 'support'],
  ['My order still has not arrived after two weeks.', 'support'],
  ['Why do I feel anxious before a presentation?', 'psychology'],
  ['How do I rebuild trust with a friend?', 'psychology'],
  ['Does he sound angry or just tired in this message?', 'emotion'],
  ['Why do cats purr?', 'nature'],
  ['How do trees survive the winter?', 'nature'],
  ['Will it rain tomorrow if the pressure is falling?', 'weather'],
  ['Why is it colder at the top of a mountain?', 'weather'],
  ['Who won the World Cup in 1998?', 'sports'],
  ['How long is a marathon?', 'sports'],
  ['What is the best time of year to visit Japan?', 'travel'],
  ['How far is it from Paris to Berlin?', 'travel'],
  ['How should I revise for an exam?', 'education'],
  ['What makes a good teacher?', 'education'],
  ['What caused the First World War?', 'history'],
  ['How does a democracy differ from a monarchy?', 'history'],
  ['Who painted the Mona Lisa?', 'art-music'],
  ['What makes a song catchy?', 'art-music'],
  ['Is this laptop worth the price?', 'shopping'],
  ['Should I trust a product with only five reviews?', 'shopping'],
  ['Is my phone battery draining too fast?', 'technology'],
  ['Is my phone listening to me?', 'technology'],
  ['If all A are B and all B are C, are all A C?', 'math-logic'],
  ['What is the probability of two heads in a row?', 'math-logic'],
  ['What is the meaning of life?', 'general'],
  ['Is it better to be early or late?', 'general'],

  // IT specialisms. These are the hard cases — neighbouring technical domains
  // share most of their surface vocabulary, so they are where routing should
  // break first if the descriptions are not contrastive enough.
  ['How does a neural network learn from training data?', 'ai'],
  ['Why does my model overfit on the training set?', 'ai'],
  ['What is an embedding vector used for?', 'ai'],
  ['Should I add an index to this column?', 'database'],
  ['Why is my SQL join returning duplicate rows?', 'database'],
  ['When should I roll back a transaction?', 'database'],
  ['My container keeps restarting after deploy.', 'devops'],
  ['How do I scale a service under heavy traffic?', 'devops'],
  ['The build pipeline fails only in production.', 'devops'],
  ['How do I store user passwords safely?', 'security'],
  ['Is this login form vulnerable to injection?', 'security'],
  ['Someone leaked our API keys, what now?', 'security'],
  ['Why is DNS resolution so slow on this host?', 'networking'],
  ['What does a 504 gateway timeout mean?', 'networking'],
  ['How do I center a div with flexbox?', 'webdev'],
  ['My page re-renders on every keystroke.', 'webdev'],
  ['What is the average session length this month?', 'data-analytics'],
  ['Is this sample size big enough to be significant?', 'data-analytics'],
  ['Why did my tweet get no engagement?', 'twitter'],
  ['Should I reply to this thread or quote it?', 'twitter'],
  ['This reply is getting ratioed badly.', 'twitter'],
];

// ── 2. benefit: routed vs general vs wrong ───────────────────────────────
const BENEFIT = [
  ['Why do cats purr?', 'nature', 'finance'],
  ['Why do bond prices fall when interest rates rise?', 'finance', 'nature'],
  ['I have had a fever for three days, should I see a doctor?', 'medicine', 'art-music'],
  ['What is a race condition in code?', 'software', 'food'],
  ['Is a hot dog a sandwich?', 'food', 'law'],
  ['Why is the sky blue?', 'science', 'shopping'],
];

if (!process.env.TYPESAFE_API_KEY) {
  console.error('Set TYPESAFE_API_KEY first.');
  process.exit(1);
}
const jev = new LetJevSpeak({ max: 10 });
const client = jev.client;

const bar = (v, w = 10) => '█'.repeat(Math.round(v * w)).padEnd(w, '·');

// ─────────────────────────────────────────────────────────────── 1. routing
if (want('routing')) {
  console.log('1. ROUTING ACCURACY\n');
  const results = await Promise.all(LABELLED.map(([q]) => jev.route(q)));

  let hits = 0;
  const misses = [];
  const confHit = [];
  results.forEach((r, i) => {
    const [q, want_] = LABELLED[i];
    if (r.choice === want_) { hits++; confHit.push(r.confidence ?? 0); }
    else misses.push([q, r.choice, want_, r.probabilities?.[want_] ?? 0, r.top]);
  });

  const acc = hits / LABELLED.length;
  console.log(`   ${hits}/${LABELLED.length}  ${bar(acc, 20)} ${Math.round(acc * 100)}%`);
  console.log(`   mean confidence when right: ${(confHit.reduce((a, b) => a + b, 0) / (confHit.length || 1)).toFixed(2)}`);

  if (misses.length) {
    console.log('\n   misrouted:');
    for (const [q, got, want_, p, top] of misses) {
      console.log(`     ${JSON.stringify(q.slice(0, 50))}`);
      console.log(`       chose ${got}, expected ${want_} (p=${p.toFixed(2)})  ` +
        `top: ${top.slice(0, 3).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ')}`);
    }
  }
  console.log();
}

// ─────────────────────────────────────────────────────────────── 2. benefit
if (want('benefit')) {
  console.log('2. DOES ROUTING HELP?\n');
  console.log('   Same question, three vocabularies. "judge" is the model scoring');
  console.log('   how well the answer addresses the question (0-2). "domain%" is the');
  console.log('   share of emitted words that came from the domain pack, not CORE.\n');

  const judge = async (question, text) => {
    if (!text.trim()) return 0;
    const r = await client.score(
      `Question: ${question}\n\nAnswer: ${text}`,
      'How well does the answer address the question?',
      ['Not at all — irrelevant or incoherent',
       'Partly — on topic but incomplete or garbled',
       'Well — a relevant, understandable answer'],
    );
    return r.score;
  };

  const domainShare = (tokens, domain) => {
    const dom = new Set(DOMAINS[domain].words);
    const words = tokens.filter((t) => /[a-z]/i.test(t));
    if (!words.length) return 0;
    return words.filter((w) => dom.has(w) && !CORE.includes(w)).length / words.length;
  };

  const rows = [];
  for (const [question, right, wrong] of BENEFIT) {
    const routed = await jev.answer(question);
    const general = await jev.answer(question, { domain: 'general' });
    const bad = await jev.answer(question, { domain: wrong });

    const [jr, jg, jb] = await Promise.all([
      judge(question, routed.text), judge(question, general.text), judge(question, bad.text),
    ]);

    rows.push({ question, right, wrong, routed, general, bad, jr, jg, jb });

    console.log(`   ${question}`);
    console.log(`     routed  [${routed.domains.join('+')}]  judge=${jr.toFixed(2)}  ` +
      `domain%=${Math.round(domainShare(routed.tokens, routed.domain) * 100)}`);
    console.log(`       ${JSON.stringify(routed.text)}`);
    console.log(`     general          judge=${jg.toFixed(2)}`);
    console.log(`       ${JSON.stringify(general.text)}`);
    console.log(`     wrong [${wrong}]  judge=${jb.toFixed(2)}`);
    console.log(`       ${JSON.stringify(bad.text)}\n`);
  }

  const mean = (f) => rows.reduce((a, r) => a + f(r), 0) / rows.length;
  console.log(`   mean judge score  routed=${mean((r) => r.jr).toFixed(2)}  ` +
    `general=${mean((r) => r.jg).toFixed(2)}  wrong=${mean((r) => r.jb).toFixed(2)}   (0-2)`);
  const correct = rows.filter((r) => r.routed.domains.includes(r.right)).length;
  console.log(`   routed to the expected pack: ${correct}/${rows.length}\n`);
}

// ────────────────────────────────────────────────────────────── 3. coverage
if (want('coverage')) {
  console.log('3. COVERAGE — words each pack needs in order to answer its own questions\n');

  const NEEDED = {
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
    general: ['thing', 'people', 'reason', 'know', 'time'],
    ai: ['model', 'training', 'neural', 'prompt', 'accuracy'],
    database: ['query', 'table', 'index', 'join', 'transaction'],
    devops: ['deploy', 'server', 'container', 'pipeline', 'scale'],
    security: ['password', 'encrypt', 'vulnerability', 'attack', 'access'],
    networking: ['protocol', 'request', 'latency', 'packet', 'dns'],
    webdev: ['browser', 'page', 'css', 'render', 'button'],
    'data-analytics': ['metric', 'average', 'trend', 'report', 'sample'],
    twitter: ['tweet', 'reply', 'follower', 'viral', 'hashtag'],
  };

  let gaps = 0;
  for (const [domain, needed] of Object.entries(NEEDED)) {
    const have = new Set([...DOMAINS[domain].words, ...CORE]);
    const missing = needed.filter((w) => !have.has(w));
    if (missing.length) {
      gaps += missing.length;
      console.log(`   ${domain.padEnd(12)} MISSING: ${missing.join(', ')}`);
    }
  }
  console.log(gaps === 0
    ? '   all packs contain their expected answer words'
    : `\n   ${gaps} missing word(s) — a word absent from the pack can never be emitted`);
}
