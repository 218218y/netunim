"""Real PostgreSQL authorization/CAS tests, with synthetic inputs only."""
import json
import subprocess
from pathlib import Path
from isolated_sync_postgres import IsolatedPostgres, OWNER, quote, ROOT
from supabase_authorization import auth, denied, OTHER


def run(db):
    fixtures = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', "import {createProfile,createAnnual} from './shared/tax-calculator/contracts.js';import {defaultRules} from './shared/tax-calculator/rules.js';console.log(JSON.stringify({profile:createProfile(),annual:createAnnual(2026,undefined,defaultRules()),rules:defaultRules()}));"], cwd=ROOT, encoding='utf8'))
    def expression(name, revision, value, operation, restore=None):
        return 'public.save_tax_calculator_document_v1('+','.join([quote(name),str(revision),quote(json.dumps(value)),quote(operation),'null' if restore is None else str(restore)])+')'
    def save(owner, name, revision, value, operation, restore=None):
        return json.loads(auth(db, owner, 'select to_jsonb(t) from '+expression(name,revision,value,operation,restore)+' t'))
    profile=fixtures['profile']
    one=save(OWNER,'profile',0,profile,'first')
    assert one['revision']==1 and one['owner_id']==OWNER
    assert save(OWNER,'profile',0,profile,'first')['operation_replayed'] is True
    changed={**profile,'adults':3}
    denied(db,OWNER,expression('profile',0,changed,'first'),'22023')
    denied(db,OWNER,expression('profile',0,changed,'stale'),'40001')
    two=save(OWNER,'profile',1,changed,'second')
    assert two['revision']==2
    # A replay returns the original immutable receipt, not a later head.
    assert save(OWNER,'profile',0,profile,'first')['revision']==1
    assert save(OWNER,'profile',2,profile,'restore',1)['revision']==3
    denied(db,OWNER,expression('profile',3,changed,'wrong-restore',1),'22023')
    db.sql('insert into auth.users values('+quote(OTHER)+') on conflict do nothing')
    assert auth(db,OTHER,'select count(*) from public.tax_calculator_documents')=='0'
    assert auth(db,OTHER,'select count(*) from public.tax_calculator_history')=='0'
    save(OTHER,'profile',0,changed,'first')
    assert auth(db,OWNER,"select state->>'adults' from public.tax_calculator_documents where document_name='profile'")=='1'
    denied(db,'',expression('profile',0,profile,'anonymous'),'42501')
    denied(db,OWNER,expression('profile',3,profile,'anon-role'),'42501',role='anon')
    try:
        auth(db,OWNER,"insert into public.tax_calculator_documents values('"+OWNER+"','year/2025',1,'{}',now())")
    except RuntimeError as exc:
        assert 'permission denied' in str(exc)
    else:
        raise AssertionError('direct write unexpectedly permitted')
    save(OWNER,'year/2026',0,fixtures['annual'],'annual')
    # The new field is nullable; malformed amounts are rejected on the server.
    denied(db,OWNER,expression('year/2026',1,{**fixtures['annual'],'arnonaRentReceivedMonthly':-1},'invalid-arnona-rent'),'22023')
    legacy={k:v for k,v in fixtures['annual'].items() if k!='arnonaRentReceivedMonthly'}
    # Only the current complete annual contract is accepted, including on restore.
    denied(db,OWNER,expression('year/2025',0,{**legacy,'taxYear':2025,'rules':None},'legacy-year'),'22023')
    denied(db,OWNER,expression('year/2026',1,{**fixtures['annual'],'schema':1},'legacy-schema'),'22023')
    denied(db,OWNER,expression('year/2026',1,{**fixtures['annual'],'rentEligible':True,'rentRoute':'auto'},'legacy-rental-fields'),'22023')
    modern={**fixtures['annual'],'arnonaRentReceivedMonthly':500000}
    save(OWNER,'year/2026',1,modern,'modern-year')
    r=fixtures['rules'];rule_name='rules/2026/'+r['version']
    save(OWNER,rule_name,0,r,'rules')
    denied(db,OWNER,expression(rule_name,1,r,'overwrite-rules'),'22023')
    denied(db,OWNER,expression('year/2026',2,fixtures['annual'],'first'),'22023')
    for field,value in [('adults',0),('adults',1.5),('city',{'html':'bad'}),('creditTrack','arbitrary'),('children',[{'id':'c','birthDate':'2026-02-31','resident':True}])]:
        denied(db,OWNER,expression('profile',3,{**profile,field:value},'bad-'+field),'22023')
    denied(db,OWNER,expression('profile',3,{**profile,'identityNumber':'unneeded'},'extra'),'22023')
    for field,value in [('revenue',-1),('revenue',1.5),('mode','unknown'),('rentMode','unknown'),('approvedDiscount',10001),('ageDate','bad')]:
        denied(db,OWNER,expression('year/2026',2,{**fixtures['annual'],field:value},'bad-annual-'+field),'22023')
    bad=json.loads(json.dumps(r));bad['groups']['vat']['values']['rate']=10001;bad['version']='bad'
    denied(db,OWNER,expression('rules/2026/bad',0,bad,'bad-rules'),'22023')
    assert auth(db,OWNER,'select count(*) from public.tax_calculator_operations') # denied by table ACL


if __name__=='__main__':
    with IsolatedPostgres(schema_files=[]) as db:
        db.sql('create schema netunim_internal')
        db.migrate((next((ROOT/'supabase/migrations').glob('*_tax_calculator.sql'))).read_text(encoding='utf8'))
        db.migrate((ROOT/'supabase/migrations/20261019064633_tax_arnona_assessment_income.sql').read_text(encoding='utf8'))
        # The ledger is intentionally unreadable, including to its owner.
        try:
            run(db)
        except RuntimeError as exc:
            if 'permission denied for table tax_calculator_operations' not in str(exc):raise
    print('PASS calculator SQL: RLS, validation, CAS, replay, restore, immutable rules and two users')
