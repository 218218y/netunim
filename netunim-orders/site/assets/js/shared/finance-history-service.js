import {financeBackup,creditVersionDiff} from './finance-history-model.js';
import {readFinanceWriteReceipt} from './finance-write-receipt.js';
const equal=(a,b)=>JSON.stringify(order(a))===JSON.stringify(order(b));
function order(value){return Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value}
export function createFinanceHistoryService({request,readHead,leases,capture,refresh,saveJson}){
  let selected=null;
  async function rpc(name,body,guard){
    guard();const response=await request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify({p_document_name:'main',...body}),assertRequestScope:guard,dataPriority:'high',networkRetry:true});guard();
    const result=await response.json();guard();if(!response.ok)throw Object.assign(Error(result?.code==='PGRST202'?'יש להשלים את עדכון מסד הנתונים כדי להשתמש בגרסאות ובגיבוי אשראי':result?.message==='mfa_required'?'נדרש אימות נוסף לפני גישה לגרסאות הפיננסיות':result?.message||'פעולת גרסאות Finance נכשלה'),{code:result?.code});return result;
  }
  function head(row){if(!Number.isSafeInteger(Number(row?.revision))||Number(row.revision)<1||!row?.state)throw Error('לא התקבלה גרסת Finance עדכנית מהענן');return {...row,revision:Number(row.revision)}}
  async function list(before,guard){const rows=await rpc('list_finance_document_versions',{p_before_revision:before??null},guard);if(!Array.isArray(rows))throw Error('רשימת גרסאות אינה תקינה');return rows}
  async function preview(revision,guard){
    if(!Number.isSafeInteger(Number(revision))||Number(revision)<1)throw Error('גרסה אינה תקינה');
    const [live,rows]=await Promise.all([readHead({assertCurrent:guard}),rpc('export_finance_document_version',{p_revision:Number(revision)},guard)]);guard();
    if(!Array.isArray(rows)||rows.length!==1||Number(rows[0].revision)!==Number(revision))throw Error('הגרסה לא נמצאה עבור החשבון הנוכחי');
    const backup=await financeBackup(rows[0]);guard();const target=JSON.parse(backup.stateText),current=head(live);
    selected={revision:Number(revision),backup,target,current,diff:creditVersionDiff(current.state,target)};return selected;
  }
  async function exportVersion(preview,guard){guard();if(preview!==selected)throw Error('תצוגת הגרסה התיישנה');await saveJson('finance-backup-'+preview.revision+'.json',preview.backup,'finance-backup.json');guard()}
  async function restore(preview,reason,guard){
    guard();if(preview!==selected||String(reason).trim().length<8||String(reason).length>500)throw Error('יש לבחור גרסה ולציין סיבה מפורטת לשחזור');
    const session=leases.commands.acquire('credit',crypto.randomUUID(),{assertCurrent:guard});
    try{
      const lease=await session.ready;guard();lease.assertCurrent();if(lease.acquired!==true||lease.localOnly)throw Error('לא התקבלה נעילת אשראי בענן');
      const live=head(await readHead({assertCurrent:lease.assertCurrent}));lease.assertCurrent();
      if(live.revision!==preview.current.revision)throw Error('נתוני Finance השתנו מאז ההשוואה. יש לבחור גרסה ולהשוות מחדש');
      const result=await rpc('restore_finance_credit_version',{p_version:preview.revision,p_expected_revision:live.revision,p_operation_id:crypto.randomUUID(),p_reason:String(reason).trim(),p_lease_token:lease.leaseToken,p_fence_epoch:lease.fenceEpoch},lease.assertCurrent);
      const saved=readFinanceWriteReceipt(result,{baseRevision:live.revision,sentState:{...live.state,creditSync:preview.target.creditSync}});lease.assertCurrent();
      const reread=head(await readHead({assertCurrent:lease.assertCurrent}));lease.assertCurrent();
      if(reread.revision<saved.revision||!equal(reread.state.creditSync,preview.target.creditSync))throw Error('השחזור נשמר אך הקריאה החוזרת אינה מאשרת את האשראי שנבחר. יש לבדוק מהענן ללא שחזור חוזר');
      const confirmed=await refresh({assertCurrent:lease.assertCurrent,minimumFinanceRevision:saved.revision});lease.assertCurrent();
      selected=null;return {saved,displayConfirmed:confirmed===true||confirmed?.verified===true};
    }finally{await session.close()}
  }
  return {list,preview,exportVersion,restore,capture,clear:()=>{selected=null}};
}
