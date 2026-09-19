"""Independent workbook migration, authorization, fencing and backup isolation."""
import copy
import json
from isolated_sync_postgres import IsolatedPostgres, ROOT, OWNER, quote


def run():
    files=sorted((ROOT/'supabase/migrations').glob('*.sql'))
    migration_name='20260917180000_independent_spreadsheet_documents.sql'
    matches=[path for path in files if path.name==migration_name]
    assert len(matches)==1, f'Expected exactly one {migration_name}, found {len(matches)}'
    migration=matches[0]
    migration_index=files.index(migration)
    book={'version':2,'sheets':[{'id':'S','name':'Workbook'}],
          'columns':[{'id':'C','sheetId':'S','title':'Amount','type':'number','width':90}],
          'rows':[{'id':'R','sheetId':'S','cells':{'C':'12'},'createdAt':'','updatedAt':''}]}
    main={'credits':[],'cash':[],'rights':[],'notes':[],'expenses':[],'cards':[],'bank':{'adjustments':[]},'notesSheet':book}
    orders={key:[] for key in ('suppliers','transactions','customerDebts','customerOrders','serviceCalls','notes','inventoryItems','inventoryCategoryOrder','inventoryEvents','warehouseOrders')}
    orders['notesSheet']=book
    with IsolatedPostgres(schema_files=files[:migration_index]) as db:
        for domain,state,name in [('kupa',main,'main'),('orders',orders,'suppliers')]:
            rpc='save_kupa_document_v5' if domain=='kupa' else 'save_order_management_document_v5'
            db.rpc(rpc,dict(p_document_name=name,p_expected_revision=0,p_state=state,p_operation_id='migration-seed',p_delete_intents={},p_audit={}))
        db.migrate(migration.read_text(encoding='utf8'))
        for table,name in [('kupa_documents','main'),('order_management_documents','suppliers')]:
            head=db.head(table,name)
            assert head['revision']==2 and 'notesSheet' not in head['state'] and head['state']['notesWorkbookExternal']==1
        assert json.loads(db.auth_sql("select state from public.spreadsheet_documents where domain='kupa'"))==book

        def save(value,revision,op,intents=None,kind='edit',domain='kupa'):
            args=[quote(domain),"'main'",str(revision),quote(json.dumps(value))+'::jsonb',quote(op),quote(json.dumps(intents or {}))+'::jsonb',quote(kind)]
            return json.loads(db.auth_sql('select row_to_json(r) from public.save_spreadsheet_document_v1('+','.join(args)+') r'))

        def rejects(fn,message):
            try:fn()
            except RuntimeError as error:assert message in str(error),str(error)
            else:raise AssertionError('Expected rejection: '+message)

        changed=copy.deepcopy(book);changed['rows'][0]['cells']['C']='24'
        assert save(changed,1,'edit-1')['revision']==2
        assert save(changed,1,'edit-1')['operation_replayed']
        rejects(lambda:save(book,1,'edit-1'),'idempotency_key_reuse')
        rejects(lambda:save(book,1,'stale'),'revision_conflict')
        assert save(changed,2,'noop')['revision']==2
        for i in range(30):
            changed['rows'][0]['cells']['C']=str(i)
            save(changed,2+i,'rapid-'+str(i))
        assert db.auth_sql("select count(*) from public.spreadsheet_backups where domain='kupa' and kind='edit'").strip()=='1'
        for invalid,message in [(None,'invalid_spreadsheet_row'),([], 'invalid_spreadsheet_row'),({'missing':'3'},'orphan_spreadsheet_cell')]:
            broken=copy.deepcopy(book);broken['rows'][0]['cells']=invalid
            rejects(lambda:save(broken,32,'bad-cells'),message)
        broken=copy.deepcopy(book);broken['columns'][0]['width']=1
        rejects(lambda:save(broken,32,'bad-width'),'invalid_spreadsheet_column')
        broken=copy.deepcopy(book);broken['rows'][0]['id']='C'
        rejects(lambda:save(broken,32,'bad-id'),'duplicate_spreadsheet_id')
        empty=copy.deepcopy(book);empty['rows']=[]
        rejects(lambda:save(empty,32,'delete-no-intent'),'spreadsheet_delete_intent_mismatch')
        rejects(lambda:save(empty,32,'delete-no-kind',{'notesSheet.rows':['R']}),'spreadsheet_delete_requires_explicit_kind')
        assert save(empty,32,'delete',{'notesSheet.rows':['R']},'delete')['revision']==33
        backup=db.auth_sql("select id from public.spreadsheet_backups where domain='kupa' and kind='migration'").strip()
        restore="select row_to_json(r) from public.restore_spreadsheet_document_v1('kupa','main',33,"+backup+",'restore-1') r"
        assert json.loads(db.auth_sql(restore))['state']==book
        assert json.loads(db.auth_sql(restore))['operation_replayed']
        assert db.head('kupa_documents','main')['revision']==2
        assert db.head('order_management_documents','suppliers')['revision']==2
        assert json.loads(db.auth_sql("select state from public.spreadsheet_documents where domain='orders'"))==book
        # Legacy business edits pass unchanged workbook copies but cannot overwrite it.
        assert db.rpc('save_kupa_document_v5',dict(p_document_name='main',p_expected_revision=2,p_state=main,p_operation_id='legacy-business',p_delete_intents={},p_audit={}))['revision']==3
        stale=copy.deepcopy(main);stale['notesSheet']['rows'][0]['cells']['C']='danger'
        rejects(lambda:db.rpc('save_kupa_document_v5',dict(p_document_name='main',p_expected_revision=3,p_state=stale,p_operation_id='legacy-sheet-edit',p_delete_intents={},p_audit={})), 'spreadsheet_upgrade_required')
        rejects(lambda:db.auth_sql("update public.spreadsheet_documents set revision=0"),'permission denied')
        other='22222222-2222-4222-8222-222222222222'
        count=db.sql("begin;set local role authenticated;set local request.jwt.claim.sub="+quote(other)+";select count(*) from public.spreadsheet_documents;rollback;")
        assert count.strip()=='0'
        rejects(lambda:db.sql("begin;set local role anon;select public.save_spreadsheet_document_v1('kupa','main',0,'{}','anonymous');rollback;"),'permission denied')
        many=copy.deepcopy(book);many['rows']=[{'id':'mass-'+str(i),'sheetId':'S','cells':{'C':str(i)}} for i in range(50)]
        save(many,34,'grow',{'notesSheet.rows':['R']},'delete')
        intents={'notesSheet.rows':[row['id'] for row in many['rows']]}
        rejects(lambda:save(empty,35,'mass-unsafe',intents,'delete'),'spreadsheet_mass_delete_requires_explicit_kind')
        assert save(empty,35,'mass-confirmed',intents,'bulk-delete')['revision']==36
        # Expired ordinary backups are pruned; migration recovery stays available.
        db.sql("update public.spreadsheet_backups set created_at=now()-interval '31 days' where domain='kupa' and kind<>'migration'")
        save(empty,36,'retention-noop')
        assert db.auth_sql("select count(*) from public.spreadsheet_backups where domain='kupa' and kind<>'migration'").strip()=='0'
        assert db.auth_sql("select count(*) from public.spreadsheet_backups where domain='kupa' and kind='migration'").strip()=='1'
    print('PASS independent workbooks: migration, RLS, validation, fencing, retry, bounded backups, restore and main-revision isolation')


if __name__=='__main__':run()
