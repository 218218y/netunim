"""Real Morning forms/viewers: competing PDFs, modal replacement and accepted read drain."""
from browser_harness import BrowserSession, ROOT
from runtime_morning_cloud import LOCAL_CLOUD

FLOW = r"""(async()=>{
  await appReady;syncDocument.stopPolling();finance.runtime.stop();calendarRuntime.dispose();
"""+LOCAL_CLOUD+r"""
  const done=[],check=(ok,label)=>{if(!ok)throw Error(label);done.push(label)};
  const gate=()=>{let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve}};
  const {createDomainsCustomersDocuments}=await import('./assets/js/domains/customers/documents.js');
  const {createDomainsCustomersDocumentsBrowser}=await import('./assets/js/domains/customers/documents-browser.js');
  const {createMorningRequest}=await import('./assets/js/integrations/morning.js');
  const {createMorningMediaComposition}=await import('./assets/js/composition/morning-media.js');
  const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
  const {loadMorningDebtRecoveryContext}=await import('./assets/js/domains/customers/morning-debt-recovery.js');
  const db=createStorageJournalDb(),raw=async()=>JSON.stringify({main:await db.load('local:orders'),checks:await db.load('local:shared-checks'),recovery:loadMorningDebtRecoveryContext()}),before=await raw();
  const created=[],revoked=[],blobs=new Map(),calls=[],watched=new Set(),createUrl=URL.createObjectURL,revokeUrl=URL.revokeObjectURL,Observer=MutationObserver;
  let phase='',held=gate(),entered=gate();
  URL.createObjectURL=blob=>{const url=createUrl(blob);created.push(url);blobs.set(url,blob);return url};URL.revokeObjectURL=url=>{revoked.push(url);revokeUrl(url)};
  globalThis.MutationObserver=class extends Observer{observe(target,options){super.observe(target,options);if(['modal','modalBackdrop'].includes(target.id))watched.add(this)}disconnect(){watched.delete(this);super.disconnect()}};
  cloudAuth.supaFetch=async(_path,options)=>{
    options.assertRequestScope();const request=JSON.parse(options.body);calls.push(request.action);
    check(!['reserve','create','abandon_reservation'].includes(request.action),'media never sends an issuance command');
    if((phase==='draft'&&request.action==='preview')||(phase==='official'&&request.action==='document_pdf')){entered.resolve();await held.promise}
    if(request.action==='document_pdf')return new Response('%PDF-1.4\nexact official content',{headers:{'Content-Type':'application/pdf'}});
    return new Response(JSON.stringify(request.action==='preview'?{ok:true,pdfBase64:btoa('%PDF-1.4\nolder draft')}:{ok:true,configured:true,available:true,environment:'sandbox'}));
  };
  const request=createMorningRequest({operationScope:fixtureMorningScope,supaFetch:(...args)=>cloudAuth.supaFetch(...args)});
  const ports={operationScope:fixtureMorningScope,request,subscribeAccountScope:cloudAuth.subscribeAccountScope,modal:(...args)=>uiModal.modal(...args),toast:message=>{throw Error(message)},dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args)};
  ports.documentMedia=createMorningMediaComposition(ports);
  const browser=createDomainsCustomersDocumentsBrowser(ports),documents=createDomainsCustomersDocuments({...ports,model,documentsBrowser:browser,confirmDialog:(...args)=>uiModal.confirmDialog(...args)});
  const settle=async()=>{for(let n=0;n<8;n++)await Promise.resolve()};
  try{
    await documents.openMorningDocumentModal({initialType:305,prefill:{customerName:'Exact customer',amount:42}});
    document.getElementById('morningDescription').value='Exact invoice';
    phase='draft';const draft=documents.previewMorningDocument();await entered.promise;
    check(await browser.viewDocument('official-document')===true,'later official request publishes in the actual issuance iframe');
    const frame=document.getElementById('morningPreviewFrame'),official=frame.src;
    check((await blobs.get(official).text()).includes('exact official content'),'native viewer Blob retains exact provider bytes');
    held.resolve();await draft;await browser.runtime.drain();
    check(frame.src===official&&!revoked.includes(official),'held draft cannot replace or revoke the later official source');
    check(document.getElementById('morningPreviewNote').textContent.includes('מסמך רשמי'),'official PDF presentation remains authoritative');
    uiModal.closeModal();await settle();
    check(revoked.includes(official)&&!frame.hasAttribute('src')&&watched.size===0,'native modal close releases source and observer without another request');
    phase='official';held=gate();entered=gate();const viewing=browser.viewDocument('old-document');await entered.promise;
    uiModal.modal('Other capability','<p id="other-capability">retained other content</p>');held.resolve();
    check(await viewing===false&&document.getElementById('other-capability')?.textContent==='retained other content','delayed standalone PDF cannot steal a newer native modal');
    check(watched.size===0,'replaced modal retains no PDF observation');
    held=gate();entered=gate();const closing=browser.viewDocument('accepted-document');await entered.promise;
    browser.dispose();let drained=false;const draining=browser.runtime.drain().then(()=>{drained=true});await settle();
    check(!drained&&browser.runtime.isPending(),'disposal retains accepted native provider work for drain');
    held.resolve();check(await closing===false,'closed provider completion cannot publish');await draining;
    check(!browser.runtime.isPending()&&watched.size===0,'drain settles all accepted read ownership and observers');
    check(created.every(url=>revoked.includes(url)),'all owned native Blob sources have been released');
    check(await raw()===before,'Main Shared and Morning recovery stores remain exact');
  }finally{held.resolve();documents.dispose();browser.dispose();URL.createObjectURL=createUrl;URL.revokeObjectURL=revokeUrl;globalThis.MutationObserver=Observer}
  return done;
})()"""

with BrowserSession(ROOT/'netunim-orders/site','morning-media-ownership') as browser:
    result=browser.evaluate(FLOW,timeout=40)
    assert not browser.drain_serious_errors()
    print(f'PASS Morning media: {len(result)} native modal/Blob/read-drain and retained-journal assertions')
