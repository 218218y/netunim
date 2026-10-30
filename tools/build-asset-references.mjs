// Audit fetched references after relocation; virtual import.meta URL bases are
// intentionally not fetched resources. Vendor JS remains integrity-pinned.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {walk} from './build-graph.mjs';
const {parse} = await import(process.env.NETUNIM_OFFLINE_NODE_MODULES
  ? pathToFileURL(path.join(process.env.NETUNIM_OFFLINE_NODE_MODULES, 'acorn/dist/acorn.mjs')).href : 'acorn');

export async function auditAssets(site) {
  site = path.resolve(site);
  const files = (await fs.readdir(site, {recursive: true, withFileTypes: true})).filter(item => item.isFile())
    .map(item => path.relative(site, path.join(item.parentPath, item.name)).split(path.sep).join('/'));
  const names = new Set(files), references = [];
  function requireFile(from, url, kind) {
    if (!url || url.protocol !== 'file:') throw Error(`Unsupported ${kind} reference in ${from}`);
    const relative = path.relative(site, fileURLToPath(url)).split(path.sep).join('/');
    if (!names.has(relative)) throw Error(`Missing ${kind} reference: ${from} -> ${relative}`);
    references.push({from, target: relative, kind});
  }
  function urlValue(node, base) {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
    if (node?.type === 'MemberExpression' && node.property.name === 'url' && node.object.type === 'MetaProperty') return base.href;
    if (node?.type === 'MemberExpression' && node.property.name === 'href') return urlValue(node.object, base);
    if (node?.type === 'NewExpression' && node.callee.name === 'URL') {
      const value = urlValue(node.arguments[0], base), parent = urlValue(node.arguments[1], base);
      if (value !== null && parent !== null) return new URL(value, parent).href;
    }
    return null;
  }
  for (const name of files) {
    const filename = path.join(site, name), base = pathToFileURL(filename);
    if (name.endsWith('.js') && !name.startsWith('assets/vendor/')) {
      const source = await fs.readFile(filename, 'utf8');
      walk(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}), node => {
        if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) && node.source) {
          const value = urlValue(node.source, base);
          requireFile(name, value === null ? null : new URL(value, base), 'module');
        }
        if (node.type === 'NewExpression' && node.callee.name === 'Worker') {
          const value = urlValue(node.arguments[0], base);
          requireFile(name, value === null ? null : new URL(value, base), 'worker');
        }
        if (node.type === 'CallExpression' && node.callee.name === 'importScripts') {
          for (const argument of node.arguments) {
            const value = urlValue(argument, base);
            requireFile(name, value === null ? null : new URL(value, base), 'classic-worker-script');
          }
        }
      });
    }
    if (name.endsWith('.css')) {
      const source = await fs.readFile(filename, 'utf8');
      for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) {
        const value = (match[1] ?? match[2] ?? match[3]).trim();
        if (!value || value.startsWith('#') || value.startsWith('data:')) continue;
        requireFile(name, new URL(value, base), 'css');
      }
      for (const match of source.matchAll(/@import\s+["']([^"']+)["']/g)) requireFile(name, new URL(match[1], base), 'css-import');
    }
    if (name.endsWith('.html')) {
      const source = await fs.readFile(filename, 'utf8');
      for (const match of source.matchAll(/(?:src|href)=["']([^"']*)["']/g)) {
        const value = match[1];
        if (!value || value.startsWith('#') || /^(?:https?:|mailto:|tel:|data:)/.test(value)) continue;
        requireFile(name, value.startsWith('/') ? new URL('.'+value, pathToFileURL(site+'/')) : new URL(value, base), 'html');
      }
    }
  }
  return {files: files.length, references};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await auditAssets(process.argv[2]);
  console.log(`PASS production asset closure: ${result.references.length} references across ${result.files} files`);
}
