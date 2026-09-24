"""Observe business V1 writes before production startup in a disposable browser."""

BUSINESS_V1_WRITE_GUARD = r"""
  (()=>{
    const keys=new Set([
      'orders.management.state.v1','orders.supabase.base.v1','orders.supabase.pending.v1',
      'orders.shared.checks.base.v1','orders.shared.checks.bank-events.v1','orders.shared.checks.pending.v1',
      'orders.kupa.checks.base.v1','orders.kupa.checks.pending.v1',
      'kupa.browser.state.v1','kupa.cloud.pending.local.v1',
      'kupa.shared.checks.base.v1','kupa.shared.checks.bank-events.v1','kupa.shared.checks.pending.v1'
    ]);
    const idbKeys=new Set(['orders-outbox-v3','browser-state-v1','cloud-pending-v2','cloud-pending-v3','shared-checks-outbox-v3']);
    window.__legacyWrites=[];
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(keys.has(String(key))){window.__legacyWrites.push('localStorage:'+key);throw Error('legacy business write: '+key)}
      return set.call(this,key,value)
    };
    const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,key){
      if(this.name==='snapshots'&&key==='main'||this.name==='sync'&&idbKeys.has(String(key))){window.__legacyWrites.push('IndexedDB:'+this.name+':'+key);throw Error('legacy business write: '+key)}
      return put.call(this,value,key)
    };
  })();
"""


def install_business_v1_write_guard(browser):
    browser.call('Page.addScriptToEvaluateOnNewDocument', {'source': BUSINESS_V1_WRITE_GUARD})
