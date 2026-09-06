"""Render the reviewed catalog snapshot into a schema-only baseline.

Requires a filename already created by `supabase migration new`. Does not choose
versions, connect to a database, copy rows, set sequence values, or repair history.
Unsupported object kinds abort instead of being silently omitted.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ident(value):
    return '"' + value.replace('"', '""') + '"'


def name(row, field='name'):
    return ident(row['schema']) + '.' + ident(row[field])


PRIVILEGES = dict(r='SELECT', w='UPDATE', a='INSERT', d='DELETE', D='TRUNCATE',
                  x='REFERENCES', t='TRIGGER', m='MAINTAIN', X='EXECUTE', U='USAGE', C='CREATE')


def grants(acl, target, owner, default=''):
    if acl is None:
        return []  # PostgreSQL's default ACL, retained as such.
    entries = [entry.split('=', 1) for entry in acl.strip('{}').split(',') if entry]
    roles = sorted({'PUBLIC', 'anon', 'authenticated', 'service_role', owner} | {r or 'PUBLIC' for r, _ in entries})
    role_sql = lambda r: 'PUBLIC' if r == 'PUBLIC' else ident(r)
    result = [default + 'REVOKE ALL ON ' + target + ' FROM ' + ', '.join(map(role_sql, roles)) + ';']
    for role, raw in entries:
        privileges, _grantor = raw.split('/')
        assert '*' not in privileges, 'grant options require explicit implementation'
        if privileges:
            result.append(default + 'GRANT ' + ', '.join(PRIVILEGES[p] for p in privileges) + ' ON ' + target + ' TO ' + role_sql(role or 'PUBLIC') + ';')
    return result


def render(inv):
    assert not inv['types'], 'custom enums/domains need a reviewed renderer'
    lines = ['-- GENERATED from audit/production-schema.json; review before use.',
             '-- Fresh install only. Existing Production: repair history AFTER review; never replay this DDL.',
             '-- No business data or sequence current values are included.',
             'BEGIN;', 'SET LOCAL check_function_bodies = false;',
             'CREATE SCHEMA IF NOT EXISTS extensions;',
             'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;']
    for s in inv['schemas']:
        lines += ['CREATE SCHEMA IF NOT EXISTS ' + ident(s['name']) + ';',
                  'ALTER SCHEMA ' + ident(s['name']) + ' OWNER TO ' + ident(s['owner']) + ';']
    for s in inv['sequences']:
        if not s['owned_by']:
            lines.append('CREATE SEQUENCE ' + name(s) + ' AS ' + s['type'] + ';')
    for table in inv['tables']:
        assert table['kind'] == 'r' and not table['options'], 'unsupported relation kind/options'
        cols = []
        for c in inv['columns']:
            if (c['schema'], c['table']) != (table['schema'], table['name']):
                continue
            assert not c['generated'] and not c['collation'] and not c['acl'], 'unsupported column metadata'
            definition = ident(c['name']) + ' ' + c['type']
            if c['identity']:
                definition += ' GENERATED ' + ('ALWAYS' if c['identity'] == 'a' else 'BY DEFAULT') + ' AS IDENTITY'
            if c['default'] is not None:
                definition += ' DEFAULT ' + c['default']
            if c['not_null']:
                definition += ' NOT NULL'
            cols.append(definition)
        lines.append('CREATE TABLE ' + name(table) + ' (\n  ' + ',\n  '.join(cols) + '\n);')
        lines.append('ALTER TABLE ' + name(table) + ' OWNER TO ' + ident(table['owner']) + ';')
    for f in inv['functions']:
        lines.append(f['definition'].replace('\r\n', '\n').rstrip() + ';')
        lines.append('ALTER FUNCTION ' + name(f) + '(' + f['identity'] + ') OWNER TO ' + ident(f['owner']) + ';')
    # Referenced unique constraints precede foreign keys.
    for c in sorted(inv['constraints'], key=lambda c: c['type'] == 'f'):
        lines.append('ALTER TABLE ' + name(c, 'table') + ' ADD CONSTRAINT ' + ident(c['name']) + ' ' + c['definition'] + ';')
    for i in inv['indexes']:
        assert i['valid'], 'invalid index must be reviewed'
        if not i['constraint']:
            lines.append(i['definition'] + ';')
    for s in inv['sequences']:
        lines.append('ALTER SEQUENCE ' + name(s) + ' INCREMENT BY ' + str(s['increment']) + ' MINVALUE ' + str(s['min']) + ' MAXVALUE ' + str(s['max']) + ' START WITH ' + str(s['start']) + ' CACHE ' + str(s['cache']) + (' CYCLE' if s['cycle'] else ' NO CYCLE') + ';')
        lines += grants(s['acl'], 'SEQUENCE ' + name(s), s['owner'])
    for t in inv['triggers']:
        lines.append(t['definition'] + ';')
        mode = {'O': 'ENABLE', 'D': 'DISABLE', 'R': 'ENABLE REPLICA', 'A': 'ENABLE ALWAYS'}[t['enabled']]
        lines.append('ALTER TABLE ' + name(t, 'table') + ' ' + mode + ' TRIGGER ' + ident(t['name']) + ';')
    for t in inv['tables']:
        lines.append('ALTER TABLE ' + name(t) + (' ENABLE' if t['rls'] else ' DISABLE') + ' ROW LEVEL SECURITY;')
        if t['force_rls']:
            lines.append('ALTER TABLE ' + name(t) + ' FORCE ROW LEVEL SECURITY;')
        lines += grants(t['acl'], 'TABLE ' + name(t), t['owner'])
    for p in inv['policies']:
        command = 'CREATE POLICY ' + ident(p['name']) + ' ON ' + name(p, 'table') + ' AS ' + p['permissive'] + ' FOR ' + p['command'] + ' TO ' + ', '.join('PUBLIC' if r == 'public' else ident(r) for r in p['roles'])
        if p['using']:
            command += ' USING (' + p['using'] + ')'
        if p['check']:
            command += ' WITH CHECK (' + p['check'] + ')'
        lines.append(command + ';')
    for f in inv['functions']:
        lines += grants(f['acl'], 'FUNCTION ' + name(f) + '(' + f['identity'] + ')', f['owner'])
    for s in inv['schemas']:
        lines += grants(s['acl'], 'SCHEMA ' + ident(s['name']), s['owner'])
    for d in inv['default_privileges']:
        prefix = 'ALTER DEFAULT PRIVILEGES FOR ROLE ' + ident(d['owner']) + (' IN SCHEMA ' + ident(d['schema']) if d['schema'] else '') + ' '
        lines += grants(d['acl'], {'r': 'TABLES', 'S': 'SEQUENCES', 'f': 'FUNCTIONS'}[d['type']], d['owner'], prefix)
    for e in inv['event_triggers']:
        tags = ' WHEN TAG IN (' + ', '.join("'" + tag.replace("'", "''") + "'" for tag in e['tags']) + ')' if e['tags'] else ''
        create = 'CREATE EVENT TRIGGER ' + ident(e['name']) + ' ON ' + e['event'] + tags + ' EXECUTE FUNCTION ' + name(e, 'function') + '();'
        # A fresh Supabase installation can already provide the RLS event hook.
        # Retain it; the strict postflight still rejects a different event/tag target.
        lines.append("DO $baseline$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname='" + e['name'].replace("'", "''") + "') THEN " + create + ' END IF; END $baseline$;')
        lines.append('ALTER EVENT TRIGGER ' + ident(e['name']) + ' OWNER TO ' + ident(e['owner']) + ';')
        mode = {'O': 'ENABLE', 'D': 'DISABLE', 'R': 'ENABLE REPLICA', 'A': 'ENABLE ALWAYS'}[e['enabled']]
        lines.append('ALTER EVENT TRIGGER ' + ident(e['name']) + ' ' + mode + ';')
    lines += ['COMMIT;', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('migration', type=Path)
    args = parser.parse_args()
    path = args.migration.resolve()
    if path.parent != ROOT / 'supabase/migrations' or not path.is_file():
        parser.error('pass the existing path returned by supabase migration new')
    path.write_text(render(json.loads((ROOT / 'supabase/audit/production-schema.json').read_text(encoding='utf8'))), encoding='utf8', newline='\n')
