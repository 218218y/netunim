import {esc} from '../core/values.js';
import {summarizeBackupDiff} from '../shared/cloud-backups.js';

const ORDERS_BACKUP_COLLECTIONS=[
  {path:'suppliers',label:'ספקים'},
  {path:'transactions',label:'תנועות ספק'},
  {path:'customerDebts',label:'חובות לקוחות'},
  {path:'customerOrders',label:'הזמנות לקוח'},
  {path:'serviceCalls',label:'קריאות שירות'},
  {path:'inventoryItems',label:'פריטי מלאי'},
  {path:'inventoryEvents',label:'אירועי מלאי'},
  {path:'warehouseOrders',label:'הזמנות מחסן'},
  {path:'notes',label:'פתקים'},
  {path:'notesSheet.sheets',label:'גליונות'},
  {path:'notesSheet.columns',label:'עמודות בגליונות'},
  {path:'notesSheet.rows',label:'שורות בגליונות'},
  {path:'checks',label:'צ׳קים'},
];
const ORDERS_BACKUP_CONFIG=[{path:'inventoryCategoryOrder',label:'סדר קטגוריות מלאי'}];
function localDateTime(value){const d=new Date(value||'');return Number.isFinite(d.getTime())?d.toLocaleString('he-IL',{dateStyle:'short',timeStyle:'short'}):'זמן לא ידוע'}
const BACKUP_FIELD_LABELS={name:'שם',supplierId:'ספק',sequence:'מספר שורה',invoiceReceived:'חשבונית התקבלה',action:'פעולה',debit:'חובה',credit:'זכות',signed:'חתום',supplied:'סופק',supplyInfo:'פרטי אספקה',note:'הערה',clearingApproval:'סליקה',customerId:'ת.ז',yearEnd:'סוף שנה',customerName:'לקוח',orderNumber:'מספר הזמנה',amount:'סכום',amountValue:'סכום',debtProgress:'התקדמות תשלום/חשבונית',phone:'טלפון',mattresses:'מזרנים',suppliedAt:'תאריך אספקה',paidAt:'תאריך תשלום',invoiceIssued:'חשבונית הוצאה',invoiceIssuedAt:'תאריך חשבונית',closedAt:'תאריך סגירה',mark1:'חובות',mark2:'סימון 2',mark3:'סימון 3',urgent:'דחוף לטיפול',address:'כתובת',assignee:'אחראי',description:'תיאור',openedAt:'נפתח',followUp:'מעקב',escalated:'הקפצה',nextFollowUp:'מעקב הבא',closed:'סגור',category:'קטגוריה',location:'מיקום',active:'פעיל',itemId:'פריט',type:'סוג',quantity:'כמות',receivedQuantity:'כמות שהתקבלה',pickedAt:'נאסף',releasedAt:'שוחרר',status:'סטטוס',details:'פרטים',account:'חשבון',dueDate:'תאריך פירעון',depositDate:'תאריך הפקדה',depositedAt:'הופקד',clearedDate:'נפרע',checkNumber:'מספר צ׳ק',content:'תוכן'};
const BACKUP_TECH_FIELDS=new Set(['source','sortOrder','archivedAt','pickedUp','reserved']);
function compactBackupValue(value){if(value===null||value===undefined||value==='')return '—';if(typeof value==='boolean')return value?'כן':'לא';if(typeof value==='number')return Number.isFinite(value)?value.toLocaleString('he-IL'):'—';if(Array.isArray(value))return `${value.length} פריטים`;if(typeof value==='object'){const text=JSON.stringify(value);return text.length>90?text.slice(0,87)+'…':text}const text=String(value);return text.length>100?text.slice(0,97)+'…':text}
function supplierName(id,entry){const key=String(id||'');return entry?.targetState?.suppliers?.find(x=>String(x.id)===key)?.name||entry?.currentState?.suppliers?.find(x=>String(x.id)===key)?.name||key||'ספק לא ידוע'}
function inventoryItemName(id,entry){const key=String(id||'');return entry?.targetState?.inventoryItems?.find(x=>String(x.id)===key)?.name||entry?.currentState?.inventoryItems?.find(x=>String(x.id)===key)?.name||key||'פריט לא ידוע'}
function displayBackupFieldValue(key,value,entry){if(key==='supplierId')return supplierName(value,entry);if(key==='itemId')return inventoryItemName(value,entry);return compactBackupValue(value)}
function backupEntityTitle(path,row,entry){if(!row)return 'רשומה';if(path==='transactions')return `${supplierName(row.supplierId,entry)}${row.sequence?` · שורה ${row.sequence}`:''}${row.action?` · ${row.action}`:''}`;if(path==='suppliers')return row.name||'ספק';if(path==='customerDebts')return row.customerName||'לקוח';if(path==='customerOrders')return `${row.customerName||'לקוח'}${row.orderNumber?` · הזמנה ${row.orderNumber}`:''}`;if(path==='serviceCalls')return `${row.customerName||'לקוח'}${row.orderNumber?` · ${row.orderNumber}`:''}`;if(path==='inventoryItems')return row.name||'פריט מלאי';if(path==='inventoryEvents')return `${inventoryItemName(row.itemId,entry)}${row.type?` · ${row.type}`:''}`;if(path==='warehouseOrders')return `${row.customerName||'הזמנת מחסן'}${row.details?` · ${String(row.details).slice(0,45)}`:''}`;if(path==='checks')return `${row.name||'צ׳ק'}${row.checkNumber?` · ${row.checkNumber}`:''}${row.dueDate?` · ${row.dueDate}`:''}`;if(path==='notes')return String(row.content||'פתק').slice(0,70);return String(row.name||row.description||row.customerName||row.id||'רשומה').slice(0,80)}
function backupDetailMarkup(detail,row,entry){const representative=detail.target||detail.current,title=backupEntityTitle(row.path,representative,entry),verb=detail.type==='restored'?'תחזור מהגיבוי':detail.type==='removed'?'תוסר בשחזור':'תשתנה',fields=(detail.fields||[]).filter(field=>!BACKUP_TECH_FIELDS.has(field.key));let body='';if(detail.type==='changed'){const visible=fields.slice(0,8);body=visible.length?visible.map(field=>`<div class="cloud-backup-field-change"><b>${esc(BACKUP_FIELD_LABELS[field.key]||field.key)}</b><span class="cloud-backup-now">עכשיו: ${esc(displayBackupFieldValue(field.key,field.current,entry))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(displayBackupFieldValue(field.key,field.target,entry))}</span></div>`).join(''):'<div class="muted">ההבדל הוא בשדות מערכת/מטא־דאטה בלבד.</div>';if(fields.length>visible.length)body+=`<div class="muted">ועוד ${esc(fields.length-visible.length)} שדות שהשתנו.</div>`}else{const current=detail.type==='restored'?'לא קיימת':backupEntityTitle(row.path,detail.current,entry),target=detail.type==='removed'?'לא תהיה קיימת':backupEntityTitle(row.path,detail.target,entry);body=`<div class="cloud-backup-field-change"><b>מצב הרשומה</b><span class="cloud-backup-now">עכשיו: ${esc(current)}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(target)}</span></div>`}return `<div class="cloud-backup-entity-change"><div><b>${esc(title)}</b><small>${esc(verb)}</small></div>${body}</div>`}
function diffRowMarkup(row,entry){const parts=[];if(row.removed)parts.push(`יוסרו ${row.removed}`);if(row.restored)parts.push(`יחזרו ${row.restored}`);if(row.changed)parts.push(`ישתנו ${row.changed}`);const details=row.details||[],visible=details.slice(0,40),more=details.length-visible.length;return `<details class="cloud-backup-diff-row"><summary><b>${esc(row.label)}</b><span>${esc(row.before)} ← ${esc(row.after)}</span><small>${esc(parts.join(' · ')||'ללא שינוי')}</small></summary><div class="cloud-backup-diff-details">${visible.map(detail=>backupDetailMarkup(detail,row,entry)).join('')||'<div class="muted">אין פירוט נוסף.</div>'}${more?`<div class="muted">יש עוד ${esc(more)} רשומות שונות; הפירוט מוגבל ל־40 כדי לשמור על תצוגה מהירה.</div>`:''}</div></details>`}
function settingsDiffMarkup(setting){return `<div class="cloud-backup-field-change"><b>${esc(setting.label)}</b><span class="cloud-backup-now">עכשיו: ${esc(compactBackupValue(setting.current))}</span><span class="cloud-backup-target">אחרי שחזור: ${esc(compactBackupValue(setting.target))}</span></div>`}
function syncRecoveryDiffText(remote,local){
  const diff=summarizeBackupDiff(remote,local,{collections:ORDERS_BACKUP_COLLECTIONS.filter(item=>item.path!=='checks'),config:ORDERS_BACKUP_CONFIG}),entry={targetState:local,currentState:remote},lines=['בכל שדה מוצגים ערך הענן והערך המקומי שיועלה.'];
  for(const row of diff.rows){
    lines.push(`${row.label}: ${row.restored} חדשות, ${row.changed} שונו, ${row.removed} יימחקו.`);
    for(const detail of row.details.slice(0,40)){
      const verb=detail.type==='restored'?'חדשה':detail.type==='removed'?'מחיקה':'שינוי';
      lines.push(`  ${verb}: ${backupEntityTitle(row.path,detail.target||detail.current,entry)}`);
      if(detail.type==='changed')for(const field of detail.fields.filter(item=>!BACKUP_TECH_FIELDS.has(item.key)).slice(0,12))lines.push(`    ${BACKUP_FIELD_LABELS[field.key]||field.key}: ${displayBackupFieldValue(field.key,field.current,entry)} ← ${displayBackupFieldValue(field.key,field.target,entry)}`);
    }
    if(row.details.length>40)lines.push(`  ועוד ${row.details.length-40} רשומות; פירוט מלא נמצא בגיבוי.`);
  }
  for(const setting of diff.settings)lines.push(`${setting.label}: ${compactBackupValue(setting.current)} ← ${compactBackupValue(setting.target)}`);
  return lines.join('\n')||'אין הבדל עסקי בין המצב המקומי לענן.';
}
export {ORDERS_BACKUP_COLLECTIONS,ORDERS_BACKUP_CONFIG,localDateTime,BACKUP_FIELD_LABELS,BACKUP_TECH_FIELDS,compactBackupValue,supplierName,inventoryItemName,displayBackupFieldValue,backupEntityTitle,backupDetailMarkup,diffRowMarkup,settingsDiffMarkup,syncRecoveryDiffText};
