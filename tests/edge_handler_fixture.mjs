import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';

// Run the production entrypoint and its real local imports; only external ports
// (Supabase, Google and the Deno server) are replaced with isolated test ports.
export async function edgeFixture(name, options = {}) {
  const file = new URL(`../netunim-orders/supabase/functions/${name}/index.ts`, import.meta.url);
  const source = options.source ?? readFileSync(file, 'utf8');
  const imports = {};
  for (const match of source.matchAll(/^import \{([^}]+)\} from '(\.[^']+)';/gm)) {
    const module = await import(new URL(match[2], file));
    for (const key of match[1].split(',').map(value => value.trim())) imports[key] = module[key];
  }
  const operations = [], requests = [];
  const fetchRequest = async (...args) => { requests.push(args); return options.fetch?.(...args) ?? Response.json({}); };
  if (imports.createGoogleHttp) {
    const create = imports.createGoogleHttp;
    imports.createGoogleHttp = () => create({fetchRequest, ...options.httpPorts});
  }
  let handler;
  const database = options.database || (() => new Proxy({}, {get(_target, key) {
    if (key === 'then') return resolve => resolve({data:null, error:null});
    return (...args) => { operations.push({key, args}); return database(); };
  }}));
  const context = vm.createContext({...imports, console:{error() {}}, Response, Request, URL, URLSearchParams,
    AbortController, TextEncoder, TextDecoder, crypto:globalThis.crypto, atob,
    setTimeout:options.timers?.setTimer ?? setTimeout, clearTimeout:options.timers?.clearTimer ?? clearTimeout,
    fetch:fetchRequest,
    createClient:() => ({from:database, rpc:options.rpc, auth:{getUser:async () => ({data:{user:options.user === null ? null : options.user || {id:'test-owner'}}})}}),
    Deno:{env:{get:key => ({SUPABASE_URL:'https://example.supabase.co', SUPABASE_ANON_KEY:'test', SUPABASE_SERVICE_ROLE_KEY:'test',
      GOOGLE_DRIVE_CLIENT_SECRET:'test', GOOGLE_CALENDAR_CLIENT_SECRET:'test', MORNING_ENV:'sandbox', ...options.env})[key]}, serve:value => { handler = value; }}});
  vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*?;\r?\n/gm, '')), context);
  return {handler, context, operations, requests};
}
