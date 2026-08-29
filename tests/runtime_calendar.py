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
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const focusVisible=()=>{const scroller=document.querySelector('.calendar-view .view-scroll'),target=document.querySelector(`[data-calendar-day="${today}"]`);if(!scroller||!target)return false;const sr=scroller.getBoundingClientRect(),tr=target.getBoundingClientRect();return tr.top>=sr.top-1&&tr.bottom<=sr.bottom+1};
          const initial={
            active:document.querySelector('[data-view="calendar"]')?.classList.contains('active')===true,
            normal:[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='פגישה קיימת'),
            birthday:[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='יום הולדת בדיקה'),
            newEnabled:document.querySelector('#calendarNewButton')?.disabled===false,
            offline:document.querySelector('#calendarStatus')?.textContent.includes('אופליין')===true,
            weekActive:document.querySelector('[data-action="calendar-set-view"][data-click-arg0="week"]')?.classList.contains('active')===true,
            todayVisible:focusVisible(),
          };
          document.querySelector('[data-action="calendar-set-view"][data-click-arg0="week"]').click();
          const weekImmediate=!!document.querySelector('.calendar-board.mode-week')&&!document.querySelector('.calendar-loading');
          for(let i=0;i<40&&!document.querySelector('.calendar-board.mode-week');i++)await new Promise(r=>setTimeout(r,25));
          const week={active:document.querySelector('[data-action="calendar-set-view"][data-click-arg0="week"]')?.classList.contains('active')===true,days:document.querySelectorAll('.calendar-grid-week [data-calendar-day]').length,immediate:weekImmediate};
          document.querySelector('[data-action="calendar-set-view"][data-click-arg0="day"]').click();
          const dayImmediate=!!document.querySelector('.calendar-board.mode-day')&&!document.querySelector('.calendar-loading');
          for(let i=0;i<40&&!document.querySelector('.calendar-board.mode-day');i++)await new Promise(r=>setTimeout(r,25));
          const day={active:document.querySelector('[data-action="calendar-set-view"][data-click-arg0="day"]')?.classList.contains('active')===true,days:document.querySelectorAll('.calendar-grid-day [data-calendar-day]').length,immediate:dayImmediate};
          document.querySelector('[data-action="calendar-set-view"][data-click-arg0="month"]').click();
          for(let i=0;i<40&&!document.querySelector('.calendar-board.mode-month');i++)await new Promise(r=>setTimeout(r,25));
          const scroller=document.querySelector('.calendar-view .view-scroll');if(scroller)scroller.scrollTop=0;
          document.querySelector('[data-action="calendar-today"]').click();
          for(let i=0;i<40&&!document.querySelector(`[data-calendar-day="${today}"]`);i++)await new Promise(r=>setTimeout(r,25));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const todayButton={visible:focusVisible(),monthActive:document.querySelector('[data-action="calendar-set-view"][data-click-arg0="month"]')?.classList.contains('active')===true};
          document.querySelector('#calendarNewButton').click();
          await new Promise(r=>setTimeout(r,20));
          document.querySelector('#calendarSummary').value='תור אופליין חדש';
          document.querySelector('#calendarStartDate').value=today;
          document.querySelector('#calendarEndDate').value=today;
          document.querySelector('#calendarStartTime').value='11:00';
          document.querySelector('#calendarEndTime').value='12:00';
          document.querySelector('[data-action="calendar-save-event"]').click();
          let queue=[],optimistic=false,pendingMarker=false,modalClosed=false;
          for(let i=0;i<80;i++){
            queue=await storage.listOperations();
            optimistic=[...document.querySelectorAll('.calendar-event-title')].some(el=>el.textContent==='תור אופליין חדש');
            pendingMarker=!![...document.querySelectorAll('.calendar-event')].find(el=>el.textContent.includes('תור אופליין חדש'))?.classList.contains('pending');
            modalClosed=!document.querySelector('#modalBackdrop')?.classList.contains('open');
            if(queue.length>=1&&optimistic&&pendingMarker&&modalClosed)break;
            await new Promise(r=>setTimeout(r,25));
          }
          const insert=queue[0]||{};
          const generatedId=String(insert.eventId||'');
          const beforeReload={count:queue.length,type:insert.type,idValid:/^[0-9a-f]{32}$/.test(generatedId),optimistic,pendingMarker,modalClosed};
          return {initial,week,day,todayButton,beforeReload};
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
            result['initial']['newEnabled'] and result['initial']['offline'] and result['initial']['weekActive'] and result['initial']['todayVisible'] and
            result['week']['active'] and result['week']['days']==7 and result['week']['immediate'] and result['day']['active'] and result['day']['days']==1 and result['day']['immediate'] and
            result['todayButton']['visible'] and result['todayButton']['monthActive'] and
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
