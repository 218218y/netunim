"""Focused Service queue acceptance in an isolated, offline browser."""
import base64
import json
import os
from browser_harness import BrowserSession, ROOT


def run():
    with BrowserSession(ROOT/'netunim-orders/site', 'orders-service-queue') as browser:
        browser.call('Emulation.setDeviceMetricsOverride', {'width':1440, 'height':1000, 'deviceScaleFactor':1, 'mobile':False})
        browser.evaluate(r"""(async()=>{
          Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
          const {todayISO}=await import('./assets/js/shared/calendar.js');
          const common={openedAt:'2026-11-01',description:'דלת הארון אינה נסגרת היטב. יש לתאם הגעת טכנאי.',phone:'050-1234567',address:'רחוב הדוגמה 12, ירושלים'};
          state=normalizeState({version:4,serviceCalls:[
            {...common,id:'urgent',customerName:'משפחת כהן',orderNumber:'1042',assignee:'דוד',nextFollowUp:todayISO(),escalated:true,note:'לתאם עם הלקוח לפני הגעה',source:{sheet:'שירות',rows:[8]}},
            {...common,id:'late',customerName:'משפחת לוי',orderNumber:'1087',assignee:'משה',nextFollowUp:'2020-01-01',sent:true},
            {...common,id:'future',customerName:'משפחת ישראלי',orderNumber:'1103',assignee:'דוד',nextFollowUp:'2099-01-01',followUp:true},
            {...common,id:'plain',customerName:'משפחת אברהם',orderNumber:'1129'},
            {...common,id:'closed',customerName:'משפחת מזרחי',closed:true,closedAt:'2026-11-15T10:00:00Z',nextFollowUp:'2020-01-01'}
          ]});
          const head=await mainStorageV2.cloudState();
          await mainStorageV2.replaceLocalAuthoritativeState(state,{boundaryId:'service-queue-fixture',expectedSeq:head.seq});
          switchView('service');return true;
        })()""")
        browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        if os.environ.get('NETUNIM_SERVICE_SCREENSHOTS'):
            output=ROOT/'.work/service-review'
            output.mkdir(parents=True,exist_ok=True)
            shot=browser.call('Page.captureScreenshot', {'format':'png'})['result']['data']
            (output/'desktop.png').write_bytes(base64.b64decode(shot))
        result=browser.evaluate(r"""(async()=>{
          const assert=(value,message)=>{if(!value)throw Error(message)};
          const el=selector=>{const node=document.querySelector(selector);assert(node,'missing '+selector);return node};
          const click=(action,id)=>el('[data-action="'+action+'"]'+(id?'[data-click-arg0="'+id+'"]':'')).click();
          const ids=()=>[...document.querySelectorAll('[data-service-bulk-id]')].map(row=>row.dataset.serviceBulkId);
          const wait=async predicate=>{const end=performance.now()+4000;while(!predicate()){if(performance.now()>end)throw Error('service update timed out');await new Promise(r=>setTimeout(r,20))}};
          const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          assert(JSON.stringify(ids())===JSON.stringify(['urgent','late','future','plain']),'all unfinished calls, priority order');
          assert(document.querySelectorAll('.service-toolbar [data-action="service-filter"]').length===3,'three meaningful views');
          assert(el('[data-service-summary="all"]').textContent==='4'&&el('[data-service-summary="due"]').textContent==='2','all and due counts');
          assert(el('.service-table').getBoundingClientRect().width<=el('.view-scroll').clientWidth,'table fits desktop');
          click('service-filter','due');assert(JSON.stringify(ids())===JSON.stringify(['urgent','late']),'today includes overdue and excludes completed');
          click('service-filter','all');const search=el('[data-input="service-search"]');search.value='משה';search.dispatchEvent(new Event('input',{bubbles:true}));
          await wait(()=>ids().join(',')==='late');assert(document.activeElement!==null,'search completed');
          search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>ids().length===4);
          click('open-service-modal-2','future');assert(el('#svcFollow').checked,'preserved follow-up flag');
          el('#svcAssignee').value='אחראי מעודכן';el('#svcNote').value='נקבע ביקור';el('#svcUrgent').checked=true;click('save-service','future');
          await wait(()=>!document.getElementById('modalBackdrop')?.classList.contains('open'));
          assert(state.serviceCalls.find(c=>c.id==='future').followUp,'edit retains flag');assert(el('[data-service-bulk-id="future"]').textContent.includes('אחראי מעודכן'),'assignee is visible');
          const close=el('[data-service-bulk-id="urgent"] [data-click-arg1="closed"]');close.focus();close.click();
          assert(!ids().includes('urgent'),'closing removes call from active queue');assert(state.serviceCalls.find(c=>c.id==='urgent').closedAt,'closure timestamp saved');
          assert(el('[data-service-summary="all"]').textContent==='3','summary refreshes after closing');assert(document.activeElement.matches('.service-customer-link'),'focus moves to next result');
          click('service-filter','closed');assert(ids().includes('urgent')&&ids().includes('closed'),'closed calls reachable');
          el('[data-service-bulk-id="urgent"] [data-click-arg1="closed"]').click();
          const reopened=state.serviceCalls.find(c=>c.id==='urgent');assert(!reopened.closed&&!reopened.closedAt,'reopen clears timestamp');assert(reopened.source.rows[0]===8,'import provenance retained');
          click('service-filter','all');click('toggle-service-bulk-mode');click('toggle-service-bulk-visible');
          assert(document.querySelectorAll('.service-row.bulk-selected-row').length===4,'select page highlights rows');assert(!el('#serviceBulkDelete').disabled,'bulk delete enabled');
          click('toggle-service-bulk-mode');assert(!document.querySelector('[data-service-bulk-check]'),'selection controls removed');
          await Promise.all([mainStorageV2.commitPromise]);
          const saved=(await mainStorageV2.recover()).state.serviceCalls;
          assert(saved.find(c=>c.id==='future').assignee==='אחראי מעודכן'&&!saved.find(c=>c.id==='urgent').closed,'changes durably saved');
          return {filters:true,search:true,editor:true,close:true,reopen:true,selection:true,persistence:true};
        })()""", timeout=30)
        browser.call('Emulation.setDeviceMetricsOverride', {'width':390, 'height':844, 'deviceScaleFactor':1, 'mobile':True})
        browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        if os.environ.get('NETUNIM_SERVICE_SCREENSHOTS'):
            shot=browser.call('Page.captureScreenshot', {'format':'png'})['result']['data']
            (output/'mobile.png').write_bytes(base64.b64decode(shot))
        mobile=browser.evaluate(r"""(()=>{
          const root=document.documentElement,rows=[...document.querySelectorAll('.service-row')];
          const fits=rows.every(row=>row.getBoundingClientRect().right<=innerWidth+1&&row.getBoundingClientRect().left>=-1);
          if(root.scrollWidth>innerWidth+1||!fits)throw Error('service queue overflows mobile viewport '+JSON.stringify({width:innerWidth,scroll:root.scrollWidth,rows:rows.map(r=>({left:r.getBoundingClientRect().left,right:r.getBoundingClientRect().right})),overflow:[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1||n.getBoundingClientRect().left< -1).slice(0,12).map(n=>[n.tagName,n.className,n.getBoundingClientRect().left,n.getBoundingClientRect().right])}));
          if(getComputedStyle(document.querySelector('.service-row')).display!=='grid')throw Error('mobile row layout missing');
          return {width:innerWidth,scrollWidth:root.scrollWidth,rows:rows.length};
        })()""")
        assert not browser.drain_serious_errors()
        print('PASS Service queue',json.dumps({**result,'mobile':mobile}))


if __name__=='__main__':
    run()
