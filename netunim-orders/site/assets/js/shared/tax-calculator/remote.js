// @ts-check
/** @typedef {()=>void} TaxGuard */
/** @typedef {{ok:boolean,status:number,text:()=>Promise<string>}} TaxResponse */
/** @typedef {{method?:'POST',body?:string,networkRetry:true,dataPriority:'normal',assertRequestScope:TaxGuard}} TaxRequest */
/** @template D @typedef {{revision:number,state:D}} TaxHead */
/** @template D @typedef {{id:string,expectedRevision:number,state:D,restoreRevision?:number|null}} TaxFlight */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** @template D @param {{request:(path:string,options:TaxRequest)=>Promise<TaxResponse>,capture:(edit?:boolean)=>TaxGuard,decodeState:(name:string,raw:unknown)=>D,equalState:(a:D,b:D)=>boolean}} ports */
export function createTaxRemote({request,capture,decodeState,equalState}) {
  /** @param {string} path @param {{method?:'POST',body?:string}} [options] @param {boolean} [edit] @returns {Promise<unknown>} */
  async function api(path,options={},edit=false) {
    const guard=capture(edit);guard();
    const response=await request(path,{...options,networkRetry:true,dataPriority:'normal',assertRequestScope:guard});guard();
    const body=await response.text();guard();
    /** @type {unknown} */let data;try{data=JSON.parse(body)}catch{throw new Error('הענן לא החזיר תשובה תקינה; הפעולה נשמרה לניסיון חוזר');}
    if(!response.ok){const conflict=response.status===409||object(data)&&data.code==='40001';throw Object.assign(new Error(conflict?'התנגשות עם גרסה חדשה בענן':response.status===404?'נדרש עדכון מסד הנתונים של המחשבון':'לא ניתן להשלים סנכרון מחשבון כרגע'),{status:conflict?409:response.status});}
    return data;
  }
  /** @param {string} owner @param {string} name @param {unknown} row @returns {TaxHead<D>} */
  function decode(owner,name,row) {
    if(!object(row)||row.owner_id!==owner||row.document_name!==name||typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<1)throw new Error('אישור הענן אינו תואם למסמך המבוקש');
    return {revision:row.revision,state:decodeState(name,row.state)};
  }
  /** @param {string} owner @param {string} name @returns {Promise<TaxHead<D>|null>} */
  async function read(owner,name) {
    const rows=await api(`/rest/v1/tax_calculator_documents?owner_id=eq.${encodeURIComponent(owner)}&document_name=eq.${encodeURIComponent(name)}&select=owner_id,document_name,revision,state`);
    if(!Array.isArray(rows)||rows.length>1)throw new Error('קריאת מסמך מחשבון אינה תקינה');
    return rows.length?decode(owner,name,rows[0]):null;
  }
  /** @param {string} owner @param {string} name @param {TaxFlight<D>} command @returns {Promise<TaxHead<D>>} */
  async function write(owner,name,command) {
    const flight=structuredClone(command);
    decodeState(name,flight.state);
    if(!Number.isSafeInteger(flight.expectedRevision)||flight.expectedRevision<0||flight.expectedRevision>=Number.MAX_SAFE_INTEGER||typeof flight.id!=='string'||!flight.id||flight.id.length>200||flight.restoreRevision!=null&&(!Number.isSafeInteger(flight.restoreRevision)||flight.restoreRevision<1))throw new Error('פעולת הסנכרון אינה תקינה');
    const data=await api('/rest/v1/rpc/save_tax_calculator_document_v1',{method:'POST',body:JSON.stringify({p_document_name:name,p_expected_revision:flight.expectedRevision,p_state:flight.state,p_operation_id:flight.id,p_restore_revision:flight.restoreRevision??null})},true);
    /** @type {unknown} */const row=Array.isArray(data)&&data.length===1?data[0]:data;
    const ack=decode(owner,name,row);
    if(!object(row)||row.operation_id!==flight.id||typeof row.operation_replayed!=='boolean'||ack.revision!==flight.expectedRevision+1||!equalState(ack.state,flight.state))throw new Error('לא התקבל ACK מאומת; נשמרה הפעולה לניסיון חוזר');
    return ack;
  }
  /** @param {string} owner @param {string} name @returns {Promise<(TaxHead<D>&{createdAt:string})[]>} */
  async function history(owner,name) {
    const rows=await api(`/rest/v1/tax_calculator_history?owner_id=eq.${encodeURIComponent(owner)}&document_name=eq.${encodeURIComponent(name)}&select=owner_id,document_name,revision,state,created_at&order=revision.desc&limit=40`);
    if(!Array.isArray(rows)||rows.length>40)throw new Error('רשימת הגיבויים אינה תקינה');
    return rows.map((/** @type {unknown} */ row)=>{
      const head=decode(owner,name,row);
      if(!object(row)||typeof row.created_at!=='string'||!Number.isFinite(Date.parse(row.created_at)))throw new Error('תאריך גיבוי אינו תקין');
      return {...head,createdAt:row.created_at};
    });
  }
  /** @param {string} owner @returns {Promise<{document_name:string,revision:number}[]>} */
  async function catalog(owner) {
    const rows=await api(`/rest/v1/tax_calculator_documents?owner_id=eq.${encodeURIComponent(owner)}&select=document_name,revision&order=document_name&limit=1000`);
    if(!Array.isArray(rows)||rows.length>1000)throw new Error('רשימת שנות המחשבון אינה תקינה');
    return rows.map((/** @type {unknown} */ row)=>{
      if(!object(row)||typeof row.document_name!=='string'||typeof row.revision!=='number'||!Number.isSafeInteger(row.revision)||row.revision<1)throw new Error('רשימת שנות המחשבון אינה תקינה');
      return {document_name:row.document_name,revision:row.revision};
    });
  }
  return {read,write,history,catalog};
}
