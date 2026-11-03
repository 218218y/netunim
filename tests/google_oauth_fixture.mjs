import {edgeFixture} from './edge_handler_fixture.mjs';
import {createHash} from 'node:crypto';

export const GOOGLE_TEST_SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';

export const tick = () => new Promise(resolve => setImmediate(resolve));
export function manualTimers() {
  const timers = new Map();
  let id = 0;
  return {timers, setTimer(fn) { timers.set(++id, fn); return id; }, clearTimer(key) { timers.delete(key); },
    expire() { for (const fn of [...timers.values()]) fn(); }};
}
export async function oauthFixture(name, options = {}) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  const writes = [], old = {refresh_token:'old-refresh', google_account_id:'old-account', scope:GOOGLE_TEST_SCOPES};
  const state = {value:{state_hash:hash('test-state'), owner_id:'test-owner', return_url:'https://app.example.test/', expires_at:new Date(Date.now() + 60000).toISOString()}};
  const intent = {value:hash('test-state')};
  const connection = {value:old};
  function database(table) {
    let mode = 'select', patch, expectedRefresh, expectedHash;
    const query = new Proxy({}, {get(_target, key) {
      if (key === 'then') return async resolve => {
        const selectedState = table.endsWith('_states') && mode === 'select' ? state.value : undefined;
        await options.beforeQuery?.(table, mode);
        if (mode !== 'select') writes.push({table, mode, patch});
        if (options.dbError?.(table, mode)) return resolve({data:null, error:{message:'test storage failure'}});
        const isState = table.endsWith('_states');
        if (isState) {
          const previous = mode === 'select' ? selectedState : state.value;
          if (expectedHash !== undefined && previous?.state_hash !== expectedHash) return resolve({data:null, error:null});
          if (mode === 'delete') state.value = null;
          return resolve({data:previous, error:null});
        }
        if (!isState && expectedRefresh !== undefined && connection.value?.refresh_token !== expectedRefresh) return resolve({data:null, error:null});
        const previous = connection.value;
        if (!isState && mode === 'upsert') connection.value = {...patch};
        if (!isState && mode === 'update') connection.value = {...connection.value, ...patch};
        if (!isState && mode === 'delete') connection.value = null;
        return resolve({data:mode === 'delete' ? previous : connection.value, error:null});
      };
      return (...args) => {
        if (['insert','update','upsert','delete'].includes(key)) { mode = key; patch = args[0]; }
        if (key === 'eq' && args[0] === 'refresh_token') expectedRefresh = args[1];
        if (key === 'eq' && args[0] === 'state_hash') expectedHash = args[1];
        return query;
      };
    }});
    return query;
  }
  async function rpc(fn, args) {
    const table = name.replaceAll('-', '_').replace('_oauth', '') + '_connections';
    const mode = fn.endsWith('_publish') ? 'upsert' : fn.endsWith('_disconnect') ? 'delete' : 'insert';
    await options.beforeQuery?.(table, mode);
    if (options.dbError?.(table, mode)) return {data:null, error:{message:'test storage failure'}};
    if (fn.endsWith('_start')) {
      intent.value = args.p_state_hash;
      state.value = {state_hash:args.p_state_hash, owner_id:args.p_owner_id, return_url:args.p_return_url, expires_at:args.p_expires_at};
      return {data:null, error:null};
    }
    if (fn.endsWith('_disconnect')) {
      intent.value = null;
      const token = connection.value?.refresh_token || '';
      connection.value = null;
      writes.push({table, mode});
      return {data:token, error:null};
    }
    if (intent.value !== args.p_state_hash) return {data:false, error:null};
    intent.value = null;
    connection.value = {owner_id:args.p_owner_id, google_account_id:args.p_account_id, refresh_token:args.p_refresh_token, scope:args.p_scope};
    writes.push({table, mode});
    return {data:true, error:null};
  }
  const clock = manualTimers();
  const f = await edgeFixture(name, {...options, database, rpc, httpPorts:clock});
  const invoke = action => f.handler(new Request('https://example.supabase.co/functions/v1/test', {
    method:'POST', headers:{Authorization:'Bearer test', Origin:'https://app.example.test', 'Content-Type':'application/json'}, body:JSON.stringify({action, return_url:'https://app.example.test/'}),
  }));
  const callback = (rawState = 'test-state') => f.handler(new Request('https://example.supabase.co/functions/v1/test/callback?state='+rawState+'&code=test-code'));
  return {...f, invoke, callback, clock, writes, connection, state, intent, old};
}
