from browser_harness import BrowserSession, ROOT


def run_credit_detail(app):
    with BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-credit-detail') as browser:
        browser.call('Emulation.setDeviceMetricsOverride', {'width': 1600, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
        setup = "state=normalizeState(fixture);ui.currentPage='credit';ui.expensesTab='credit';domainsCreditView.renderCredit();" if app == 'kupa' else "kupaCloudReadState=fixture;state.checks=[];ui.currentView='kupa';ui.kupaSubView='credit';domainsFinanceView.renderKupa();"
        prefix = '' if app == 'kupa' else 'orders-'
        browser.evaluate(r"""(()=>{
          const OriginalDate=Date;
          globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:['2026-09-16T12:00:00Z']))}static now(){return new OriginalDate('2026-09-16T12:00:00Z').getTime()}};
          const account=(id,day,count)=>({accountNumber:id,txns:['2026-08','2026-09','2026-10','2026-11'].flatMap(month=>Array.from({length:count},(_,i)=>({id:`${id}-${month}-${i}`,status:'completed',processedDate:`${month}-${day}`,transactionDate:'2026-08-01',chargedAmount:-10,chargedCurrency:'ILS',description:`${id} ${month} transaction ${i}`})))});
          const fixture={version:4,credits:[],checks:[],expenses:[],cash:[],cards:[],bank:{},creditSync:{version:4,profiles:[{profileId:'test',provider:'max',accounts:[account('a','10',70),account('b','10',2),account('c','15',1)]}],cardMappings:{'test:a':{included:true,cardName:'א ראשון באלפבית',sortOrder:2},'test:b':{included:true,cardName:'ב קודם לפי בחירה',sortOrder:1},'test:c':{included:true,cardName:'ג חיוב 15',sortOrder:1}}}};
        """ + setup + "return true;})()")
        browser.evaluate(f"""(async()=>{{
          const frames=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          await frames();
          const check=(value,message)=>{{if(!value)throw new Error(message)}},region=()=>document.querySelector('.credit-detail-section'),rows=()=>[...region().querySelectorAll('tbody tr')].filter(row=>row.children.length>1);
          check(region().querySelector('.credit-history-menu [data-click-arg0="2026-09"]'),'September was not moved to history');
          check(!region().querySelector('.credit-future-menu [data-click-arg0="2026-09"]'),'September still appears in future');
          check(region().querySelector('.credit-future-menu [data-click-arg0="2026-10"]'),'October missing from future');
          check(rows()[0].textContent.includes('ב קודם לפי בחירה'),'Custom card order was ignored');
          const menu=region().querySelector('.credit-date-filter'),future=region().querySelector('.credit-future-menu');
          check(menu.getBoundingClientRect().right<=future.getBoundingClientRect().left+1,'Date filter must be left of future charges in RTL desktop layout');
          region().querySelector('[data-action="{prefix}credit-detail-upcoming-day"][data-click-arg0="15"]').click();
          await frames();
          check(rows().length===1,'15 day filter should leave one row');
          let scroller=region().parentElement;
          while(scroller&&!(scroller.scrollHeight>scroller.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)))scroller=scroller.parentElement;
          scroller=scroller||document.scrollingElement;scroller.scrollTop=scroller.scrollHeight;await frames();
          const anchor=()=>region().querySelector('[data-action="{prefix}credit-detail-upcoming-day"][data-click-arg0="10"]');
          // Put the actual 10/15 control in view while keeping the short list at
          // its bottom; switching to the long list must preserve this offset.
          anchor().scrollIntoView({{block:'nearest'}});await frames();
          const before=anchor().getBoundingClientRect().top,top=scroller.scrollTop;
          anchor().click();await frames();
          check(rows().length===72,'10 day filter should show the long list');
          check(Math.abs(anchor().getBoundingClientRect().top-before)<2,'Day filter jumped away from controls: '+before+' -> '+anchor().getBoundingClientRect().top);
          check(Math.abs(scroller.scrollTop-top)<2,'Day filter restored the bottom instead of the position');
          const range=region().querySelector('.credit-date-filter');range.querySelector('summary').click();await frames();
          range.querySelector('[data-credit-date="from"]').value='2026-09-15';range.querySelector('[data-credit-date="to"]').value='2026-10-10';
          range.querySelector('[data-action="{prefix}credit-date-apply"]').click();await frames();
          check(rows().length===73,'Range must include both boundaries across September/October');
          check(rows().some(row=>row.textContent.includes('c 2026-09')),'Missing September 15 boundary');
          check(!rows().some(row=>row.textContent.includes('c 2026-10')),'Range includes October 15 beyond end');
          check(!rows().some(row=>row.textContent.includes('2026-11 transaction')),'Range includes November');
          region().querySelector('[data-action="{prefix}credit-detail-upcoming"]').click();await frames();
          check(!region().querySelector('.credit-date-filter.active'),'Upcoming should exit the date range');
          check(rows().length===73,'Upcoming should restore October rows');
          return true;
        }})()""")
        for width in (1280, 390):
            browser.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            browser.evaluate(f"""(()=>{{
              const region=document.querySelector('.credit-detail-section'),title=region.querySelector('.credit-detail-title-row');
              if(title.scrollWidth>title.clientWidth+2)throw new Error('Credit controls overflow at {width}');
              if(!document.querySelector('[data-change="{'set-credit-card' if app == 'kupa' else 'orders-credit'}-sort-order"]'))throw new Error('Missing card order preference');
              return true;
            }})()""")
        errors=browser.drain_serious_errors()
        assert not errors, errors
        print(f'{app}: credit period menus, inclusive date range, custom order and short-to-long scroll pass in Chromium')
