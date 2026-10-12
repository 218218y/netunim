// @ts-check
/** @typedef {import('../../shared/authenticated-account-scope.js').AccountIdentity} AccountIdentity */
/** @typedef {{customerOpen:number,customerOpenCount:number,supplierDebt:number,supplierCredit:number,supplierNet:number}} OrdersFinanceSummary */
/** @typedef {{account:AccountIdentity,readable:boolean,online:boolean}} ReadAccess */
/** @typedef {{revision:number|string,updated_at?:string|null}} OrdersMeta */
/** @typedef {OrdersMeta & {state:unknown}} OrdersDocument */
/** @typedef {{assertCurrent:()=>void}} ReadGuard */
/** @typedef {{scope:AccountIdentity,revision:number,updatedAt:string|null,value:Readonly<OrdersFinanceSummary>}} SummaryCache */
/** @typedef {{generation:number,promise:Promise<boolean>}} ReadFlight */

// Read-only Orders projection. The cache, cooldown, flights and subscription
// belong to this owner; none are authority for Main or Shared journal writes.
/**
 * @param {{
 *   access:{current:()=>ReadAccess,subscribe:(listener:()=>void)=>()=>void},
 *   remote:{readMeta:(guard:ReadGuard)=>Promise<OrdersMeta|null>,readDocument:(guard:ReadGuard)=>Promise<OrdersDocument|null>},
 *   project:(state:unknown)=>OrdersFinanceSummary,
 *   onChange:(options:{renderIfChanged:boolean})=>void,
 *   onError:(error:unknown)=>void,
 *   clock:()=>number,
 * }} ports
 */
export function createDomainsDashboardController({access, remote, project, onChange, onError, clock}) {
  for (const method of [access?.current, access?.subscribe, remote?.readMeta, remote?.readDocument, project, onChange, onError, clock]) {
    if (typeof method !== 'function') throw new TypeError('dashboard_readout_ports_required');
  }
  /** @type {AccountIdentity|null} */
  let binding = null;
  /** @type {SummaryCache|null} */
  let cache = null;
  /** @type {(()=>void)|null} */
  let unsubscribe = null;
  let checkedAt = 0, generation = 0, active = false, disposed = false;
  /** @type {Map<string,ReadFlight>} */
  const flights = new Map();
  /** @type {Set<Promise<boolean>>} */
  const pending = new Set();
  /** @param {AccountIdentity|null} a @param {AccountIdentity} b */
  const same = (a, b) => a?.owner === b.owner && a.epoch === b.epoch;

  /** @param {AccountIdentity} scope */
  function observe(scope) {
    if (same(binding, scope)) return;
    binding = {...scope};
    checkedAt = 0;
    const hadCache = cache !== null;
    cache = null;
    if (hadCache) onChange({renderIfChanged:true});
  }
  function summary() {
    if (disposed || !active) return null;
    const live = access.current();
    observe(live.account);
    return live.readable && live.account.owner && cache && same(cache.scope, live.account) ? cache.value : null;
  }

  /** @param {{force?:boolean,renderIfChanged?:boolean}} [options] @returns {Promise<boolean>} */
  function refreshOrdersFinanceSummary({force=false, renderIfChanged=true}={}) {
    if (disposed || !active) return Promise.resolve(false);
    const live = access.current();
    observe(live.account);
    if (!live.readable || !live.online || !live.account.owner) return Promise.resolve(false);
    const captured = {...live.account}, epoch = generation, key = JSON.stringify([captured.owner, captured.epoch]);
    const existing = flights.get(key);
    if (existing?.generation === epoch) return existing.promise;
    const now = clock();
    if (!force && now - checkedAt < 10_000) return Promise.resolve(false);
    checkedAt = now;
    const current = () => {
      const next = access.current();
      return !disposed && active && generation === epoch && next.readable && next.online && same(captured, next.account);
    };
    const assertCurrent = () => { if (!current()) throw Object.assign(new Error('dashboard_read_scope_changed'), {code:'dashboard_read_scope_changed'}); };
    const tracked = Promise.resolve().then(async () => {
      assertCurrent();
      const meta = await remote.readMeta({assertCurrent});
      if (!current()) return false;
      const revision = Number(meta?.revision || 0);
      if (!revision) return false;
      if (!force && revision === cache?.revision && summary()) return false;
      const row = await remote.readDocument({assertCurrent});
      if (!current() || !row?.state) return false;
      const next = Object.freeze(project(row.state));
      const changed = revision !== cache?.revision || JSON.stringify(next) !== JSON.stringify(cache.value);
      // Projection is synchronous but remains a port; do not publish if it
      // synchronously changed the login or stopped this owner.
      if (!current()) return false;
      cache = {scope:captured, revision:Number(row.revision || revision), updatedAt:row.updated_at || meta?.updated_at || null, value:next};
      if (changed) onChange({renderIfChanged});
      return changed;
    }).catch(error => {
      if (current()) onError(error);
      return false;
    }).finally(() => {
      pending.delete(tracked);
      if (flights.get(key)?.promise === tracked) flights.delete(key);
    });
    flights.set(key, {generation:epoch, promise:tracked});
    pending.add(tracked);
    return tracked;
  }

  const runtime = {
    start() {
      if (disposed || active) return false;
      active = true;
      generation++;
      try { unsubscribe = access.subscribe(() => { if (active && !disposed) observe(access.current().account); }); }
      catch (error) { active = false; generation++; throw error; }
      return true;
    },
    stop() {
      if (!active) return false;
      active = false;
      generation++;
      const release = unsubscribe;
      unsubscribe = null;
      release?.();
      checkedAt = 0;
      return true;
    },
    async drain() { while (pending.size) await Promise.all([...pending]); },
    isPending:() => pending.size > 0,
    dispose() {
      if (disposed) return false;
      disposed = true;
      runtime.stop();
      cache = null;
      return true;
    },
  };
  return {summary, refreshOrdersFinanceSummary, runtime};
}
