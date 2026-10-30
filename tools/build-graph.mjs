import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dependencies = process.env.NETUNIM_OFFLINE_NODE_MODULES || new URL('../node_modules/', import.meta.url).pathname;
const {parse} = await import(process.env.NETUNIM_OFFLINE_NODE_MODULES
  ? pathToFileURL(path.join(dependencies, 'acorn/dist/acorn.mjs')).href : 'acorn');

export function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

export async function graph(site, entry = 'assets/app.js') {
  const modules = {};
  async function inspect(relative) {
    if (modules[relative] || relative.startsWith('assets/vendor/')) return;
    const source = (await fs.readFile(path.join(site, relative), 'utf8')).replace(/\r\n?/g, '\n');
    const row = modules[relative] = {bytes: Buffer.byteLength(source), static: [], dynamic: []};
    walk(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}), node => {
      const dynamic = node.type === 'ImportExpression';
      const specifier = dynamic ? node.source : ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) ? node.source : null;
      if (!specifier) return;
      if (specifier.type !== 'Literal' || typeof specifier.value !== 'string') throw new Error(`Unresolved import: ${relative}`);
      if (!specifier.value.startsWith('.')) throw new Error(`Nonlocal import: ${relative}: ${specifier.value}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier.value));
      if (target.startsWith('../')) throw new Error(`Import escapes site: ${relative}`);
      row[dynamic ? 'dynamic' : 'static'].push(target);
    });
    for (const target of [...row.static, ...row.dynamic]) await inspect(target);
  }
  await inspect(entry);
  function closure(start) {
    const seen = new Set();
    function visit(name) {
      if (seen.has(name) || !modules[name]) return;
      seen.add(name);
      modules[name].static.forEach(visit);
    }
    visit(start);
    return [...seen].sort();
  }
  const main = closure('assets/js/main.js');
  return {entry, modules, mainStatic: main, mainBytes: main.reduce((sum, name) => sum + modules[name].bytes, 0)};
}
