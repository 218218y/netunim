"""Both production entries, native IDB durability and RTL/mobile calculator UI."""
import base64
import json
from browser_harness import BrowserSession, ROOT

SETUP=r"""(async()=>{
  await appReady;
  const app=__APP__,scope={owner:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',epoch:1},cloud=new Map(),ops=new Map(),listeners=new Set(),history=[];
  window.taxFixture={scope,cloud,ops,listeners,online:true,drop:false};
  const request=async(path,options)=>{
    options.assertRequestScope?.();if(!taxFixture.online)throw Error('offline');
    if(options.method==='POST'){
      const b=JSON.parse(options.body),key=scope.owner+'/'+b.p_document_name;let ack=ops.get(scope.owner+'/'+b.p_operation_id);
      if(!ack){const head=cloud.get(key);if((head?.revision??0)!==b.p_expected_revision)return new Response(JSON.stringify({code:'40001'}),{status:409});ack={owner_id:scope.owner,document_name:b.p_document_name,revision:b.p_expected_revision+1,state:structuredClone(b.p_state),operation_id:b.p_operation_id,operation_replayed:false};cloud.set(key,ack);ops.set(scope.owner+'/'+b.p_operation_id,ack);}else ack={...ack,operation_replayed:true};
      history.push({...structuredClone(ack),created_at:'2026-10-19T12:00:00Z'});
      if(taxFixture.drop){taxFixture.drop=false;throw Error('lost ACK');}return new Response(JSON.stringify(ack));
    }
    const url=new URL('https://test'+path),owner=url.searchParams.get('owner_id')?.slice(3),name=url.searchParams.get('document_name')?.slice(3);
    if(path.includes('tax_calculator_history'))return new Response(JSON.stringify(history.filter(r=>r.owner_id===owner&&r.document_name===name).reverse().slice(0,40)));
    if(!name)return new Response(JSON.stringify([...cloud.values()].filter(r=>r.owner_id===owner).map(r=>({document_name:r.document_name,revision:r.revision}))));
    const row=cloud.get(owner+'/'+name);return new Response(JSON.stringify(row?[row]:[]));
  };
  cloudAuth.getAccountScope=()=>({...scope});cloudAuth.subscribeAccountScope=fn=>{listeners.add(fn);return ()=>listeners.delete(fn);};
  if(app==='orders')cloudAuth.supaFetch=request;else cloudAuth.supaRest=request;
  tab.primaryTab=true;
  const baseline=JSON.stringify(model.state);
  // A fresh calculator release discards its former local journal, not business data.
  await new Promise((resolve,reject)=>{const q=indexedDB.open('netunim-tax-calculator-v1',1);q.onupgradeneeded=()=>q.result.createObjectStore('documents');q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('documents','readwrite');tx.objectStore('documents').put({obsolete:true},'old-owner/year/2026');tx.oncomplete=()=>{db.close();resolve()};tx.onabort=()=>reject(tx.error)};});
  if(app==='orders'){ui.kupaSubView='summary';uiNavigation.switchView('kupa');}else uiNavigation.setPage('dashboard');
  if(!document.querySelector('[data-action="tax-open"]'))throw Error('entry missing');
  await taxCalculator.open();
  const cleanJournal=await new Promise((resolve,reject)=>{const q=indexedDB.open('netunim-tax-calculator-v1',2);q.onerror=()=>reject(q.error);q.onsuccess=()=>{const db=q.result,tx=db.transaction('documents');const r=tx.objectStore('documents').get('old-owner/year/2026');tx.oncomplete=()=>{db.close();resolve(r.result===undefined)};tx.onabort=()=>reject(tx.error)};});
  if(!cleanJournal)throw Error('obsolete calculator journal was retained');
  if(document.querySelector('[data-tax-message]').offsetHeight!==0)throw Error('empty error strip visible');
  if(document.querySelectorAll('.tax-tabs button').length!==8)throw Error('calculator tabs missing');
  await taxCalculator.command('tax-year',{value:'2026'});
  await taxCalculator.command('tax-tab',{dataset:{tab:'business'}});
  const input=document.querySelector('[data-field="revenue"]');input.value='180000';
  await taxCalculator.command('tax-input',input);await taxCalculator.command('tax-save');await taxCalculator.command('tax-sync');
  const row=cloud.get(scope.owner+'/year/2026');if(row.state.revenue!==18000000)throw Error('wrong cloud amount');
  await taxCalculator.command('tax-tab',{dataset:{tab:'family'}});
  document.getElementById('tax-new-child').value='2020-05-01';await taxCalculator.command('tax-add-child');
  const approved=document.querySelector('[data-field="approvedDiscount"]');approved.value='0';await taxCalculator.command('tax-input',approved);await taxCalculator.command('tax-save');await taxCalculator.command('tax-sync');
  if(cloud.get(scope.owner+'/year/2026').state.profile.children.length!==1)throw Error('child lost');
  taxFixture.online=false;const arnona=document.querySelector('[data-field="arnonaAnnual"]');arnona.value='6000';await taxCalculator.command('tax-input',arnona);await taxCalculator.command('tax-save');await taxCalculator.command('tax-sync');
  const {createTaxStore}=await import('./assets/js/shared/tax-calculator/store.js');const {assertDocument}=await import('./assets/js/shared/tax-calculator/contracts.js');const store=createTaxStore({decodeState:assertDocument});
  const durable=await store.read(scope.owner,'year/2026');if(durable.draft.arnonaAnnual!==600000)throw Error('offline data not durable');
  taxFixture.online=true;await taxCalculator.command('tax-sync');
  uiModal.confirmDialog=async()=>true;
  await taxCalculator.command('tax-tab',{dataset:{tab:'rules'}});
  const vat=document.querySelector('[data-field="groups.vat.values.rate"]');vat.value='19';await taxCalculator.command('tax-rule-input',vat);
  await taxCalculator.command('tax-review-group',{dataset:{group:'vat'}});await taxCalculator.command('tax-publish-rules');await taxCalculator.command('tax-sync');
  const pinned=cloud.get(scope.owner+'/year/2026').state.rules;
  if(pinned.version==='2026.1'||pinned.groups.vat.values.rate!==1900||pinned.groups.vat.checkedBy!==scope.owner)throw Error('rules publication/reviewer missing');
  await taxCalculator.command('tax-tab',{dataset:{tab:'recovery'}});await taxCalculator.command('tax-history');await taxCalculator.command('tax-preview-history',{dataset:{index:'0'}});
  if(!document.querySelector('[data-action="tax-accept-preview"]'))throw Error('restore preview missing');
  await taxCalculator.command('tax-accept-preview');await taxCalculator.command('tax-sync');
  await taxCalculator.command('tax-year',{value:'2027'});await taxCalculator.command('tax-tab',{dataset:{tab:'business'}});
  if(document.querySelector('[data-field="revenue"]').value!=='')throw Error('new year copied income');
  if(!document.querySelector('.tax-warning'))throw Error('unreviewed year has no warning');
  await taxCalculator.command('tax-year',{value:'2026'});await taxCalculator.command('tax-tab',{dataset:{tab:'summary'}});
  if(!document.querySelector('.tax-results'))throw Error('summary missing');
  window.taxBaseline=baseline;
  if(JSON.stringify(model.state)!==baseline)throw Error('calculator changed existing business state');
  if(parseFloat(getComputedStyle(document.querySelector('.tax-hero h1')).fontSize)>18)throw Error('oversized calculator heading');
  return {tabs:8,cloud:cloud.size,offline:true,snapshot:true};
})()"""

for app in ['orders','kupa']:
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-tax') as browser:
        result=browser.evaluate(SETUP.replace('__APP__',json.dumps(app)),timeout=45)
        assert result['offline'] and result['snapshot'],result
        for width in [320,393,768,1280]:
            browser.call('Emulation.setDeviceMetricsOverride',{'width':width,'height':900,'deviceScaleFactor':1,'mobile':False})
            layout=browser.evaluate("(async()=>{await new Promise(requestAnimationFrame);const root=document.querySelector('.tax-page'),r=root.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,dir:getComputedStyle(root).direction};})()")
            assert layout['left']>=-1 and layout['right']<=layout['width']+1 and layout['dir']=='rtl',layout
            for tab in ['summary','family','audit']:
                browser.evaluate("taxCalculator.command('tax-tab',{dataset:{tab:"+json.dumps(tab)+"}})")
                compact=browser.evaluate("""(()=>{const root=document.querySelector('.tax-page'),hero=root.querySelector('.tax-hero'),tables=[...root.querySelectorAll('.tax-results')];return {width:root.clientWidth,scroll:root.scrollWidth,hero:hero.getBoundingClientRect().height,live:root.querySelector('.tax-live').getBoundingClientRect().height,extra:!!root.querySelector('.tax-eyebrow'),tables:tables.map(t=>({width:t.clientWidth,scroll:t.scrollWidth,wrap:t.parentElement.clientWidth}))};})()""")
                assert compact['scroll']<=compact['width']+1, (app,width,tab,compact)
                assert compact['hero']<=100 and compact['live']<=55 and not compact['extra'],compact
                for table in compact['tables']:
                    assert table['scroll']<=table['width']+1 and table['width']<=table['wrap']+1,(app,width,tab,table)
            browser.evaluate("taxCalculator.command('tax-tab',{dataset:{tab:'summary'}})")
            scroll=browser.evaluate("""(async()=>{const root=document.querySelector('.tax-page'),scroller=__APP__==='orders'?root:document.scrollingElement;scroller.scrollTop=scroller.scrollHeight;await new Promise(requestAnimationFrame);const footer=root.querySelector('footer').getBoundingClientRect(),result={bottom:footer.bottom,viewport:innerHeight,scrolled:scroller.scrollTop};scroller.scrollTop=0;return result;})()""".replace('__APP__',json.dumps(app)))
            assert scroll['scrolled']>0 and scroll['bottom']<=scroll['viewport']+1,scroll
        if app=='orders':
            image=browser.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})['result']['data']
            target=ROOT/'.work/tax-calculator-desktop.png';target.write_bytes(base64.b64decode(image))
        # Native IDB opened by a fresh synchronization owner recovers offline data.
        recovered=browser.evaluate("""(async()=>{const {createTaxSync}=await import('./assets/js/shared/tax-calculator/sync.js');const {createAnnual}=await import('./assets/js/shared/tax-calculator/contracts.js');const s=createTaxSync({accountScope:()=>({...taxFixture.scope}),request:async()=>{throw Error('offline')}});const value=await s.open('year/2026',createAnnual(2026));return {revenue:value.revenue,arnona:value.arnonaAnnual,children:value.profile.children.length};})()""")
        assert recovered=={'revenue':18000000,'arnona':600000,'children':1},recovered
        # Account invalidation clears family/financial DOM immediately.
        switched=browser.evaluate("""(async()=>{taxFixture.scope.owner='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';taxFixture.scope.epoch++;for(const fn of taxFixture.listeners)fn({...taxFixture.scope});await taxCalculator.command('tax-retry');await taxCalculator.command('tax-tab',{dataset:{tab:'family'}});return !document.querySelector('[data-field="profile.children.0.birthDate"]');})()""")
        assert switched
        assert not browser.drain_serious_errors()
        print('PASS '+app+' calculator: production navigation, native IDB/offline, year isolation, RTL/mobile, account privacy, unchanged business state')
