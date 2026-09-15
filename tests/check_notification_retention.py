"""Real database checks for notification-only deletion and conservative retention."""
import json
from isolated_sync_postgres import OWNER, quote


def run(db):
    def call(name, value, at='2026-09-15T12:00:00Z', requested=None):
        args=quote(json.dumps(value))+'::jsonb,'+quote(at)+'::timestamptz'
        if requested is not None:args+=','+quote(json.dumps(requested))+'::jsonb'
        return json.loads(db.sql('select netunim_internal.'+name+'('+args+')'))
    def event(id,phase='deposited',**extra):
        return dict(eventId=id,phase=phase,autoConfirmed=True,recordedAt='2026-07-17T12:00:00Z',**extra)
    quiet=event('quiet');missing=event('missing','missing');uncertain=event('uncertain');uncertain['autoConfirmed']=False
    check=dict(id='retention',name='Retention',status='הופקד - במעקב',amount=100,dueDate='2026-07-17',account='ביתי',bankMatch=quiet,bankHistory=[quiet,missing,uncertain])
    cleaned=call('check_bank_prune_history',check)
    assert [x['eventId'] for x in cleaned['bankHistory']]==['missing','uncertain']
    assert cleaned['bankHistoryHiddenEvent']=='quiet' and cleaned['bankMatch']==quiet and cleaned['status']==check['status']
    assert len(call('check_bank_prune_history',check,'2026-09-14T12:00:00Z')['bankHistory'])==3,'59 days is not 60 days'
    for phase in ('missing','returned','ambiguous','unverified','overdue'):
        current=event(phase,phase);value={**check,'bankMatch':current,'bankHistory':[current]}
        assert call('check_bank_prune_history',value,requested=[phase])['bankHistory']==[current],'Unacknowledged current incidents cannot be removed'
        value['bankReview']=phase
        assert call('check_bank_prune_history',value,requested=[phase])['bankHistory']==[]
    warned=event('warn',warning='possible_return')
    assert call('check_bank_prune_history',{**check,'bankMatch':warned,'bankHistory':[warned]})['bankHistory']==[warned]
    assert call('check_bank_record_history',cleaned)['bankHistory']==cleaned['bankHistory'],'A hidden current event must not reappear at the next bank sync'
    next_event=event('new','returned')
    resumed=call('check_bank_record_history',{**cleaned,'bankMatch':next_event})
    assert resumed['bankHistory'][-1]['eventId']=='new','A new incident is never suppressed by a previous removal'

    # The client cannot edit protected history or its hidden pointer. Only the
    # explicit request survives server validation through the normal CAS writer.
    db.sql('delete from public.shared_checks_documents;delete from netunim_internal.check_bank_claims')
    def save(rows):
        revision=db.sql("select revision from public.shared_checks_documents where owner_id="+quote(OWNER)+" and document_name='main'").strip() or '0'
        db.sql("begin;set local request.jwt.claim.sub="+quote(OWNER)+";set local role authenticated;select revision from public.save_shared_checks_document('main',"+revision+','+quote(json.dumps({'checks':rows}))+"::jsonb);commit")
    def read():return json.loads(db.sql("select state->'checks'->0 from public.shared_checks_documents where owner_id="+quote(OWNER)))
    save([{k:v for k,v in check.items() if not k.startswith('bank')}])
    recent=event('recent');recent['recordedAt']='2099-01-01T12:00:00Z'
    db.sql("begin;set local app.check_bank_reconcile='1';update public.shared_checks_documents set state="+quote(json.dumps({'checks':[{**check,'bankMatch':recent,'bankHistory':[recent]}],'bankEvents':[]}))+"::jsonb;commit")
    before=read();save([{**before,'bankHistory':[],'bankHistoryHiddenEvent':'recent'}]);assert read()['bankHistory']==[recent] and 'bankHistoryHiddenEvent' not in read()
    save([{**before,'bankHistoryDismiss':['recent','not-real']}]);removed=read()
    assert removed['bankHistory']==[] and removed['bankHistoryHiddenEvent']=='recent' and 'bankHistoryDismiss' not in removed
    save([before]);assert read()['bankHistory']==[] and read()['bankHistoryHiddenEvent']=='recent','An old browser cannot restore discarded messages'
    assert read()['bankMatch']==recent and read()['status']==before['status']
    print('PASS check notifications: exact 60-day quiet retention, unresolved incident protection, explicit removal, old clients, new incidents and unchanged check tracking')
