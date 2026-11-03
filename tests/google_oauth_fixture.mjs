import {edgeFixture} from './edge_handler_fixture.mjs';

export const tick = () => new Promise(resolve => setImmediate(resolve));
export function manualTimers() {
  const timers = new Map();
  let id = 0;
  return {timers, setTimer(fn) { timers.set(++id, fn); return id; }, clearTimer(key) { timers.delete(key); },
    expire() { for (const fn of [...timers.values()]) fn(); }};
}
export async function oauthFixture(name, options = {}) {
  const writes = [], old = {refresh_token:'old-refresh', google_account_id:'old-account', scope:'https://www.googleapis.com/auth/drive.readonly'};
  const state = {owner_id:'test-owner', return_url:'https://app.example.test/', expires_at:new Date(Date.now() + 60000).toISOString()};
  const connection = {value:old};
  function database(table) {
    let mode = 'select', patch, expectedRefresh;
    const query = new Proxy({}, {get(_target, key) {
      if (key === 'then') return resolve => {
        if (mode !== 'select') writes.push({table, mode, patch});
        if (options.dbError?.(table, mode)) return resolve({data:null, error:{message:'test storage failure'}});
        const isState = table.endsWith('_states');
        if (!isState && expectedRefresh !== undefined && connection.value?.refresh_token !== expectedRefresh) return resolve({data:null, error:null});
        const previous = connection.value;
        if (!isState && mode === 'upsert') connection.value = {...patch};
        if (!isState && mode === 'update') connection.value = {...connection.value, ...patch};
        if (!isState && mode === 'delete') connection.value = null;
        return resolve({data:isState ? state : mode === 'delete' ? previous : connection.value, error:null});
      };
      return (...args) => {
        if (['insert','update','upsert','delete'].includes(key)) { mode = key; patch = args[0]; }
        if (key === 'eq' && args[0] === 'refresh_token') expectedRefresh = args[1];
        return query;
      };
    }});
    return query;
  }
  const clock = manualTimers();
  const f = await edgeFixture(name, {...options, database, httpPorts:clock});
  const invoke = action => f.handler(new Request('https://example.supabase.co/functions/v1/test', {
    method:'POST', headers:{Authorization:'Bearer test', 'Content-Type':'application/json'}, body:JSON.stringify({action}),
  }));
  const callback = () => f.handler(new Request('https://example.supabase.co/functions/v1/test/callback?state=test-state&code=test-code'));
  return {...f, invoke, callback, clock, writes, connection, old};
}
