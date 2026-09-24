from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SITE=ROOT/'netunim-orders/site/assets/js'
MIGRATION=ROOT/'supabase/migrations/20260922043000_bank_morning_documents.sql'
UPGRADE=ROOT/'netunim-orders/supabase/bank_morning_documents_v1_upgrade.sql'
MIGRATION_V2=ROOT/'supabase/migrations/20260922050000_bank_morning_payments_v2.sql'
UPGRADE_V2=ROOT/'netunim-orders/supabase/bank_morning_payments_v2_upgrade.sql'
MIGRATION_V3=ROOT/'supabase/migrations/20260922101500_bank_handled_rpc_security_fix.sql'
UPGRADE_V3=ROOT/'netunim-orders/supabase/bank_morning_handled_rpc_v3_upgrade.sql'
BASELINE=ROOT/'supabase/migrations/20260906200304_production_schema_baseline.sql'
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
migration_v2=MIGRATION_V2.read_text(encoding='utf-8')
upgrade_v2=UPGRADE_V2.read_text(encoding='utf-8')
migration_v3=MIGRATION_V3.read_text(encoding='utf-8')
upgrade_v3=UPGRADE_V3.read_text(encoding='utf-8')
baseline=BASELINE.read_text(encoding='utf-8')
setup=SETUP.read_text(encoding='utf-8')
sql=MORNING_SQL.read_text(encoding='utf-8')
edge=EDGE.read_text(encoding='utf-8')
bank=(SITE/'domains/finance/bank-morning.js').read_text(encoding='utf-8')
bank_view=(SITE/'domains/finance/bank-morning-view.js').read_text(encoding='utf-8')
documents=(SITE/'domains/customers/documents.js').read_text(encoding='utf-8')
payments=(SITE/'domains/customers/morning-payments.js').read_text(encoding='utf-8')
debt_picker=(SITE/'domains/customers/morning-bank-debt-picker.js').read_text(encoding='utf-8')
transaction_picker=(SITE/'domains/customers/morning-bank-transaction-picker.js').read_text(encoding='utf-8')
transaction_link=(SITE/'domains/customers/morning-bank-transaction-link.js').read_text(encoding='utf-8')
composition=(SITE/'domains/customers/composition.js').read_text(encoding='utf-8')
main=(SITE/'main.js').read_text(encoding='utf-8')
banks=(SITE/'domains/customers/morning-banks.js').read_text(encoding='utf-8')
app_css=(ROOT/'netunim-orders/site/assets/app.css').read_text(encoding='utf-8')
bank_detail=(SITE/'domains/finance/bank-transaction-detail-view.js').read_text(encoding='utf-8')
bank_table=(SITE/'domains/finance/view.js').read_text(encoding='utf-8')
finance_controller=(SITE/'domains/finance/controller.js').read_text(encoding='utf-8')
recovery=(SITE/'domains/customers/morning-debt-recovery.js').read_text(encoding='utf-8')
transport=(SITE/'cloud/transport.js').read_text(encoding='utf-8')
bank_feed=(SITE/'domains/finance/bank-feed.js').read_text(encoding='utf-8')
controller=(SITE/'domains/finance/controller.js').read_text(encoding='utf-8')
editor=(SITE/'domains/customers/editor.js').read_text(encoding='utf-8')
docs=DOCS.read_text(encoding='utf-8')

ok(migration==upgrade,'Bank Morning v1 migration and manual upgrade are byte-for-byte identical')
ok(migration_v2==upgrade_v2,'Bank Morning payment v2 migration and manual upgrade are byte-for-byte identical')
ok(migration_v3==upgrade_v3,'Bank Morning handled-state v3 migration and manual upgrade are byte-for-byte identical')
ok('GRANT SELECT ON TABLE "public"."bank_transactions" TO "authenticated";' in baseline and 'GRANT UPDATE ON TABLE "public"."bank_transactions" TO "authenticated";' not in baseline and 'GRANT INSERT, UPDATE ON TABLE "public"."bank_transactions" TO "authenticated";' not in baseline,
   'Production baseline intentionally keeps authenticated browser access to bank_transactions read-only')
ok('security definer' in migration_v3.lower() and 'v_owner uuid:=auth.uid()' in migration_v3 and "b.owner_id=v_owner" in migration_v3 and "b.account_role='business'" in migration_v3 and "b.status='completed'" in migration_v3 and 'grant execute on function public.set_bank_transaction_handled(bigint,boolean) to authenticated' in migration_v3.lower() and 'grant update on table public.bank_transactions to authenticated' not in migration_v3.lower(),
   'Handled-state fix uses one narrow owner-scoped SECURITY DEFINER RPC without reopening bank table UPDATE to the browser')
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
ok("if(!d||rejectDebtRecoveryMutation(id))return" in editor and "if(rejectDebtRecoveryMutation(id))return;model.state.customerDebts=model.state.customerDebts.filter" in editor,
   'Debt deletion is blocked only while a matching Morning recovery is pending; after durable settlement no permanent bank/document debt reference prevents normal deletion')
ok("async function validateBankSource" in edge and ".eq('owner_id',ownerId)" in edge and "data.account_role!=='business'" in edge and "data.status!=='completed'" in edge and "Number(first.type)!==4" in edge and 'sameAmount(first.price,data.amount)' in edge and "Number(line.type)!==2" in edge and 'archiveCents!==Math.round(Number(data.amount)*100)' in edge and 'bankCode!==itemBank' in edge,
   'Edge Function independently verifies both exact transfer payments and structured cheque subsets against the owned finalized bank transaction')
ok('const raw=Array.isArray(doc.payment)' in edge and 'raw.length>12' in edge and 'totalCents!==Math.round(amount*100)' in edge and 'payload.payment=lines' in edge,
   'Multi-payment contract is bounded and exact to the agorot on the server')
ok('morning-payment-add' in payments and 'data-payment-field="price"' in payments and 'step="1"' in payments and 'data-payment-kinds="4"' in payments and 'data-payment-kinds="2,4"' in payments and 'data-payment-kinds="3"' in payments and 'bankDetailsLocked=bankLocked&&type===2' in payments and '.morning-payment-row [data-payment-kinds][hidden]{display:none}' in app_css,
   'Client payment editor actually hides method-irrelevant fields in CSS, keeps cheque source identity locked and lets transfer bank details be completed manually')
ok('inputmode="text" maxlength="4"' in payments and "cardNum=rawCardNum||'****'" in payments and "/^(?:\\d{4}|\\*{4})$/" in payments and "cardNum=rawCardNum||'****'" in edge and "/^(?:\\d{4}|\\*{4})$/" in edge,
   'Credit-card receipt suffix accepts either four digits or four asterisks, and both client and Edge normalize an empty value to the masked placeholder')
ok('morningBankDirectory' in payments and 'resolveMorningBank' in banks and 'findMorningBanks' in banks and 'const options=BANKS.map' in banks and 'for(const alias of bank.aliases)options.push' not in banks and "code:'12'" in banks and 'בנק הפועלים' in banks and "code:'20'" in banks and 'בנק מזרחי' in banks and "code:'9'" in banks and 'דואר פיננסים' in banks,
   'Bank selector supports code/name/alias lookup while rendering only one menu option per bank')
ok('bankTransferReferenceDetails' in bank_detail and '<b>אסמכתא:</b>' in bank_detail and 'bankTransferReferenceDetails(row)' in bank_table,
   'Ordinary bank transfers visibly surface the archived transfer reference in the transaction table')
ok("status==='pending'" in bank and "currency!=='ILS'" in bank and "amount<=0" in bank and 'bankMorningDebtCandidates' in bank,
   'Client eligibility rejects provisional/non-credit/non-ILS rows and debt matching remains a suggestion engine')
ok('morningBankDebtPickerMarkup' in documents and 'filterBankDebtPicker' in documents and 'morningBankDebtSearch' in debt_picker and 'morning-bank-debt-search' in debt_picker and 'morning-bank-debt-select' in debt_picker and 'preferredCard' in debt_picker and 'pickerRow' in debt_picker and 'linkBankDebt' in documents and "activeDebtId=id" in documents and '<select id="morningBankDebtLink"' not in debt_picker,
   'Bank debt linkage uses a dedicated searchable debt-view module with one preferred suggestion instead of a separate select list')
ok('class="morning-bank-debt-row ${selected' in debt_picker and 'data-action="morning-bank-debt-select"' in debt_picker and 'morning-bank-debt-action' not in debt_picker
   and '.morning-bank-debt-results{display:none;' in app_css and '.morning-bank-debt-search-shell:focus-within .morning-bank-debt-results{display:block}' in app_css
   and 'overflow-y:auto;overflow-x:hidden' in app_css and 'grid-template-columns:minmax(0,1.6fr) minmax(82px,.8fr) minmax(72px,.7fr)' in app_css
   and 'collapseMorningBankDebtPicker' in debt_picker and 'collapseMorningBankDebtPicker()' in documents,
   'Bank debt picker stays collapsed until search focus, uses full-row selection and fits the Morning modal without horizontal scrolling')
ok('search.value=id?String(debt?.customerName' in debt_picker and 'search.dataset.selectedDebtId=id' in debt_picker,
   'Selecting a bank-linked debt replaces the stale search query with the chosen customer name')
ok('morningBankDebtSelected' in debt_picker and '<b>חוב שנבחר:</b>' in debt_picker and 'selectedDebtMarkup(debt)' in debt_picker and '.morning-bank-debt-selected[hidden]{display:none}' in app_css,
   'Selected debt remains explicitly visible above the search field even if the search text is edited or cleared')
ok('createMorningBankTransactionLinker' in documents and 'linkBankTransaction' in documents and 'clearBankTransactionLink' in documents and 'bankMorningPrefill(row)' in transaction_link and "setActiveSource({...prefill.source,kind:'bank'" in transaction_link and 'activeDebtId' in documents,
   'Debt/standalone Morning issuance can adopt the existing bank source contract without losing the selected debt')
ok('morning-bank-transaction-select' in transaction_picker and 'morning-bank-transaction-search' in transaction_picker and 'bankMorningEligibility' in transaction_picker and 'documentLinks' in transaction_picker and 'already-linked' in transaction_picker and 'RECENT_DAYS=45' in transaction_picker and 'transactionDateKey(row)>=cutoff' in transaction_picker and '45 הימים האחרונים' in transaction_picker,
   'Reverse bank picker is searchable, restricted to eligible credits from the latest 45 calendar days and visibly blocks already-linked transactions')
ok('.morning-bank-transaction-results{display:none;' in app_css and '.morning-bank-transaction-search-shell:focus-within .morning-bank-transaction-results{display:block}' in app_css and 'overflow-y:auto;overflow-x:hidden' in app_css and 'grid-template-columns:minmax(62px,.65fr)' in app_css,
   'Reverse bank picker stays collapsed until focus and fits inside the Morning modal without horizontal scrolling')
ok('getBusinessBankTransactions:()=>domainsFinanceController.snapshot().bank?.feed?.transactions||[]' in main and 'ensureBusinessBankTransactions' in main and 'getBusinessBankTransactions' in composition,
   'Morning bank picker consumes the existing finance archive projection instead of creating a second bank-data path')
ok('bankMorningLinkedDocumentsMarkup' in bank_view and 'data-action="morning-open-document"' in bank_view and 'bankMorningLinkedDocumentsMarkup(row)' in bank_table,
   'Verified Morning documents are directly visible and openable from their bank movement row')
ok('data-action="orders-bank-create-document"' in bank_view and 'data-click-arg1="320"' in bank_view and 'orders-bank-document-choice' not in bank_view and 'bankMorningChoiceMarkup' not in bank_view and 'openBankDocumentChoice' not in bank_view and 'openOrdersBankDocumentChoice' not in main,
   'Bank document action opens the real Morning issuance form directly with type 320 as the default; type 400 remains selectable inside that form')
ok('customerDebtProgressData' in bank and 'progress.paymentComplete&&progress.invoiceComplete' in bank and 'remainingPaymentMagnitude' in bank and 'progress.paymentComplete&&progress.invoiceComplete' in debt_picker,
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
ok("try{const result=await saveBankTransactionHandled(id,handled===true),at=result?.handled_at||result?.handledAt||null;updateLocalBankTransaction" in finance_controller and 'bank_handled_rpc_security_fix' in transport and 'הפעולה לא נשמרה ולא נוצר שינוי ממתין' in transport,
   'Manual handled-state UI mutates local state only after server acknowledgement and reports permission failures as non-pending')
ok('v_multi_check_deposit' in migration_v2 and "jsonb_array_length(v_tx.check_details->'checkItems')>1" in migration_v2 and 'and not v_multi_check_deposit' in migration_v2 and 'if v_multi_check_deposit then' in migration_v2 and 'handled_at:=v_tx.handled_at' in migration_v2,
   'Multi-cheque subset documents may link durably without falsely marking the entire aggregate deposit handled')
ok('v_multi_check_deposit' in sql and 'and not v_multi_check_deposit' in sql,
   'Fresh Morning schema includes the same multi-cheque subset semantics as the v2 upgrade')
ok('row.handledAt=row.handledAt||link.handledAt||null' in finance_controller and 'new Date().toISOString()' not in finance_controller.split('function markBankMorningVerified',1)[1].split(');if(changed)',1)[0].split('row.handledAt=',1)[1].split(';',1)[0],
   'Local verified-link projection does not invent a handled timestamp when the server intentionally leaves an aggregate cheque deposit open')
ok('PCN / ריכוז הכנסות - L' in docs and 'אינו שולח כרגע `accountingClassification`' in docs,
   'PCN behavior is documented without inventing an unverified income-document API field')

if errors:
    print(f'\nERRORS {len(errors)}')
    raise SystemExit(1)
print('\nALL BANK MORNING CONTRACTS PASSED')
