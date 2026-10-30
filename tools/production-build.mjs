// Build only browser code. Source contracts and provider integrity checks remain
// separate gates; no Bridge or business persistence code is rewritten here.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {walk, graph} from './build-graph.mjs';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dependencies = process.env.NETUNIM_OFFLINE_NODE_MODULES || path.join(ROOT, 'node_modules');
const {parse} = await import(pathToFileURL(path.join(dependencies, 'acorn/dist/acorn.mjs')).href);
const esbuild = await import(pathToFileURL(path.join(dependencies, 'esbuild-wasm/lib/main.js')).href);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = bytes => bytes.toString('utf8').replace(/\r\n?/g, '\n');
const workers = ['assets/js/domains/documents/spreadsheet-preview-worker.js', 'assets/js/shared/document-text-search-worker.js'];

export function browserAssets(site) {
  return {name: 'netunim-browser-assets', setup(build) {
    build.onResolve({filter: /vendor\//}, args => {
      const resolved = path.resolve(args.resolveDir, args.path);
      const relative = path.relative(path.join(site, 'assets'), resolved).split(path.sep).join('/');
      if (!relative.startsWith('vendor/')) throw new Error('Unexpected vendor import');
      return {path: '../' + relative, external: true};
    });
    build.onLoad({filter: /\.js$/}, async args => {
      let source = text(await fs.readFile(args.path));
      const edits = [];
      // Bundling moves modules. Give import.meta.url its original virtual base,
      // relative to the emitted flat assets/build directory. This also supports
      // computed PDF CMap/font/WASM URLs and classic importScripts workers.
      const original = path.relative(path.join(site, 'assets'), args.path).split(path.sep).join('/');
      walk(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}), node => {
        if (node.type === 'MemberExpression' && node.object.type === 'MetaProperty' && node.object.meta.name === 'import' && node.property.name === 'url') {
          edits.push({start: node.start, end: node.end, value: `new URL(${JSON.stringify('../' + original)},import.meta.url).href`});
        }
      });
      for (const edit of edits.sort((a,b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
      return {contents: source, loader: 'js', resolveDir: path.dirname(args.path)};
    });
  }};
}

export async function buildApp(app) {
  if (!['orders', 'kupa'].includes(app)) throw new Error('Expected orders or kupa');
  for (const script of ['pdfjs-runtime.py', 'document-viewers-runtime.py']) {
    const checked = spawnSync('python', [path.join(ROOT, 'tools', script), 'check'], {stdio: 'inherit', cwd: ROOT});
    if (checked.status !== 0) throw new Error(`Vendor integrity failed: ${script}`);
  }
  const site = path.join(ROOT, `netunim-${app}/site`);
  const out = path.join(ROOT, 'dist', app);
  const privateDir = path.join(ROOT, '.work', 'production', app);
  // These are fixed, owned build directories, never caller-supplied paths.
  await fs.rm(out, {recursive: true, force: true});
  await fs.rm(privateDir, {recursive: true, force: true});
  await fs.mkdir(out, {recursive: true});
  await fs.mkdir(privateDir, {recursive: true});
  const write = async (name, bytes) => {
    await fs.mkdir(path.dirname(path.join(out, name)), {recursive: true});
    await fs.writeFile(path.join(out, name), bytes);
  };
  const result = await esbuild.build({
    absWorkingDir: site, entryPoints: {app: 'assets/app.js', reset: 'assets/js/shared/local-site-reset-page.js'},
    outdir: path.join(out, 'assets/build'), bundle: true, splitting: true,
    format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    // Conservative first migration: do not remove exports or declarations.
    treeShaking: false, sourcemap: 'external', sourcesContent: true, metafile: true,
    entryNames: '[name]-[hash]', chunkNames: 'chunk-[hash]', write: false,
    legalComments: 'eof', plugins: [browserAssets(site)],
  });
  for (const file of result.outputFiles) {
    const relative = path.relative(out, file.path);
    if (relative.endsWith('.map')) await fs.writeFile(path.join(privateDir, path.basename(relative)), file.contents);
    else await write(relative, file.contents);
  }
  const entries = {};
  for (const [name, row] of Object.entries(result.metafile.outputs)) {
    if (row.entryPoint) entries[row.entryPoint] = path.relative(out, path.resolve(site, name)).split(path.sep).join('/');
  }
  // Retain only actual runtime resources; HTML links are rebuilt explicitly.
  for (const item of await fs.readdir(site, {recursive: true, withFileTypes: true})) {
    if (!item.isFile()) continue;
    const relative = path.relative(site, path.join(item.parentPath, item.name)).split(path.sep).join('/');
    if (relative.endsWith('.map')) continue;
    if (relative.startsWith('assets/vendor/') || /\.(png|ico|webmanifest)$/.test(relative) || relative === 'supabase/config.js') {
      const bytes = await fs.readFile(path.join(site, relative));
      await write(relative, relative.startsWith('assets/vendor/') || /\.(png|ico)$/.test(relative) ? bytes : text(bytes));
    }
  }
  for (const worker of workers) {
    const source = text(await fs.readFile(path.join(site, worker)));
    const compiled = await esbuild.transform(source, {minify: true, target: 'es2022', legalComments: 'eof'});
    await write(worker, compiled.code);
  }
  for (const html of ['index.html', 'reset-local.html']) {
    let source = text(await fs.readFile(path.join(site, html)));
    const links = [...source.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^\"]+)"[^>]*>/g)];
    const css = await esbuild.build({absWorkingDir: site, stdin: {contents: links.map(match => `@import ${JSON.stringify(match[1])};`).join('\n'), resolveDir: site, loader: 'css'}, bundle: true, minify: true, write: false});
    const cssBytes = css.outputFiles[0].contents;
    const cssName = `assets/build/${html.replace('.html','')}-${hash(cssBytes).slice(0,16)}.css`;
    await write(cssName, cssBytes);
    source = source.replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^\"]+)"[^>]*>/g, '');
    source = source.replace('</head>', `<link rel="stylesheet" href="./${cssName}">\n</head>`);
    for (const [entry, output] of Object.entries(entries)) source = source.replace(`src="./${entry}"`, `src="./${output}"`);
    await write(html, source);
  }
  await write('_headers', text(await fs.readFile(path.join(site, '_headers'))));
  await write('service-worker.js', text(await fs.readFile(path.join(site, 'service-worker.js'))));
  await fs.writeFile(path.join(privateDir, 'modules.json'), JSON.stringify(await graph(site), null, 2) + '\n');
  await fs.writeFile(path.join(privateDir, 'metafile.json'), JSON.stringify(result.metafile, null, 2) + '\n');
  // Python owns the existing release hash/header/SW security contract.
  const finalized = spawnSync('python', [path.join(ROOT, 'tools/finalize-build.py'), app], {stdio: 'inherit', cwd: ROOT});
  if (finalized.status !== 0) throw new Error(`Build validation failed: ${app}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const app of process.argv.slice(2).length ? process.argv.slice(2) : ['orders', 'kupa']) await buildApp(app);
}
