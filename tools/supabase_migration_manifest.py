"""Generate/check reviewed local migration expectations, never server evidence."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


MIGRATION_NAME = re.compile(r'^(\d{14})_([a-z0-9_]+)\.sql$')


def split_sql_statements(source):
    """Reproduce CLI statement storage without normalizing any statement content.

    Only top-level delimiters and surrounding whitespace are removed. Quoted
    strings/identifiers, dollar bodies, comments and their internal whitespace
    remain byte-sensitive. Unsupported/unterminated syntax fails closed.
    """
    source = source.replace('\r\n', '\n')
    statements, words = [], []
    start = i = 0
    while i < len(source):
        if source.startswith('--', i):
            end = source.find('\n', i+2)
            i = len(source) if end < 0 else end+1
        elif source.startswith('/*', i):
            depth = 1
            i += 2
            while i < len(source) and depth:
                if source.startswith('/*', i): depth += 1; i += 2
                elif source.startswith('*/', i): depth -= 1; i += 2
                else: i += 1
            if depth: raise ValueError('unterminated SQL block comment')
        elif source[i] in ('\'','"'):
            quote = source[i]
            escape = quote == "'" and i > 0 and source[i-1] in 'eE' and (i < 2 or not (source[i-2].isalnum() or source[i-2] in '_$'))
            i += 1
            while i < len(source):
                if escape and source[i] == '\\': i += 2
                elif source[i] == quote:
                    if i+1 < len(source) and source[i+1] == quote: i += 2
                    else: i += 1; break
                else: i += 1
            else: raise ValueError('unterminated SQL quote')
        elif source[i] == '$' and (tag := re.match(r'\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$', source[i:])):
            delimiter = tag.group()
            end = source.find(delimiter, i+len(delimiter))
            if end < 0: raise ValueError('unterminated SQL dollar quote')
            i = end+len(delimiter)
        elif source[i].isalpha() or source[i] == '_':
            end = i+1
            while end < len(source) and (source[end].isalnum() or source[end] in '_$'): end += 1
            words.append(source[i:end].lower())
            if words[-2:] in (['begin','atomic'], ['from','stdin']):
                raise ValueError('SQL statement-storage verification does not support BEGIN ATOMIC or COPY FROM STDIN')
            if words[-1] == 'standard_conforming_strings':
                raise ValueError('SQL statement-storage verification requires standard string quoting')
            i = end
        elif source[i] == ';':
            statement = source[start:i].strip()
            if statement: statements.append(statement)
            i += 1
            start = i
            words = []
        else:
            i += 1
    tail = source[start:].strip()
    if tail: statements.append(tail)
    return statements


def verify_server_manifest(server, reviewed):
    """Return storage formats only after independently verifying every server hash.

    Historical MCP migrations stored the complete file. Supabase CLI records an
    ordered array of statements without the outer delimiters. Accept exactly
    these independently computed encodings, never server-provided expectations.
    """
    if len(server) != len(reviewed):
        raise ValueError('migration count differs from reviewed files')
    formats = []
    for actual, expected in zip(server, reviewed):
        if any(actual.get(k) != expected.get(k) for k in ('version', 'name')):
            raise ValueError('migration order/version/name differs from reviewed files')
        path = ROOT/'supabase/migrations'/(expected['version']+'_'+expected['name']+'.sql')
        source = path.read_bytes().replace(b'\r\n', b'\n').decode('utf8')
        file_hash = hashlib.sha256(source.encode('utf8')).hexdigest()
        if file_hash != expected['sha256']:
            raise ValueError('local migration file hash differs from reviewed manifest')
        if actual.get('sha256') == file_hash:
            storage = 'file-lf-v1'
        else:
            statements = split_sql_statements(source)
            statement_hash = hashlib.sha256('\n'.join(statements).encode('utf8')).hexdigest()
            if actual.get('sha256') != statement_hash:
                raise ValueError('server SQL differs from both reviewed file and CLI statements: '+path.name)
            storage = 'cli-statements-lf-v1'
        formats.append({'version': expected['version'], 'storage': storage, 'server_sha256': actual['sha256']})
    return formats


def manifest():
    rows = []
    seen_versions = set()
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        match = MIGRATION_NAME.fullmatch(path.name)
        if not match:
            raise SystemExit('FAIL: invalid migration filename: ' + path.name)
        version, name = match.groups()
        if version in seen_versions:
            raise SystemExit('FAIL: duplicate migration version: ' + version)
        seen_versions.add(version)
        rows.append({
            'version': version,
            'name': name,
            'sha256': hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
        })
    return rows


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    rows = manifest()
    targets = {'canonical-migrations.json': {'migrations': [{k: r[k] for k in ('version', 'name')} for r in rows]},
               'canonical-migration-manifest.json': rows}
    for filename, value in targets.items():
        path = ROOT / 'supabase' / filename
        if args.write:
            path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
        elif json.loads(path.read_text(encoding='utf8')) != value:
            raise SystemExit('FAIL: canonical migration expectations differ: ' + filename)
    print('PASS: canonical migration versions and SQL hashes match local files')
