import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { createHash } from 'node:crypto';

// Preserve the reviewed algorithms, including class methods and wire constants.
// Source locations, formatting and import/export routing have no semantic weight.
export function creditAdapterPolicyHashes(sources) {
  const policies = {},
    exports = [];
  for (const source of sources) {
    for (const row of parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
      if (row.type === 'ExportNamedDeclaration') {
        if (row.declaration) {
          const node = row.declaration;
          exports.push(
            ...(node.id ? [node.id.name] : node.declarations.map((item) => item.id.name))
          );
        } else exports.push(...row.specifiers.map((item) => item.exported.name));
      }
      const node = row.declaration || row;
      if (!['FunctionDeclaration', 'ClassDeclaration', 'VariableDeclaration'].includes(node.type))
        continue;
      const name = node.id?.name || node.declarations.map((item) => item.id.name).join(',');
      // The separately tested response-body acquisition fix deliberately changes this transport.
      if (name === 'postJson') continue;
      assert.ok(!Object.hasOwn(policies, name), `one canonical credit declaration: ${name}`);
      const stable = JSON.stringify(node, (key, value) =>
        ['start', 'end', 'raw'].includes(key) ? undefined : value
      );
      policies[name] = createHash('sha256').update(stable).digest('hex');
    }
  }
  return { policies, exports: [...new Set(exports)].sort() };
}
