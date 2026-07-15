import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/worker-entry.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'dist/_worker.bundle.js',
});

await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  globalName: 'DrawingCheckerApp',
  outfile: 'dist/_app.bundle.js',
});

// dictionary-en loads its files via Node fs/__dirname, which can't be
// bundled for the browser. Read the two text files here at build time and
// inline them as a plain string constant instead of bundling the package.
const dictAff = readFileSync('node_modules/dictionary-en/index.aff', 'utf8');
const dictDic = readFileSync('node_modules/dictionary-en/index.dic', 'utf8');
const dictionaryInjection = `self.__DICTIONARY__ = ${JSON.stringify({ aff: dictAff, dic: dictDic })};\n`;

const workerCode = dictionaryInjection + readFileSync('dist/_worker.bundle.js', 'utf8');
// app bundle exposes initApp as DrawingCheckerApp.initApp; expose it as a
// plain top-level name the template's inline script can call directly.
const appCode = readFileSync('dist/_app.bundle.js', 'utf8') + '\nconst initApp = DrawingCheckerApp.initApp;';
const template = readFileSync('index.template.html', 'utf8');

// Use function replacers (not string replacements) so that literal `$&`,
// `$1`, etc. sequences inside the bundled code (e.g. util.js's escapeRegex
// using '\\$&' as a String.replace replacement) are not reinterpreted by
// String.prototype.replace's special replacement-pattern syntax.
const html = template
  .replace('/*__WORKER_CODE__*/', () => JSON.stringify(workerCode))
  .replace('/*__APP_CODE__*/', () => appCode);

writeFileSync('dist/drawing-checker.html', html);
console.log('Built dist/drawing-checker.html');

await build({
  entryPoints: ['src/hy8/ui/app.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  globalName: 'Hy8ImporterApp',
  outfile: 'dist/_hy8-app.bundle.js',
});

const hy8AppCode = readFileSync('dist/_hy8-app.bundle.js', 'utf8') + '\nconst initHy8ImporterApp = Hy8ImporterApp.initApp;';
const hy8Template = readFileSync('hy8-importer.template.html', 'utf8');
const hy8Html = hy8Template.replace('/*__APP_CODE__*/', () => hy8AppCode);

writeFileSync('dist/hy8-importer.html', hy8Html);
console.log('Built dist/hy8-importer.html');
