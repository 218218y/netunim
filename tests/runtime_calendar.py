import json
from browser_harness import BrowserSession, ROOT

site=ROOT/'netunim-orders/site'
ok=True
try:
    with BrowserSession(site,'orders-calendar',instrument=False) as browser:
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        result=browser.evaluate(r"""(async()=>{
          Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
          const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');
          const storage=createCalendarStorage();
          const pad=v=>String(v).padStart(2,'0');
          const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
          const now=new Date(),first=new Date(now.getFullYear(),now.getMonth(),1),gridStart=new Date(first);
          gridStart.setDate(first.getDate()-first.getDay());
          const gridEnd=new Date(gridStart);gridEnd.setDate(gridEnd.getDate()+42);
          const rangeKey=`${key(gridStart)}__${key(gridEnd)}`;
          const today=key(now),start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),9,0),end=new Date(now.getFullYear(),now.getMonth(),now.getDate(),10,0);
          const calendars=[{id:'owner@example.com',summary:'ראשי',primary:true,accessRole:'owner',backgroundColor:'#8f6d55'},{id:'birthdays@example.com',summary:'ימי הולדת',accessRole:'reader',backgroundColor:'#397455'}];
          const events=[
            {id:'remote1',summary:'פגישה קיימת',start:{dateTime:start.toISOString()},end:{dateTime:end.toISOString()},eventType:'default',_calendarId:'owner@example.com',_calendarSummary:'ראשי',_calendarAccessRole:'owner',_calendarColor:'#8f6d55'},
            {id:'birthday1',summary:'יום הולדת בדיקה',start:{date:today},end:{date:key(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1))},eventType:'birthday',_calendarId:'birthdays@example.com',_calendarSummary:'ימי הולדת',_calendarAccessRole:'reader',_calendarColor:'#397455'}
          ];
          await storage.putMeta('accountId','owner@example.com');
          await storage.putRangeCache({key:rangeKey,accountId:'owner@example.com',rangeStart:key(gridStart),rangeEnd:key(gridEnd),fetchedAt:new Date().toISOString(),calendars,events});
          document.querySelector('[data-view="calendar"]').click();
          for(let i=0;i<40&&!document.querySelector('.calendar-board');i++)await new Promise(r=>setTimeout(r,25));
          const initial={
            active:document.querySelector('[data-view="calendar"]')?.classList.contains('active')===true,
            normal:[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='פגישה קיימת'),
            birthday:[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='יום הולדת בדיקה'),
            newEnabled:document.querySelector('#calendarNewButton')?.disabled===false,
            offline:document.querySelector('#calendarStatus')?.textContent.includes('אופליין')===true,
          };
          document.querySelector('#calendarNewButton').click();
          await new Promise(r=>setTimeout(r,20));
          document.querySelector('#calendarSummary').value='תור אופליין חדש';
          document.querySelector('#calendarStartDate').value=today;
          document.querySelector('#calendarEndDate').value=today;
          document.querySelector('#calendarStartTime').value='11:00';
          document.querySelector('#calendarEndTime').value='12:00';
          document.querySelector('[data-action="calendar-save-event"]').click();
          for(let i=0;i<40&&(await storage.pendingCount())<1;i++)await new Promise(r=>setTimeout(r,25));
          const queue=await storage.listOperations();
          const optimistic=[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='תור אופליין חדש');
          const pendingMarker=!![...document.querySelectorAll('.calendar-event')].find(el=>el.textContent.includes('תור אופליין חדש'))?.classList.contains('pending');
          const insert=queue[0]||{};
          const generatedId=String(insert.eventId||'');
          const modalClosed=!document.querySelector('#modalBackdrop')?.classList.contains('open');
          const beforeReload={count:queue.length,type:insert.type,idValid:/^[0-9a-f]{32}$/.test(generatedId),optimistic,pendingMarker,modalClosed};
          return {initial,beforeReload};
        })()""",timeout=30)
        # Wait for reload, then confirm the journal and optimistic overlay survived it.
        browser._navigate()
        browser.evaluate("import('./assets/js/main.js').then(m=>m.appReady).then(()=>true)")
        survived=browser.evaluate(r"""(async()=>{
          Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
          const {createCalendarStorage}=await import('./assets/js/calendar/storage.js');
          const storage=createCalendarStorage();
          document.querySelector('[data-view="calendar"]').click();
          for(let i=0;i<40&&!document.querySelector('.calendar-board');i++)await new Promise(r=>setTimeout(r,25));
          const queue=await storage.listOperations();
          return {count:queue.length,visible:[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='תור אופליין חדש'),pending:document.querySelector('#calendarStatus')?.textContent.includes('ממתינים')===true};
        })()""",timeout=30)
        errors=browser.drain_serious_errors()
        print(json.dumps({'result':result,'survived':survived,'errors':errors},ensure_ascii=False))
        expected=bool(
            result['initial']['active'] and result['initial']['normal'] and result['initial']['birthday'] and
            result['initial']['newEnabled'] and result['initial']['offline'] and
            result['beforeReload']['count']==1 and result['beforeReload']['type']=='insert' and
            result['beforeReload']['idValid'] and result['beforeReload']['optimistic'] and
            result['beforeReload']['pendingMarker'] and result['beforeReload']['modalClosed'] and
            survived['count']==1 and survived['visible'] and survived['pending'] and not errors
        )
        ok=expected
except Exception as exc:
    print('orders-calendar FAIL',exc)
    ok=False
raise SystemExit(0 if ok else 1)
