import {createSpreadsheetSync} from './spreadsheet-sync.js';
import {assertSpreadsheet} from './spreadsheet-model.js';

export function createSpreadsheetWorkspace({domain,request,account,enabled,primary,active,render,legacy,esc,confirmDialog,modal,closeModal}){
  const labels={unloaded:'הגליון נטען בעת פתיחתו',loading:'טוען גליון…',saved:'הגליון נשמר',saving:'שומר גליון…',pending:'השינויים נשמרים במרוכז…',offline:'עותק מקומי · ממתין לרשת',error:'שמירת הגליון נעצרה',conflict:'נדרשת הכרעה בין שינויים'};
  const sync=createSpreadsheetSync({domain,request,account,enabled,primary,legacy,
    onChange:()=>{if(active())render()},
    onStatus:state=>{for(const element of document.querySelectorAll('[data-spreadsheet-status]')){element.textContent=state.error||labels[state.status];element.dataset.state=state.status}},
  });
  let pollTimer=null,started=false,activation=null,refreshError='';
  function activate(){
    if(!active())return Promise.resolve(false);
    if(activation)return activation;
    refreshError='';
    activation=(async()=>{
      if(!sync.ready)return sync.open();
      for(const element of document.querySelectorAll('[data-spreadsheet-status]'))element.textContent='\u05d1\u05d5\u05d3\u05e7 \u05e2\u05d3\u05db\u05d5\u05e0\u05d9\u05dd\u2026';
      try{return await sync.poll()}catch{refreshError='לא ניתן לבדוק עדכונים כרגע — מוצג העותק המקומי';return false}finally{if(active())for(const element of document.querySelectorAll('[data-spreadsheet-status]'))element.textContent=refreshError||sync.error||labels[sync.status]}
    })().catch(()=>false).finally(()=>{activation=null});return activation;
  }
  function start(){if(started)return;started=true;window.addEventListener('pagehide',sync.pagehide);window.addEventListener('beforeunload',sync.beforeUnload);document.addEventListener('visibilitychange',()=>{if(document.hidden){sync.pagehide();void sync.flush({send:false})}else if(active())void sync.poll().catch(()=>{})});window.addEventListener('online',()=>{if(sync.ready)void sync.flush()});document.addEventListener('click',event=>{if(sync.ready&&event.target.closest?.('[data-page],[data-view],[data-action="notes-workspace-notes"]'))void sync.flush()},true);pollTimer=setInterval(()=>{if(active()&&!document.hidden)void sync.poll().catch(()=>{})},20000)}
  function exportLocal(){const source=sync.model.state.notesSheet||legacy();if(!source&&!sync.recovery)return;const blob=new Blob([JSON.stringify({format:'netunim-workbook',domain,version:1,workbook:source,recovery:sync.recovery!==source?sync.recovery:undefined},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${domain}-workbook-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  async function showBackups(){
    try{const rows=await sync.backups();modal('גיבויי הגליונות',`<div class="spreadsheet-backups"><p>שחזור זה משנה רק את הגליונות של ${domain==='kupa'?'הקופה':'ההזמנות'}.</p>${rows.map(row=>`<div><span>${esc(new Date(row.created_at).toLocaleString('he-IL'))} · גרסה ${row.revision}</span><button class="btn small" data-action="spreadsheet-restore" data-click-arg0="${row.id}">שחזור</button></div>`).join('')||'<p>אין עדיין גיבויים זמינים.</p>'}</div>`,`<button class="btn" data-action="close-modal">סגור</button>`)}catch(e){modal('גיבויי הגליונות',`<p>${esc(e.message)}</p>`,`<button class="btn" data-action="close-modal">סגור</button>`)}
  }
  function showError(error){modal('פעולת הגליון נעצרה',`<p>${esc(error.message)}</p>`,`<button class="btn" data-action="close-modal">סגור</button>`)}
  function importLocal(){
    const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
    input.addEventListener('change',async()=>{try{
      const file=input.files?.[0];if(!file)return;if(file.size>25*1024*1024)throw new Error('קובץ הגליון גדול מדי');
      const payload=JSON.parse(await file.text());if(payload.format!=='netunim-workbook'||payload.domain!==domain)throw new Error('בחר קובץ גליון שיוצא ממערכת זו');
      const book=assertSpreadsheet(payload.workbook);
      if(!await confirmDialog('ייבוא גליון',`להחליף את הגליונות הנוכחיים ב־${book.sheets.length} גליונות ו־${book.rows.length} שורות מהקובץ?`,{confirmText:'ייבא גליונות'}))return;
      await sync.importWorkbook(book);
    }catch(error){showError(error)}});input.click();
  }
  const actions={
    'spreadsheet-retry':()=>{void sync.open()},
    'spreadsheet-export':exportLocal,
    'spreadsheet-import':importLocal,
    'spreadsheet-backups':()=>void showBackups(),
    'spreadsheet-restore':async element=>{const id=Number(element.dataset.clickArg0);if(!await confirmDialog('שחזור הגליונות','להחליף את הגליונות בגיבוי שנבחר? יישמר גיבוי בטיחות של המצב הנוכחי.',{confirmText:'שחזר גליונות'}))return;try{await sync.restore(id);closeModal()}catch(e){modal('השחזור לא בוצע',`<p>${esc(e.message)}</p>`,`<button class="btn" data-action="close-modal">סגור</button>`) }},
    'spreadsheet-use-remote':async()=>{if(!await confirmDialog('התנגשות בגליון','להוריד עותק של השינויים המקומיים ולטעון את גרסת הענן? שום שינוי לא ייכתב לענן.',{confirmText:'הורד עותק וטען ענן'}))return;try{exportLocal();await sync.useRemoteAfterExport()}catch(error){showError(error)}},
  };
  function loadingMarkup(){start();if(sync.status==='unloaded'||!sync.ready&&!['loading','error'].includes(sync.status))void sync.open();return `<div class="notes-empty"><b>${esc(labels[sync.status]||labels.loading)}</b><p>${esc(sync.error)}</p>${sync.status==='error'?'<button class="btn" data-action="spreadsheet-retry">נסה שוב</button><button class="btn" data-action="spreadsheet-export">הורד עותק להתאוששות</button><button class="btn" data-action="spreadsheet-use-remote">שחזר מהענן</button>':''}</div>`}
  function toolbarMarkup(){start();return `<div class="spreadsheet-toolbar"><span data-spreadsheet-status data-state="${sync.status}" role="status">${esc(sync.error||labels[sync.status])}</span><div><button class="btn small" data-action="spreadsheet-export">ייצוא גליון</button><button class="btn small" data-action="spreadsheet-import">ייבוא JSON</button><button class="btn small" data-action="spreadsheet-backups">גיבויים ושחזור</button>${sync.conflict?'<button class="btn small" data-action="spreadsheet-use-remote">פתרון התנגשות</button>':''}</div></div>`}
  function saveWorkbook(message,options={}){if(message==='תא בגליון עודכן')return;sync.changed(null,{immediate:true,deleteIntents:options.deleteIntents})}
  function cellChanged(rowId,columnId,value,updatedAt){sync.changed({rowId,columnId,value,updatedAt})}
  return {sync,activate,model:sync.model,saveWorkbook,cellChanged,loadingMarkup,toolbarMarkup,actions,get ready(){return sync.ready},get readOnly(){return !!sync.conflict||!primary()},dispose(){if(pollTimer)clearInterval(pollTimer)}};
}
