"""Two Chromium profiles recover V2 flights and rebases from real IndexedDB.

The remote compare-and-swap head is relayed by this harness. No production
service is contacted, and no V1 browser snapshot or outbox is installed.
"""
import json
from pathlib import Path

from browser_harness import BrowserSession, ROOT


def js(value):
    return json.dumps(value, ensure_ascii=False)


def create_journal(browser, app, *, initialize=False):
    expression = f"""(async()=>{{
      const [journalModule,schemaModule]=await Promise.all([
        import('./assets/js/shared/storage-journal.js'),
        import('./assets/js/shared/storage-v2-schema.js')
      ]);
      window.fixtureJournal=journalModule.createStorageJournal({{
        owner:{js('two-profile-' + app + ':' + app)},schema:schemaModule.STORAGE_SCHEMAS[{js(app)}],
        validate:value=>{{if(!Array.isArray(value?.notes))throw new Error('fixture_notes_invalid')}}
      }});
      if({str(initialize).lower()})await fixtureJournal.initializeCloudHead(10,
        {{notes:[{{id:'X',content:'base'}},{{id:'Y',content:'other'}}]}},
        {{appMetadata:{{storageRole:'primary',mainProjectionVersion:2}}}});
      else await fixtureJournal.open();
      const recovered=await fixtureJournal.recover(),cloud=await fixtureJournal.cloudState();
      return {{notes:recovered.state.notes,revision:cloud.base?.revision,seq:cloud.seq}};
    }})()"""
    return browser.evaluate(expression)


def edit(browser, record_id, content):
    return browser.evaluate(f"""(async()=>{{
      const current=await fixtureJournal.recover();
      const record={{...current.state.notes.find(row=>row.id==={js(record_id)}),content:{js(content)}}};
      const write=fixtureJournal.append([{{type:'put',collection:'notes',id:{js(record_id)},
        mode:'replace',record}}],{{generation:1,surface:'test.two-profile'}});
      await write.committed;
      const flight=await fixtureJournal.materializeFlight({{
        operationId:'flight-'+{js(record_id)}+'-'+{js(content)},baseRevision:10
      }});
      return {{flight,notes:(await fixtureJournal.recover()).state.notes}};
    }})()""")


def run(app, same_record):
    label=f'{app}-v2-two-profile-'+('conflict' if same_record else 'merge')
    with BrowserSession(ROOT / f'netunim-{app}/site', label+'-A') as a, \
         BrowserSession(ROOT / f'netunim-{app}/site', label+'-B') as b:
        assert create_journal(a, app, initialize=True)['revision']==10
        assert create_journal(b, app, initialize=True)['revision']==10
        for browser in (a,b):
            browser.evaluate("Object.defineProperty(navigator,'onLine',{value:false,configurable:true});true")

        pending=edit(a,'X','A')
        assert pending['flight']['snapshot']['notes'][0]['content']=='A'
        first_id=pending['flight']['operationId']
        a.evaluate("window.dispatchEvent(new Event('pagehide'));true")
        a._navigate()
        a.evaluate("appReady.then(()=>true)")
        recovered=create_journal(a, app)
        assert recovered['notes'][0]['content']=='A' and recovered['seq']==1,recovered
        stored=a.evaluate("fixtureJournal.cloudState().then(c=>({id:c.flight?.operationId,pending:c.pending}))")
        assert stored=={'id':first_id,'pending':True},stored

        b_record='X' if same_record else 'Y'
        b_pending=edit(b,b_record,'B')
        head={'revision':11,'state':b_pending['flight']['snapshot']}
        b.evaluate("Object.defineProperty(navigator,'onLine',{value:true,configurable:true});true")
        b_ack=b.evaluate(f"""(async()=>{{
          await fixtureJournal.acknowledge({js(b_pending['flight']['operationId'])},
            11,{js(head['state'])});
          const cloud=await fixtureJournal.cloudState();
          return {{revision:cloud.base.revision,pending:cloud.pending,flight:cloud.flight}};
        }})()""")
        assert b_ack=={'revision':11,'pending':False,'flight':None},b_ack

        if same_record:
            a.evaluate("Object.defineProperty(navigator,'onLine',{value:true,configurable:true});true")
            result=a.evaluate(f"""(async()=>{{
              const before=await fixtureJournal.cloudState();
              await fixtureJournal.rejectAndRebase({js(first_id)},11,{js(head['state'])},{{
                expectedSeq:before.seq,checkpointState:{{notes:[{{id:'X',content:'A'}},
                  {{id:'Y',content:'other'}}]}},control:{{conflict:{{kind:'same-record',id:'X'}}}}
              }});
              const state=await fixtureJournal.cloudState();
              return {{local:(await fixtureJournal.recover()).state.notes[0].content,
                remote:state.base.state.notes[0].content,conflict:state.control.conflict.kind,
                flight:state.flight}};
            }})()""")
            assert result=={'local':'A','remote':'B','conflict':'same-record','flight':None},result
            a._navigate()
            a.evaluate("appReady.then(()=>true)")
            assert create_journal(a,app)['notes'][0]['content']=='A'
            assert a.evaluate("fixtureJournal.cloudState().then(c=>c.control.conflict.kind)")=='same-record'
        else:
            a.evaluate("Object.defineProperty(navigator,'onLine',{value:true,configurable:true});true")
            merged={'notes':[{'id':'X','content':'A'},{'id':'Y','content':'B'}]}
            result=a.evaluate(f"""(async()=>{{
              const before=await fixtureJournal.cloudState();
              await fixtureJournal.rejectAndRebase({js(first_id)},11,{js(head['state'])},{{
                expectedSeq:before.seq,checkpointState:{js(merged)}
              }});
              const rebased=await fixtureJournal.materializeFlight({{
                operationId:'merged-flight',baseRevision:11
              }});
              await fixtureJournal.acknowledge(rebased.operationId,12,rebased.snapshot);
              const cloud=await fixtureJournal.cloudState();
              return {{notes:(await fixtureJournal.recover()).state.notes,
                snapshot:rebased.snapshot,revision:cloud.base.revision,pending:cloud.pending}};
            }})()""")
            assert result['notes']==merged['notes'] and result['snapshot']==merged,result
            assert result['revision']==12 and result['pending'] is False,result
            a._navigate()
            a.evaluate("appReady.then(()=>true)")
            assert create_journal(a,app)['notes']==merged['notes']
            b.evaluate(f"fixtureJournal.adoptCloudHead(12,{js(merged)},{js(merged)})")
            b._navigate()
            b.evaluate("appReady.then(()=>true)")
            assert create_journal(b,app)['notes']==merged['notes']

        legacy_key='orders.management.state.v1' if app=='orders' else 'kupa.browser.state.v1'
        legacy_outbox='orders.supabase.pending.v1' if app=='orders' else 'kupa.cloud.pending.local.v1'
        for browser in (a,b):
            assert browser.evaluate(f"localStorage.getItem({js(legacy_key)})") is None
            assert browser.evaluate(f"localStorage.getItem({js(legacy_outbox)})") is None
            assert not browser.drain_serious_errors()
        print('PASS',label,'V2 IndexedDB flight/rebase/ACK/restart across two profiles')


def run_rapid_fields(app, count):
    fixture=(Path(__file__).parent/'fixtures/rapid-profile-fields.mjs').read_text(encoding='utf-8').replace('export async function','async function')
    def setup(browser, initialize):
        return browser.evaluate('(async()=>{'+fixture+';window.rapid=await createRapidProfile('+js(app)+','+str(initialize).lower()+');return rapid.state()})()',timeout=30)
    def restart(browser):
        browser._navigate();browser.evaluate('appReady.then(()=>true)');return setup(browser,False)
    with BrowserSession(ROOT/f'netunim-{app}/site',app+'-rapid-fields-A') as a, \
         BrowserSession(ROOT/f'netunim-{app}/site',app+'-rapid-fields-B') as b:
        setup(a,True);setup(b,True)
        first=a.evaluate(f"rapid.burst('A',{count})",timeout=60)
        second=b.evaluate(f"rapid.burst('B',{count})",timeout=60)
        collection='transactions' if app=='orders' else 'cash'
        assert first['head']['seq']==second['head']['seq']==count
        # B's server commit was accepted but its response was lost. Its profile
        # restarts with precisely the same immutable flight and operation ID.
        remote={'revision':11,'state':second['flight']['snapshot']}
        restart(b)
        assert b.evaluate('rapid.retry()')==second['flight']
        b.evaluate(f"rapid.acknowledge({js(second['flight'])},11)")
        restart(a)
        assert a.evaluate('rapid.retry()')==first['flight']
        merged=a.evaluate(f'rapid.reconcile({js(remote)})')
        assert merged['conflicts']==[]
        assert merged['flight']['operationId']!=first['flight']['operationId']
        final={'revision':12,'state':merged['flight']['snapshot']}
        a.evaluate(f"rapid.acknowledge({js(merged['flight'])},12)")
        b.evaluate(f'rapid.adopt({js(final)})')
        for browser in (a,b):
            after=restart(browser)
            assert after['state']==final['state'] and not after['cloud']['pending']
            rows=after['state'][collection];assert len(rows)==1
            assert rows[0]['note']==f'remote-{count}'
            assert rows[0]['message' if app=='orders' else 'description']==f'local-{count}'
            if app=='orders':assert rows[0]['invoiceReceived']==(count%2==0)
        # A genuine same-field contradiction remains durable after restart;
        # recording it never silently promotes either side's note to authority.
        local_conflict=a.evaluate("rapid.contradict('A')")
        remote_conflict=b.evaluate("rapid.contradict('B')")
        b.evaluate(f'rapid.acknowledge({js(remote_conflict)},13)')
        blocked=a.evaluate(f"rapid.reconcile({js({'revision':13,'state':remote_conflict['snapshot']})})")
        assert len(blocked['conflicts'])==1
        retained=restart(a)
        assert retained['cloud']['pending'] and retained['cloud']['control']['conflict']['kind']=='entity-conflict'
        assert retained['state'][collection][0]['note']=='contradiction-A'
        assert retained['cloud']['base']['state'][collection][0]['note']=='contradiction-B'
        assert retained['seq']==count+1 and local_conflict['startSeq']==count+1
        for browser in (a,b):assert not browser.drain_serious_errors()
        print(f'PASS {app}: {count*2} rapid same-record edits across isolated profiles, immutable lost ACK, real business merge, restart convergence and durable contradiction',flush=True)


def run_order_additions(same_supplier):
    fixture=(Path(__file__).parent/'fixtures/rapid-profile-fields.mjs').read_text(encoding='utf-8').replace('export async function','async function')
    def setup(browser, initialize):
        return browser.evaluate('(async()=>{'+fixture+';window.rapid=await createRapidProfile("orders",'+str(initialize).lower()+');return rapid.state()})()')
    with BrowserSession(ROOT/'netunim-orders/site','order-additions-A') as a, \
         BrowserSession(ROOT/'netunim-orders/site','order-additions-B') as b:
        setup(a,True);setup(b,True)
        first=a.evaluate('rapid.addTransaction("A",'+js('S' if same_supplier else 'SA')+')')
        second=b.evaluate('rapid.addTransaction("B",'+js('S' if same_supplier else 'SB')+')')
        # Crash before the local ACK: retain the original flight, then merge
        # through the actual order topology and persist the rebased checkpoint.
        a._navigate();a.evaluate('appReady.then(()=>true)');setup(a,False)
        assert a.evaluate('rapid.retry()')==first
        b.evaluate(f'rapid.acknowledge({js(second)},11)')
        merged=a.evaluate(f'rapid.reconcile({js({"revision":11,"state":second["snapshot"]})})')
        assert merged['conflicts']==[],merged
        final={'revision':12,'state':merged['flight']['snapshot']}
        a.evaluate(f'rapid.acknowledge({js(merged["flight"])},12)')
        b.evaluate(f'rapid.adopt({js(final)})')
        for browser in (a,b):
            browser._navigate();browser.evaluate('appReady.then(()=>true)');after=setup(browser,False)
            assert after['state']==final['state'] and not after['cloud']['pending']
            rows=after['state']['transactions'];assert {row['id'] for row in rows}=={'R','A','B'}
            for supplier in {row['supplierId'] for row in rows}:
                assert sorted(row['sequence'] for row in rows if row['supplierId']==supplier)==list(range(1,1+sum(row['supplierId']==supplier for row in rows)))
            assert not browser.drain_serious_errors()
        print('PASS orders: concurrent additions, restart and two-profile convergence; same supplier=',same_supplier,flush=True)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser()
    parser.add_argument('--rapid-only',action='store_true')
    parser.add_argument('--rapid-count',type=int,default=1000)
    options=parser.parse_args()
    if not 1<=options.rapid_count<=2000:parser.error('rapid-count must be between 1 and 2000')
    for app in ('orders','kupa'):
        if not options.rapid_only:
            for same_record in (True,False):run(app,same_record)
        run_rapid_fields(app,options.rapid_count)
    for same_supplier in (False,True):run_order_additions(same_supplier)
