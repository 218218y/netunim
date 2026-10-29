import {esc} from '../../core/values.js';
import {createExpenseBatchRecovery} from './morning-expense-batch-recovery.js';

// One serial worker serves both single background saves and approved batches.
// Approval/editing and financial delivery have independent ownership and state.
export function createExpenseBatch({storage,capture,request,confirmDialog,run,render,report,toast,detach,execute,pending,openRecovery,restoreUnsent,progress,settled,order=()=>[],
  locks=globalThis.navigator?.locks}){
  const entries=new Map();let recovery=null,scope='',revision=0,running=false,paused=false,confirming=false,current=null,completed=0,notice='',warning='',stageText='';
  const ready=()=>[...entries.values()].filter(row=>row.state==='approved');
  const queued=()=>[...entries.values()].filter(row=>row.state==='queued');
  const attention=()=>[...entries.values()].some(row=>row.state==='attention');
  function reset(){revision++;entries.clear();recovery=null;scope='';running=false;paused=false;confirming=false;current=null;completed=0;notice='';warning='';stageText='';}
  function initialize(owner,environment){
    if(scope===environment+':'+owner)return;
    reset();scope=environment+':'+owner;recovery=createExpenseBatchRecovery(storage(),owner,environment);
    if(recovery.list().some(row=>row.state!=='approved')){paused=true;warning='קיימות שליחות קודמות שדורשות בירור. יש לבדוק אותן לפני שליחה חדשה.';}
  }
  function recoveredState(){
    if(running||attention())return;
    const own=new Set([...entries.values()].map(row=>row.operationId));
    if(recovery.list().some(row=>!own.has(row.operationId)&&row.state!=='approved'))return;
    paused=queued().length>0;warning=paused?'הפעולה הושלמה. יש ללחוץ על המשך שליחת הממתינות.':'';
  }
  function record(entry,state){recovery.put({version:1,operationId:entry.operationId,sha256:entry.source.sourceFile.sha256,state});entry.state=state;}
  function invalidate(item,strict=false){
    const entry=entries.get(item);if(!entry)return false;
    if(entry.state!=='approved')throw Error('המסמך כבר נמסר לשליחה. יש לבדוק את מצבו בלי לשנות את הפרטים שאושרו.');
    entries.delete(item);notice='האישור בוטל בעקבות עריכה; יש לבדוק ולסמן מחדש.';try{recovery.remove(entry.operationId);}catch(error){warning=error.message;if(strict)throw error;}return true;
  }
  function mark(item,saved,source,snapshot){
    if(!recovery||!source?.sourceFile?.sha256)throw Error('לא ניתן לאשר את המקור לשליחה כעת.');
    const existing=entries.get(item);
    if(existing&&existing.state!=='approved')throw Error('המסמך כבר נמצא בשליחה או בבירור.');
    if(recovery.list().some(row=>row.sha256===source.sourceFile.sha256&&row.operationId!==existing?.operationId))throw Error('לקובץ קיים מעקב קודם. יש לבדוק אותו ברשימת האישורים הקודמים לפני שליחה נוספת.');
    const entry={item,saved:structuredClone(saved),snapshot:structuredClone(snapshot),source:structuredClone(source),operationId:existing?.operationId||crypto.randomUUID(),state:'approved',result:null};
    record(entry,'approved');entries.set(item,entry);notice=`${ready().length} הוצאות מאושרות וממתינות לשליחה.`;return entry;
  }
  function finish(operationId,count=true){
    const entry=[...entries.values()].find(row=>row.operationId===operationId);
    if(recovery?.get(operationId))recovery.remove(operationId);
    if(entry){entries.delete(entry.item);if(count)completed++;
      recoveredState();return entry;}recoveredState();return null;
  }
  function kick(){
    if(running||paused||attention()||!queued().length)return false;
    let check;try{check=capture(true);
      const own=new Set([...entries.values()].map(row=>row.operationId));
      if(recovery.list().some(row=>!own.has(row.operationId)&&row.state!=='approved'))throw Error('קיימות שליחות קודמות שדורשות בירור. יש לבדוק אותן לפני שליחה חדשה.');
    }catch(error){paused=true;warning=error.message;report(warning);render();return false;}const epoch=revision;
    const guard=()=>{check();if(epoch!==revision)throw Error('המסך התחלף.');};
    running=true;render();
    return run(async()=>{
      try{
        if(!locks)throw Error('שליחה ברקע דורשת דפדפן שתומך בנעילת פעולות.');
        await locks.request('morningExpenseBatch:'+scope,{ifAvailable:true},async lock=>{
          guard();if(!lock)throw Error('שליחת הוצאות פעילה בחלון אחר. המסמכים נשארו ממתינים.');
          while(queued().length){
            guard();if(pending())throw Error('פעולה אחרת פתוחה להשלמה. המסמכים הבאים נשארו ממתינים.');
            current=queued()[0];
            if(recovery.get(current.operationId)?.state!=='queued')throw Error('מעקב הפעולה השתנה. יש לבדוק את מצבה.');
            record(current,'sending');render();
            const result=await execute(current,guard,(stage,text)=>{guard();progress(stage,text);});guard();
            if(result?.verified!==true||result?.sourceVerified!==true)throw Error('ההוצאה או המקור טרם אומתו. התור נעצר לבדיקה.');
            finish(current.operationId);notice=`${current.item.name} נשמרה ואומתה עם מסמך המקור.`;
            toast(notice);settled(result,current);current=null;render();
          }
        });
      }catch(error){
        try{guard();paused=true;notice=`השליחה נעצרה. הושלמו ${completed}; ${entries.size} מסמכים נשארו למעקב. ${error.message}`;warning=notice;
          try{if(current&&entries.has(current.item)&&current.state==='sending')record(current,'attention');}catch{warning+=' עדכון המעקב המקומי נכשל; יש לבדוק את מזהה הפעולה בשרת.';notice=warning;}
          report(warning);toast(warning);
        }catch{/* The durable records stay with their original account. */}
      }finally{if(epoch===revision){running=false;current=null;progress('','');render();}}
    });
  }
  function enqueue(list){
    if(!list.length)return false;
    for(const entry of list)if(entries.get(entry.item)!==entry||entry.state!=='approved')throw Error('האישור השתנה. יש לבדוק מחדש.');
    try{for(const entry of list)record(entry,'queued');}catch(error){paused=true;warning='שמירת מעקב השליחה נכשלה. ההוצאות לא נשלחו. יש לבדוק את הממתינות לפני המשך.';detach(list.filter(entry=>entry.state==='queued'));report(warning);render();throw error;}
    detach(list);notice=`${list.length} מסמכים נוספו לתור השליחה. אפשר לבדוק את המסמך הבא בזמן העיבוד.`;
    report(notice);toast(notice);render();void kick();return true;
  }
  function send(){
    if(confirming||pending()||!ready().length||paused||attention())return false;
    const check=capture(true),epoch=revision,positions=new Map(order().map((item,n)=>[item,n])),planned=ready().sort((a,b)=>(positions.get(a.item)??0)-(positions.get(b.item)??0));confirming=true;
    return run(async()=>{
      try{
        const approved=await confirmDialog(scope.startsWith('production:')?'שמירת ההוצאות המאושרות בחשבון Morning האמיתי':'שמירת ההוצאות המאושרות ב־Sandbox',`לשלוח ${planned.length} הוצאות שסימנת כבדוקות, עם מסמכי המקור שלהן? הן יישלחו לפי הסדר. אפשר להמשיך לבדוק מסמכים בזמן השליחה. במקרה של תקלה התור ייעצר לטיפול.`,{confirmText:`שמירת ${planned.length} הוצאות מאושרות`});
        check();if(epoch!==revision||!approved)return false;return enqueue(planned);
      }catch(error){try{check();if(epoch===revision){warning=error.message;report(warning);render();}}catch{/* Old account. */}return false;}
      finally{if(epoch===revision)confirming=false;}
    });
  }
  function resume(){
    if(running||pending()||attention()||!queued().length)return false;
    paused=false;warning='';return kick();
  }
  function recover(operationId){
    if(running||pending())return false;
    return run(async()=>{
      const check=capture(),epoch=revision,guard=()=>{check();if(epoch!==revision)throw Error('המסך התחלף.');};
      try{
        if(!recovery?.get(operationId))return false;
        if(!locks)throw Error('שחזור השליחה דורש דפדפן שתומך בנעילת פעולות.');
        return await locks.request('morningExpenseBatch:'+scope,{ifAvailable:true},async lock=>{
          guard();if(!lock)throw Error('שליחה פעילה בחלון אחר. יש להמתין לסיומה.');
          let missing=false;
          try{await request('operation_status',{operationId},guard);guard();}
          catch(error){guard();if(error.code!=='morning_expense_operation_missing')throw error;missing=true;}
          const entry=[...entries.values()].find(row=>row.operationId===operationId);
          if(!missing)return openRecovery(operationId,entry);
          const approved=await confirmDialog('הוצאה שטרם נשלחה','השרת אישר שמזהה הפעולה אינו קיים. להסיר את האישור הישן ולהחזיר את המסמך לבדיקה ולאישור מחדש?',{confirmText:'החזרה לבדיקה'});guard();
          if(!approved)return false;recovery.remove(operationId);if(entry){entries.delete(entry.item);restoreUnsent(entry);}
          recoveredState();
          notice='לא נמצאה יצירה בשרת. האישור הישן הוסר; יש לבדוק ולאשר מחדש את המקור.';report(notice);return true;
        });
      }catch(error){try{guard();warning=error.message;report(warning);}catch{/* Old account. */}return false;}
      finally{if(epoch===revision)render();}
    });
  }
  function markup(disabled){
    if(!recovery)return '';
    let previous=[];try{const own=new Set([...entries.values()].map(row=>row.operationId));previous=recovery.list().filter(row=>!own.has(row.operationId));}catch(error){warning=error.message;}
    if(!entries.size&&!previous.length&&!notice&&!warning)return '';
    const labels={approved:'אושרה · טרם נשלחה',queued:'ממתינה לשליחה',sending:'בשליחה ובאימות',attention:'דורשת טיפול · השליחה נעצרה'};
    return `<section class="morning-expense-batch" data-expense-batch aria-label="מעקב שליחת הוצאות">
      <h3>שליחת הוצאות · ${completed} הושלמו · ${queued().length} ממתינות</h3>
      <p>מסמך שסומן כמאושר נשלח רק בלחיצה על שמירה. אפשר לבדוק את הבא בזמן השליחה. קובצי המקור והשדות נשמרים בזיכרון עד סגירת המסך.</p>
      ${notice?`<p role="status">${esc(notice)}</p>`:''}${warning?`<p role="alert" class="morning-expense-notice">${esc(warning)}</p>`:''}
      <button type="button" class="btn primary" data-action="morning-expense-batch-send" ${disabled||paused||attention()||!ready().length?'disabled':''}>שמירת כל ההוצאות המאושרות (${ready().length})</button>
      ${paused&&!attention()&&queued().length?`<button type="button" class="btn" data-action="morning-expense-command" data-expense-command="batch-resume" ${disabled?'disabled':''}>המשך שליחת הממתינות</button>`:''}
      ${entries.size?`<ul>${[...entries.values()].map(entry=>`<li><b>${esc(entry.item.name)}</b> · ${labels[entry.state]}${entry.state==='attention'||paused&&entry.state==='queued'?` <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="batch-recover" data-batch-operation="${entry.operationId}" ${disabled||running?'disabled':''}>בדיקה והשלמה</button>`:''}</li>`).join('')}</ul>`:''}
      ${previous.length?`<h4>מעקב קודם שדורש בירור · ${previous.length}</h4><p>לא מתבצעת שליחה חוזרת אוטומטית. בדיקת מצב תחזיר הוצאה קיימת להשלמה, או תאפשר לאשר מחדש מסמך שלא נשלח.</p><ul>${previous.map((row,n)=>`<li>מסמך ${n+1} · ${labels[row.state]} <button type="button" class="btn" data-action="morning-expense-command" data-expense-command="batch-recover" data-batch-operation="${row.operationId}" ${disabled||running?'disabled':''}>בדיקת מצב ושחזור</button></li>`).join('')}</ul>`:''}
    </section>${running||paused?`<aside class="morning-expense-batch-dock ${paused?'attention':''}" role="${paused?'alert':'status'}"><div><b>${paused?'שליחת הוצאות נעצרה · נדרש טיפול':`שליחה ברקע · ${completed} הושלמו · ${queued().length} ממתינות`}</b><span data-expense-batch-stage title="${esc(stageText)}">${esc(stageText)}</span>${running?'<small data-expense-elapsed></small>':''}</div><button type="button" class="btn" data-action="morning-expense-command" data-expense-command="batch-show">למעקב השליחה</button></aside>`:''}`;
  }
  return {initialize,reset,mark,finish,invalidate,recover,send,resume,enqueue,markup,kick,running:()=>running,paused:()=>paused,
    count:()=>ready().length,files:()=>[...entries.keys()],
    invalidateAll:()=>{let changed=false;for(const [item,row]of [...entries])if(row.state==='approved')changed=invalidate(item)||changed;return changed;},
    label:item=>entries.get(item)?.state==='approved'?'מאושרת לשליחה':entries.has(item)?'במעקב שליחה':'',
    showStage:text=>{stageText=text;const el=document.querySelector('[data-expense-batch-stage]');if(el){el.textContent=text;el.title=text;}},
    progress:text=>running&&current?`${current.item.name} · ${text}`:text};
}
