from browser_harness import BrowserSession, ROOT
import base64

for app in ('kupa', 'orders'):
    with BrowserSession(ROOT / f'netunim-{app}/site', app+'-amount-range') as browser:
        for width in (390,1280):
            browser.call('Emulation.setDeviceMetricsOverride', {'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
            for kind in ('bank', 'credit'):
                setup = ("document.getElementById('connectScreen').style.display='none';state=normalizeState(fixture);domainRevisions.touchAll();ui.currentPage='"+kind+"';ui.expensesTab='credit';"+
                         ("bank.presentation.renderBank();" if kind == 'bank' else "credit.renderCredit();")) if app == 'kupa' else (
                             "kupaCloudReadState=fixture;state.checks=[];domainRevisions.touchAll();ui.currentView='kupa';ui.kupaSubView='"+kind+"';finance.presentation.renderKupa();")
                prefix = '' if app == 'kupa' else 'orders-'
                selector = '.bank-transactions-table' if kind == 'bank' else '.credit-detail-table'
                expression = r"""(async()=>{
                  const check=(value,message)=>{if(!value)throw Error(message)};
                  const rows=[100,200,300].map(amount=>({id:'T'+amount,status:'completed',date:'2026-11-01',processedDate:'2026-11-20',amount:-amount,
                    originalAmount:-amount,originalCurrency:'ILS',chargedAmount:-amount,chargedCurrency:'ILS',description:'movement-'+amount}));
                  const fixture={version:4,credits:[],checks:[],expenses:[],cash:[],cards:[],bank:{feed:{balance:1000,syncedAt:'2026-11-15',transactions:rows}},
                    creditSync:{version:4,profiles:[{profileId:'P',provider:'max',accounts:[{accountNumber:'C',txns:rows}]}],cardMappings:{'P:C':{included:true}}}};
                  ui.bankDateMode='all';ui.creditDetailMode='all';ui.creditView='all';
                  __SETUP__
                  const change=(side,value)=>{const input=document.querySelector('[data-change="__PREFIX____KIND__-amount-'+side+'"]');check(input,'missing range input');input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))};
                  const host=document.querySelector('.movement-search'),button=host.querySelector('[popovertarget]'),panel=host.querySelector('[popover]');
                  check(!panel.matches(':popover-open')&&panel.getBoundingClientRect().height===0,'range fields are always visible');
                  const bounds=host.getBoundingClientRect(),toggle=button.getBoundingClientRect();
                  check(bounds.width>120&&toggle.width>20,'search is not visible');
                  check(toggle.left>=bounds.left&&toggle.right<bounds.left+45,'advanced button is not at the left edge of search');
                  button.click();check(panel.matches(':popover-open'),'advanced search did not open');
                  const popup=panel.getBoundingClientRect();check(popup.left>=0&&popup.right<=innerWidth,'popup overflows viewport');
                  change('from','150');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                  check(document.querySelector('[popover]').matches(':popover-open'),'editing first bound closed the panel');
                  change('to','250');
                  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                  const text=document.querySelector('__SELECTOR__ tbody')?.textContent||'';
                  check(text.includes('movement-200')&&!text.includes('movement-100')&&!text.includes('movement-300'),'incorrect filtered table: '+text);
                  change('from','');await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));change('to','');
                  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                  check(document.querySelector('__SELECTOR__ tbody').textContent.includes('movement-100'),'clear did not restore movements');
                  check(document.documentElement.scrollWidth<=innerWidth,'horizontal page overflow');
                  return true;
                })()"""
                assert browser.evaluate(expression.replace('__SETUP__', setup).replace('__PREFIX__', prefix)
                                        .replace('__KIND__', kind).replace('__SELECTOR__', selector))
                target=ROOT/'.work/screenshots'/f'{app}-{kind}-{width}-advanced.png'
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(base64.b64decode(browser.call('Page.captureScreenshot',{'format':'png'})['result']['data']))
                browser.call('Input.dispatchKeyEvent',{'type':'keyDown','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
                browser.call('Input.dispatchKeyEvent',{'type':'keyUp','key':'Escape','code':'Escape','windowsVirtualKeyCode':27})
                assert browser.evaluate("!document.querySelector('[popover]').matches(':popover-open')")
        assert not browser.drain_serious_errors()
        print('PASS', app, 'bank/credit range actions, actual filtering and clearing')
