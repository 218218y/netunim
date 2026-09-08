"""Two isolated Chromium profiles and real LocalStorage/IndexedDB outboxes.
The remote CAS head is relayed by this harness; no production/staging service is contacted.
"""
import json
from browser_harness import BrowserSession, ROOT


def run(app, same):
    with BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-recovery-A') as a, BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-recovery-B') as b:
        initial = a.evaluate("normalizeState({version:5,businessName:'fixture',notes:[{id:'X',content:'base'},{id:'Y',content:'other'}]})")
        setup = "state=normalizeState(%s);primaryTab=true;localGeneration=0;" % json.dumps(initial)
        if app == 'orders':
            setup += "cloudRevision=10;lastCloudState=prepareCloudState(state);cloudConflictBlocked=false;cloudSaveRequested=false;localStorage.setItem(CLOUD_AUTO_KEY,'1');saveSession({access_token:'fixture',expires_at:9999999999});"
            save = "scheduleSave('fixture');clearTimeout(saveTimer);saveTimer=null;await getCloudPending();"
            reconnect = "await requestCloudSave('')"
            rpc = 'rpcSave'
            read = 'readCloud'
        else:
            setup += "dbRevision=10;lastSavedSnapshot=JSON.stringify(prepareKupaCloudState(state));connectionMode='supabase';backendReady=true;cloudConflictPending=false;"
            save = "await saveState('fixture');await getCloudPending();"
            reconnect = "await reconcileCloudPending()"
            rpc = 'rpcSaveCloud'
            read = 'readSupabaseDocument'
        for browser in (a, b):
            browser.evaluate("(()=>{"+setup+"Object.defineProperty(navigator,'onLine',{value:false,configurable:true});return true})()")
        offline = a.evaluate("(async()=>{state.notes[0].content='A';"+save+"return (await getCloudPending()).snapshot.notes})()")
        assert offline[0]['content'] == 'A'
        # Exercise the real pagehide staging hook, then a fresh module graph against the same stores.
        a.evaluate("(()=>{window.dispatchEvent(new Event('pagehide'));return true})()")
        if app == 'orders':
            a.evaluate("(()=>{localStorage.removeItem(CLOUD_AUTO_KEY);saveSession(null);return true})()")
        a._navigate()
        a.evaluate("appReady.then(()=>true)")
        recovered = a.evaluate("getCloudPending().then(p=>p.snapshot.notes)")
        assert recovered[0]['content'] == 'A', recovered
        # B publishes from its own browser while A is absent.
        b.evaluate("(async()=>{state.notes[%d].content='B';%sreturn true})()" % (0 if same else 1, save))
        normalized = b.evaluate("(async()=>{window.fixtureHead={revision:10,state:%s};return true})()" % ('prepareCloudState('+json.dumps(initial)+')' if app == 'orders' else 'prepareKupaCloudState('+json.dumps(initial)+')'))
        server = f"""{read}=async()=>clone(window.fixtureHead);
        {rpc}=async(snapshot,expected)=>{{if(expected!==window.fixtureHead.revision)return {{r:{{ok:false,status:409}},j:{{code:'PT409',message:'revision_conflict'}}}};window.fixtureHead={{revision:expected+1,state:clone(snapshot)}};return {{r:{{ok:true}},row:clone(window.fixtureHead)}}}};
        Object.defineProperty(navigator,'onLine',{{value:true,configurable:true}});"""
        b.evaluate("(async()=>{"+server+reconnect+";return true})()")
        head = b.evaluate("window.fixtureHead")
        assert head['revision'] == 11, head
        # A resumes using only its recovered outbox and B's authoritative head.
        resume = "uiStatus.reportError=()=>{};primaryTab=true;window.fixtureHead="+json.dumps(head)+";"
        if app == 'orders':
            resume += "localStorage.setItem(CLOUD_AUTO_KEY,'1');saveSession({access_token:'fixture',expires_at:9999999999});cloudConflictBlocked=false;"
        else:
            resume += "connectionMode='supabase';backendReady=true;cloudConflictPending=false;"
        result = a.evaluate("(async()=>{"+resume+server+reconnect+";const p=await getCloudPending();return {head:window.fixtureHead,pending:p}})()")
        if same:
            assert result['head'] == head, result
            assert result['pending']['conflict'], result
            assert result['pending']['snapshot']['notes'][0]['content'] == 'A', result
        else:
            assert result['pending'] is None, result
            assert [r['content'] for r in result['head']['state']['notes']] == ['A', 'B'], result
        print('PASS', app, 'two-profile offline/pagehide/restart/B/A', 'conflict' if same else 'disjoint merge')

for app in ('orders', 'kupa'):
    for same in (True, False):
        run(app, same)
