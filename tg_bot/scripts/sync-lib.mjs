#!/usr/bin/env node
/**
 * Vendor the let-jev-speak modules into lib/.
 *
 * The platform resolves modules by bare name inside this project — a relative
 * import reaching out to ../../ will not compile — so the library has to live
 * here. The only edit is the import specifiers:
 *
 *   from './decoder.js'   ->   from 'lib/decoder'
 *
 * Because the copies are not byte-identical, drift is caught by re-running the
 * transform and comparing, not by hashing:
 *
 *   node scripts/sync-lib.mjs           # copy
 *   node scripts/sync-lib.mjs --check   # fail if lib/ is stale
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILES = ['typesafe.js', 'decoder.js', 'vocabs.js', 'LetJevSpeak.js'];

// Root filename -> the module name it takes inside the project.
const MODULE_NAME = {
  'typesafe.js': 'typesafe',
  'decoder.js': 'decoder',
  'vocabs.js': 'vocabs',
  'LetJevSpeak.js': 'letjevspeak',
};

const root = new URL('../../', import.meta.url);
const libDir = new URL('../lib/', import.meta.url);

const HEADER = (name) => `// VENDORED — do not edit. Generated from ../../${name} by
// scripts/sync-lib.mjs. Run \`npm run sync\` after changing the root library.
`;

function transform(source, name) {
  let out = source;
  for (const [file, module] of Object.entries(MODULE_NAME)) {
    // './decoder.js' -> 'lib/decoder', in both import and export-from clauses.
    out = out.replaceAll(`'./${file}'`, `'lib/${module}'`);
    out = out.replaceAll(`"./${file}"`, `'lib/${module}'`);
  }
  return HEADER(name) + out;
}

const check = process.argv.includes('--check');
let stale = 0;

for (const name of FILES) {
  const src = readFileSync(new URL(name, root), 'utf8');
  const want = transform(src, name);
  const dest = new URL(`${MODULE_NAME[name]}.js`, libDir);

  if (check) {
    const have = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
    if (have !== want) {
      console.error(`stale: lib/${MODULE_NAME[name]}.js differs from ../../${name}`);
      stale++;
    }
    continue;
  }

  writeFileSync(dest, want);
  console.log(`lib/${MODULE_NAME[name]}.js  <- ../../${name}`);
}

if (check) {
  if (stale) {
    console.error(`\n${stale} file(s) out of date. Run: npm run sync`);
    process.exit(1);
  }
  console.log('lib/ is in sync with the root library');
}

// A relative import that survived the transform would fail to compile in the
// cloud, so fail loudly here instead.
if (!check) {
  for (const name of FILES) {
    const dest = new URL(`${MODULE_NAME[name]}.js`, libDir);
    const text = readFileSync(dest, 'utf8');
    const bad = text.match(/from\s+['"]\.[^'"]*['"]/g);
    if (bad) {
      console.error(`\nlib/${MODULE_NAME[name]}.js still has relative imports: ${bad.join(', ')}`);
      process.exit(1);
    }
  }
  console.log('\nno relative imports remain');
}
