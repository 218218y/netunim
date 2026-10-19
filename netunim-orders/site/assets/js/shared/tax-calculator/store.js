// @ts-check
import {createIndexedDbConnection} from '../indexed-db-connection.js';
/** @template D @typedef {import('./remote.js').TaxHead<D>} Head */
/** @template D @typedef {import('./remote.js').TaxFlight<D>} Flight */
/** @template D @typedef {{owner:string,name:string,version:number,base:Head<D>|null,draft:D,flight:Flight<D>|null,restoreRevision?:number|null}} TaxRecord */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

/** One owner-scoped journal, shared by tabs on this origin. Cloud joins origins. */
/** @template D @param {{indexedDB?:IDBFactory,decodeState:(name:string,raw:unknown)=>D}} ports */
export function createTaxStore({indexedDB=globalThis.indexedDB,decodeState}) {
  /** @param {string} owner @param {string} name @param {unknown} record @returns {TaxRecord<D>} */
  function decodeRecord(owner,name,record){
    if(!object(record)||record.owner!==owner||record.name!==name||typeof record.version!=='number'||!Number.isSafeInteger(record.version)||record.version<0)throw new Error('רשומת השמירה המקומית אינה תקינה');
    /** @type {Head<D>|null} */let base=null;
    if(record.base!==null){
      const h=record.base;if(!object(h)||typeof h.revision!=='number'||!Number.isSafeInteger(h.revision)||h.revision<1)throw new Error('גרסת הבסיס המקומית אינה תקינה');
      base={revision:h.revision,state:decodeState(name,h.state)};
    }
    /** @type {Flight<D>|null} */let flight=null;
    if(record.flight!==null){
      const f=record.flight;
      if(!object(f)||typeof f.id!=='string'||!f.id||typeof f.expectedRevision!=='number'||!Number.isSafeInteger(f.expectedRevision)||f.expectedRevision<0||f.expectedRevision!==(base?.revision??0))throw new Error('הפעולה המקומית הממתינה אינה תקינה');
      if(f.restoreRevision!=null&&(typeof f.restoreRevision!=='number'||!Number.isSafeInteger(f.restoreRevision)||f.restoreRevision<1))throw new Error('גרסת השחזור אינה תקינה');
      flight={id:f.id,expectedRevision:f.expectedRevision,state:decodeState(name,f.state),restoreRevision:typeof f.restoreRevision==='number'?f.restoreRevision:null};
    }
    if(record.restoreRevision!=null&&(typeof record.restoreRevision!=='number'||!Number.isSafeInteger(record.restoreRevision)||record.restoreRevision<1))throw new Error('כוונת השחזור אינה תקינה');
    return {owner,name,version:record.version,base,draft:decodeState(name,record.draft),flight,restoreRevision:typeof record.restoreRevision==='number'?record.restoreRevision:null};
  }
  const connection=createIndexedDbConnection('netunim-tax-calculator-v1',1,
    db=>{if(!db.objectStoreNames.contains('documents'))db.createObjectStore('documents');},{indexedDB});
  /** @param {string} owner @param {string} name @param {((current:TaxRecord<D>|null)=>TaxRecord<D>)} [change] @returns {Promise<TaxRecord<D>|null>} */
  async function transaction(owner,name,change) {
    const db=await connection();
    if(!db)throw new Error('לא ניתן לפתוח שמירה מקומית עמידה');
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('documents',change?'readwrite':'readonly'),store=tx.objectStore('documents'),key=`${owner}/${name}`;
      /** @type {TaxRecord<D>|null} */let result=null;
      /** @type {unknown} */let failure;
      const request=store.get(key);
      request.onsuccess=()=>{try{
        /** @type {unknown} */const raw=request.result;
        const existing=raw==null?null:decodeRecord(owner,name,raw);
        result=change?decodeRecord(owner,name,change(structuredClone(existing))):existing;
        if(change)store.put(structuredClone(result),key);
      }catch(error){failure=error;tx.abort();}};
      tx.oncomplete=()=>resolve(structuredClone(result));
      tx.onabort=()=>reject(failure??tx.error??new Error('השמירה המקומית בוטלה'));
      tx.onerror=()=>{failure??=tx.error};
    });
  }
  return {
    /** @param {string} owner @param {string} name */
    read:(owner,name)=>transaction(owner,name),
    /** @param {string} owner @param {string} name @param {(current:TaxRecord<D>|null)=>TaxRecord<D>} change */
    update:async(owner,name,change)=>{const record=await transaction(owner,name,change);if(!record)throw new Error('לא התקבלה קבלה מקומית');return record;},
    close:async()=>connection.invalidate(await connection())};
}
