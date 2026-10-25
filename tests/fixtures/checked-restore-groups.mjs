import {createRestoreGroup,assertRestoreGroup,createRestoreGroupStore,executeRestoreGroup} from '../../shared/restore-groups.js';
/** @type {Map<string,unknown>} */ const data=new Map();
const store=createRestoreGroupStore({localKey:'test.restore',put:async(key,value)=>{data.set(key,value)},get:async key=>data.get(key),remove:async key=>{data.delete(key)}});
const created=createRestoreGroup({appSite:'orders',main:{state:{notes:[]},baseRevision:1}});
created.then(group=>{
  /** @type {number} */ const revision=group.main.baseRevision;
  /** @type {number} */ const seq=group.mutationSeq;
  /** @type {Promise<import('../../shared/restore-group-contracts.js').StoredRestoreGroup>} */ const pending=store.stage(group);
  // @ts-expect-error A staged group is not a completed durable receipt.
  /** @type {import('../../shared/restore-group-contracts.js').StoredRestoreGroup} */ const early=pending;
  void [revision,seq,early];
});
const result=executeRestoreGroup({}, {store,stageRemote:async()=>{},applyRemote:async()=>({mainRevision:2,checksRevision:3}),onApplied:async(_group,receipt)=>{
  /** @type {number} */ const revision=receipt.mainRevision;
  // @ts-expect-error A parsed RPC revision is not display text.
  /** @type {string} */ const text=receipt.checksRevision;
  void [revision,text];
}});
/** @type {unknown} */ const raw=JSON.parse('{}');
const persisted=assertRestoreGroup(raw);
// @ts-expect-error The legacy guard validates coercibility, not normalized numbers.
/** @type {number} */ const rawRevision=persisted.main.baseRevision;
// @ts-expect-error An arbitrary phase cannot advance a durable restore.
store.advance(persisted,'saved');
// @ts-expect-error Server recovery scope requires a string owner.
store.loadServerPending(1);
// @ts-expect-error Constructor accepts only supported application sites.
createRestoreGroup({appSite:'other',main:{state:{}}});
void [result,rawRevision];
