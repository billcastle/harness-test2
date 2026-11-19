// Assembles .vercel/output (Vercel Build Output API v3): the static web app plus one Node function for /api.
// Run from the repo root after `npm ci` in web/ and server/:  node deploy/build-vercel.mjs
import { build } from '../server/node_modules/esbuild/lib/main.js';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '.vercel', 'output');
const fn = path.join(out, 'functions', 'api.func');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });

execFileSync('npm', ['run', 'build'], { cwd: path.join(root, 'web'), stdio: 'inherit' });
fs.cpSync(path.join(root, 'web', 'dist'), path.join(out, 'static'), { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // pdfjs-dist ships its own worker/font files and is loaded from node_modules at run time
  external: ['pdfjs-dist', 'pdfjs-dist/*'],
  // some CJS dependencies (pg) call require() at run time
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
};
await build({ ...common, entryPoints: [path.join(root, 'server/src/vercel.ts')], outfile: path.join(fn, 'index.mjs') });
await build({ ...common, entryPoints: [path.join(root, 'server/src/import/worker.ts')], outfile: path.join(fn, 'import-worker.mjs') });

fs.cpSync(path.join(root, 'server', 'db', 'migrations'), path.join(fn, 'migrations'), { recursive: true });
fs.cpSync(path.join(root, 'server', 'node_modules', 'pdfjs-dist'), path.join(fn, 'node_modules', 'pdfjs-dist'), { recursive: true });
fs.writeFileSync(path.join(fn, 'package.json'), '{"type":"module"}\n');
fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30, environment: { MIGRATIONS_DIR: './migrations' } }, null, 2),
);

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '/api/(.*)', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log('built', out);
