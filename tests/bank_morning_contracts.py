from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'netunim-orders/site/assets/js'
MIGRATION=ROOT/'supabase/migrations/20260922043000_bank_morning_documents.sql'
UPGRADE=ROOT/'netunim-orders/supabase/bank_morning_documents_v1_upgrade.sql'
SETUP=ROOT/'netunim-orders/supabase/setup.sql'
MORNING_SQL=ROOT/'netunim-orders/supabase/morning_documents.sql'
EDGE=ROOT/'netunim-orders/supabase/functions/morning-documents/index.ts'
DOCS=ROOT/'netunim-orders/MORNING_SETUP.md'
errors=[]

def ok(condition,message):
    print(('PASS ' if condition else 'FAIL ')+message)
    if not condition: errors.append(message)

migration=MIGRATION.read_text(encoding='utf-8')
upgrade=UPGRADE.read_text(encoding='utf-8')
setup=SETUP.read_text(encoding='utf-8')
sql=MORNING_SQL.read_text(encoding='utf-8')
edge=EDGE.read_text(encoding='utf-8')
bank=(SITE/'domains/finance/bank-morning.js').read_text(encoding='utf-8')
bank_view=(SITE/'domains/finance/bank-morning-view.js').read_text(encoding='utf-8')
documents=(SITE/'domains/customers/documents.js').read_text(encoding='utf-8')
payments=(SITE/'domains/customers/morning-payments.js').read_text(encoding='utf-8')
recovery=(SITE/'domains/customers/morning-debt-recovery.js').read_text(encoding='utf-8')
transport=(SITE/'cloud/transport.js').read_text(encoding='utf-8')
bank_feed=(SITE/'domains/finance/bank-feed.js').read_text(encoding='utf-8')
controller=(SITE/'domains/finance/controller.js').read_text(encoding='utf-8')
docs=DOCS.read_text(encoding='utf-8')

ok(migration==upgrade,'Bank Morning migration and manual upgrade are byte-for-byte identical')
ok('add column if not exists handled_at timestamptz' in migration and 'handled_at timestamptz' in setup,
   'Handled state is durable in both upgrade and fresh-install schemas')
ok("b.account_role='business' and b.status='completed'" in migration and "b.account_role='business' and b.status='completed'" in setup,
   'Handled RPC enforces owned finalized business-bank rows on the server')
ok('create table if not exists public.bank_transaction_document_links' in migration and 'references public.morning_document_operations(operation_id) on delete restrict' in migration and 'references public.bank_transactions' not in migration,
   'Verified document link survives bank-retention cleanup and cannot erase Morning ledger evidence')
ok('list_bank_morning_document_links' not in setup and 'bank_transaction_document_links' not in setup,
   'Base Orders setup does not depend on Morning-only link tables; Morning schema owns that boundary')
ok('list_bank_morning_document_links' in migration and "l.owner_id=auth.uid()" in migration and "b.account_role='business'" in migration and 'readBankMorningDocumentLinks' in transport and 'documentLinks:links.get(Number(x.id))||[]' in transport,
   'Verified bank/Morning links are read back efficiently for the owned business account')
ok('handledAt:cleanIso(row.handledAt)' in bank_feed and 'documentLinks:normalizeMorningDocumentLinks(row.documentLinks)' in bank_feed,
   'Bank feed normalization preserves durable handled state and verified document links across rerenders')
ok("v_op.state<>'created'" in migration and 'v_op.verified_at is null' in migration and "v_tx.status<>'completed'" in migration and "v_tx.account_role<>'business'" in migration,
   'Service-only bank/document linker requires a canonically verified document and an eligible finalized credit')
ok("source_kind text not null default 'standalone'" in migration and "source_kind in ('standalone','debt','bank')" in migration and 'source_bank_transaction_id bigint' in migration,
   'Morning ledger stores explicit source routing without persisting local debt identity')
ok('debt_id' not in sql.lower() and 'source_bank_transaction_id' in sql,
   'Server issuance ledger stays debt-agnostic while retaining stable bank source identity')
ok("async function validateBankSource" in edge and ".eq('owner_id',ownerId)" in edge and "data.account_role!=='business'" in edge and "data.status!=='completed'" in edge and "Number(first.type)!==4" in edge and 'sameAmount(first.price,data.amount)' in edge,
   'Edge Function independently verifies ownership, account role, completion and exact bank-transfer payment')
ok('const raw=Array.isArray(doc.payment)' in edge and 'raw.length>12' in edge and 'totalCents!==Math.round(amount*100)' in edge and 'payload.payment=lines' in edge,
   'Multi-payment contract is bounded and exact to the agorot on the server')
ok('morning-payment-add' in payments and 'data-payment-field="price"' in payments and 'step="1"' in payments and "source?.kind==='bank'&&index===0" in payments,
   'Client payment editor supports additional receipts while locking the bank-source payment')
ok("status==='pending'" in bank and "currency!=='ILS'" in bank and "amount<=0" in bank and 'bankMorningDebtCandidates' in bank,
   'Client eligibility rejects provisional/non-credit/non-ILS rows and debt matching remains a suggestion engine')
ok('ללא קישור לחוב' in documents and 'linkBankDebt' in documents and "activeDebtId=id" in documents,
   'Debt linkage stays opt-in and requires explicit user selection')
ok('customerDebtProgressData' in bank and 'progress.paymentComplete&&progress.invoiceComplete' in bank and 'remainingPaymentMagnitude' in bank and 'progress.paymentComplete&&progress.invoiceComplete' in documents,
   'Debt suggestions exclude completed debts and compare bank credits to the current payment remainder')
ok('documentId:String(row.document_id' in edge and 'onBankDocumentVerified(Number(context.bankTransactionId),bankLink)' in documents and 'row.documentLinks=[entry' in controller,
   'Verified bank documents are projected immediately into the local row without waiting for a later bank sync')
ok('pending?' in bank_view and 'canHandle=stable&&!pending' in bank_view,
   'Provisional bank rows cannot be manually marked handled')
ok('version:2' in recovery and 'Number(value.version)===1' in recovery and 'bankTransactionId' in recovery,
   'Recovery v2 retains backward compatibility and only stores stable bank source identity')
ok('hydrateRecoveredSource' in documents and 'activeSource=hydrateRecoveredSource(sourceFromRecovery(issuanceContext),requestedSource)' in documents and 'source=hydrateRecoveredSource(recovered,activeSource)' in documents,
   'Recovered bank issuance rehydrates fresh bank amount/row details without persisting them in recovery storage')
ok('bank_link_pending' in edge and 'record_verified_bank_morning_document' in edge,
   'A verified Morning document remains fail-closed until the durable bank link is saved')
ok('PCN / ריכוז הכנסות - L' in docs and 'אינו שולח כרגע `accountingClassification`' in docs,
   'PCN behavior is documented without inventing an unverified income-document API field')

if errors:
    print(f'\nERRORS {len(errors)}')
    raise SystemExit(1)
print('\nALL BANK MORNING CONTRACTS PASSED')
