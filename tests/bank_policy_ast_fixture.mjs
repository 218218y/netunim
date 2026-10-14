import { parse, tokenizer } from 'acorn';
export function declaration(source, name) {
  const queue = [parse(source, { ecmaVersion: 'latest', sourceType: 'module' })];
  while (queue.length) {
    const node = queue.shift();
    if (node.type === 'FunctionDeclaration' && node.id.name === name) return node;
    for (const value of Object.values(node))
      if (value && typeof value === 'object')
        queue.push(
          ...(Array.isArray(value)
            ? value.filter((item) => item && typeof item === 'object')
            : [value])
        );
  }
  throw Error('missing production declaration ' + name);
}

export function tokens(source) {
  const parser = tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let out = '',
    previous = '';
  const parts = [];
  for (let token = parser.getToken(); token.type.label !== 'eof'; token = parser.getToken())
    parts.push(source.slice(token.start, token.end));
  for (const [index, next] of parts.entries()) {
    if (next === ',' && ['}', ']', ')'].includes(parts[index + 1])) continue;
    // Preserve strings and template text exactly; only insignificant lexical
    // whitespace is removed so the older explicit delta normalizer still works.
    const space =
      (/[\w$]$/.test(previous) && /^[\w$]/.test(next)) || (previous === 'const' && next === '{');
    out += (space ? ' ' : '') + next;
    previous = next;
  }
  return out;
}
