import { parse, tokenizer } from 'acorn';

// Reviewed wire change: optional progress frames on the existing refresh
// requests. Legacy JSON and the fallback boundary are exercised over HTTP.
export const bankBridgeProgressClientHash='017dc8c7f0a892991c4c7a9aa825b387f96f20342bf37c6b515a0c797e6c4a69';

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

// Ignore the additive, read-only progress observer when comparing finance policy
// against historical ASTs. Provider arguments and authority checks stay in scope.
export function omitFinanceProgress(source) {
  const observations=/onProgress\?\.\('(provider|process|save)'\);|,\.\.\.\(onProgress&&\{onProgress:detail=>\{assertCurrent(?:\?\.)?\(\);onProgress\('provider',detail\);?\}\}\)|,\.\.\.\(onProgress&&\{onProgress\}\)/g;
  const parts=[];
  let cursor=0;
  for(const match of source.matchAll(observations)){
    parts.push(source.slice(cursor,match.index));
    cursor=match.index+match[0].length;
  }
  parts.push(source.slice(cursor));
  return parts.join('');
}
