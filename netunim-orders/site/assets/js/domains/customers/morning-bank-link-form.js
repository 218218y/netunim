// @ts-check
/** @typedef {{kind:string,bankTransactionId?:number,bankTransaction?:unknown,linkedFrom?:string,[key:string]:unknown}} BankSource */
/** @typedef {{source:BankSource,customerName:string,amount:number,date:string,description:string,payment:unknown}} BankPrefill */
/** @typedef {{type:number,clientName:string,amount:string,date:string,description:string,payments:unknown[]}} BankFormSnapshot */
/** @typedef {{source:()=>BankSource,capture:()=>BankFormSnapshot,link:(prefill:BankPrefill,row:unknown,origin:BankSource,snapshot:BankFormSnapshot)=>undefined,clear:(origin:BankSource,snapshot:BankFormSnapshot|null)=>undefined}} BankLinkForm */
/** @param {unknown} value @param {number} max */
function clean(value,max=250){return String(value??'').trim().slice(0,max)}
/** @param {string} base @param {string} bank */
function combineDescription(base,bank){const left=clean(base,250),right=clean(bank,250);if(!left)return right;if(!right||left.toLocaleLowerCase('he').includes(right.toLocaleLowerCase('he')))return left;return clean(`${left} · ${right}`,250)}
/** @param {{
 * source:{read:()=>BankSource,set:(value:BankSource)=>undefined},
 * fields:{get:(id:string)=>{value:string}|null,query:(selector:string)=>Pick<HTMLInputElement,'checked'|'disabled'|'closest'>|null,date:(value:string)=>undefined},
 * payments:{read:()=>unknown[],replace:(rows:unknown)=>unknown,sync:()=>undefined},
 * document:{type:()=>number,sync:()=>undefined}
 * }} ports @returns {BankLinkForm} */
export function createMorningBankLinkForm({source,fields,payments,document}){
  /** @param {string} id */
  function value(id){return fields.get(id)?.value??''}
  /** @param {string} id @param {unknown} next */
  function set(id,next){const field=fields.get(id);if(field)field.value=String(next??'')}
  /** @param {number} type */
  function setType(type){const radio=fields.query(`input[name="morningDocumentType"][value="${Number(type)}"]`);if(radio)radio.checked=true}
  /** @param {boolean} linked */
  function restrictType(linked){
    const invoice=fields.query('input[name="morningDocumentType"][value="305"]');
    if(invoice){invoice.disabled=linked;invoice.closest('.morning-type-option')?.classList.toggle('disabled',linked)}
    if(linked&&document.type()===305)setType(320);
  }
  function sync(){document.sync();payments.sync()}
  function capture(){return {type:document.type(),clientName:value('morningClientName'),amount:value('morningAmount'),date:value('morningDocumentDate'),description:value('morningDescription'),payments:payments.read()}}
  /** @param {BankPrefill} prefill @param {unknown} row @param {BankSource} origin @param {BankFormSnapshot} snapshot @returns {undefined} */
  function link(prefill,row,origin,snapshot){
    source.set({...prefill.source,kind:'bank',bankTransaction:row,linkedFrom:origin.kind});restrictType(true);
    if(origin.kind==='standalone'&&!clean(snapshot.clientName,160))set('morningClientName',prefill.customerName||'');
    set('morningAmount',Number(prefill.amount)>0?Number(prefill.amount).toFixed(2):'');fields.date(prefill.date);
    set('morningDescription',combineDescription(snapshot.description,prefill.description));
    payments.replace(Array.isArray(prefill.payment)?prefill.payment:[prefill.payment]);sync();
  }
  /** @param {BankSource} origin @param {BankFormSnapshot|null} snapshot @returns {undefined} */
  function clear(origin,snapshot){
    source.set(origin);restrictType(false);if(!snapshot)return;
    setType(snapshot.type||320);set('morningClientName',snapshot.clientName);set('morningAmount',snapshot.amount);
    fields.date(snapshot.date);set('morningDescription',snapshot.description);payments.replace(snapshot.payments||[]);sync();
  }
  return {source:source.read,capture,link,clear};
}
