from browser_harness import BrowserSession, ROOT
from browser_legacy_write_guard import install_business_v1_write_guard

# Instrument before the very first navigation: fresh production startup must
# create local Main + Shared V2 directly, without any business V1 write. The
# local engine has no cloud cursor; a synthetic account-style cutover marker
# would miss the birth path we need to protect before removing V1.
for app in ['kupa', 'orders']:
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-v2-zero-write',auto_navigate=False) as browser:
        install_business_v1_write_guard(browser)
        browser._navigate()
        born=browser.evaluate("""(async()=>{
          await appReady;
          const {createStorageJournalDb}=await import('./assets/js/shared/storage-journal-idb.js');
          const marker=await createStorageJournalDb().readLocalEngine('APP');
          const main=await storageShadow.cloudState(),shared=await sharedChecksV2.cloudState();
          return {marker:marker?.version,mainBase:main?.base??null,sharedBase:shared?.base??null,
            mainReady:storageShadow.primaryReady,sharedReady:sharedChecksV2.primaryReady,writes:window.__legacyWrites};
        })()""".replace('APP',app))
        assert born['marker']==2 and born['mainBase'] is None and born['sharedBase'] is None and born['mainReady'] and born['sharedReady'] and not born['writes'],born
        result=browser.evaluate("""(async()=>{
          await appReady;
          if(!storageShadow.primaryReady||!sharedChecksV2.primaryReady)throw Error('V2 cutover heads did not recover');
          const note={id:'v2-gate-note',content:'durable',createdAt:'2026-09-23',updatedAt:'2026-09-23'};
          state.notes.push(note);
          const operation={type:'put',collection:'notes',id:note.id,mode:'insert',index:state.notes.length-1,record:note};
          SAVE;
          await storageShadow.commitPromise;
          const check={id:'v2-gate-check',amount:100};state.checks.push(check);
          const checkWrite=sharedChecksV2.persist([{type:'put',collection:'checks',id:check.id,mode:'insert',index:state.checks.length-1,record:check}],{surface:'test.zero-v1'});
          await checkWrite.committed;
          window.dispatchEvent(new Event('pagehide'));
          return {writes:window.__legacyWrites,notes:state.notes.length,checks:state.checks.length};
        })()""".replace('SAVE',"await storagePersistence.saveState('test zero V1',{domains:['notes'],operations:[operation],surface:'test.zero-v1'})" if app=='kupa' else "storagePersistence.scheduleSave('test zero V1',{domains:['notes'],operations:[operation],surface:'test.zero-v1'})"))
        assert not result['writes'],result
        browser._navigate()
        recovered=browser.evaluate("""(async()=>{await appReady;return {writes:window.__legacyWrites,note:state.notes.find(row=>row.id==='v2-gate-note')?.content,check:state.checks.find(row=>row.id==='v2-gate-check')?.amount}})()""")
        assert not recovered['writes'] and recovered['note']=='durable' and recovered['check']==100,recovered
        errors=[error for error in browser.drain_serious_errors() if "Blocked attempt to show a 'beforeunload' confirmation panel" not in error];assert not errors,errors
        print('PASS '+app+' fresh local V2 birth, edits, pagehide and restart avoid legacy business writes')
