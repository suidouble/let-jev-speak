import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = (dir) => readdirSync(new URL(`../${dir}/`, import.meta.url))
  .filter((f) => f.endsWith('.js'))
  .map((f) => [`${dir}/${f}`, readFileSync(new URL(`../${dir}/${f}`, import.meta.url), 'utf8')]);

const MODULES = [...files('lib'), ...files('handlers'), ...files('.').filter(([f]) => f === './schema.js')];

describe('vendored library', () => {
  test('lib/ is in sync with the root library', () => {
    // Fails the moment the root library changes without `npm run sync`.
    assert.doesNotThrow(() => execFileSync('node', ['scripts/sync-lib.mjs', '--check'], {
      cwd: new URL('..', import.meta.url),
      stdio: 'pipe',
    }));
  });
});

describe('platform compile traps', () => {
  // The cloud compiler rejects a module outright — with no line number — when
  // it sees either of these. Both cost real debugging time once.

  test('no raw control characters in source', () => {
    for (const [name] of MODULES) {
      const bytes = readFileSync(new URL(`../${name}`, import.meta.url));
      const bad = [...new Set(bytes)].filter((b) => (b < 9 || (b > 10 && b < 32) || b === 127));
      assert.deepEqual(bad, [], `${name} contains raw control bytes ${bad} — use \\uXXXX escapes`);
    }
  });

  test('no relative imports — the platform resolves bare module names only', () => {
    for (const [name, src] of MODULES) {
      const bad = src.match(/from\s+['"]\.[^'"]*['"]/g) ?? [];
      assert.deepEqual(bad, [], `${name} has relative imports: ${bad.join(', ')}`);
    }
  });

  test('no .js extension in module specifiers', () => {
    for (const [name, src] of MODULES) {
      const bad = (src.match(/from\s+['"][^'".][^'"]*\.js['"]/g) ?? []);
      assert.deepEqual(bad, [], `${name} imports with a .js extension: ${bad.join(', ')}`);
    }
  });

  test('top-level code does not touch absent globals', () => {
    // `process`, `setTimeout`, `AbortSignal`, `URL` and `Response` do not exist
    // in the isolate. Inside a function body a reference is fine (lib/compat
    // installs shims before any call); at module top level it fails to compile.
    const ABSENT = ['process', 'setTimeout', 'clearTimeout', 'AbortSignal', 'Response', 'URL'];

    for (const [name, rawSrc] of MODULES) {
      if (name === 'lib/compat.js') continue; // the shims themselves, all guarded

      // Blank out block comments, keeping line numbers intact — these files
      // discuss AbortSignal and process in prose.
      const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

      let depth = 0;
      src.split('\n').forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (depth === 0) {
          for (const g of ABSENT) {
            const re = new RegExp(`(^|[^.\\w'"\`])${g}\\s*[.(\\[]`);
            assert.ok(!re.test(code),
              `${name}:${i + 1} uses ${g} at top level — guard it or move it into a function`);
          }
        }
        depth += (code.match(/[{(]/g) ?? []).length - (code.match(/[})]/g) ?? []).length;
      });
    }
  });
});

describe('priors', () => {
  test('cover every domain the router can pick', async () => {
    const { PRIORS } = await import('../lib/priors.js');
    const vocabs = readFileSync(new URL('../lib/vocabs.js', import.meta.url), 'utf8');
    const keys = [...vocabs.matchAll(/^ {2}'?([\w-]+)'?: \{$/gm)].map((m) => m[1]);

    assert.ok(keys.length >= 20, `found only ${keys.length} domains`);
    for (const k of keys) {
      assert.ok(PRIORS[k], `no precomputed prior for "${k}" — run npm run priors`);
      assert.ok(Object.keys(PRIORS[k]).length > 0, `prior for "${k}" is empty`);
    }
  });
});
