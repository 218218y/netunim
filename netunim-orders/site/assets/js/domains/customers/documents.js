import {createMorningIssueCommand} from './morning-issue-command.js';
import {createMorningRecoveryDecision} from './morning-recovery-decision.js';
import {createMorningCommandForm} from './morning-command-form.js';
import {createMorningDebtConfirmation} from './morning-debt-confirmation.js';
import {DEFAULT_DOCUMENT_TYPE,createMorningDocumentView} from './morning-document-view.js';
import {createMorningDebtApplication} from './morning-debt-application.js';
import {createMorningLifetime} from './morning-lifetime.js';
import {clearMorningDisplay} from './morning-display-lifetime.js';
import {createMorningModalSession} from './morning-modal-session.js';
import {createMorningIssuance} from './morning-issuance.js';
import {createMorningOperationCommands} from './morning-operation-commands.js';
import {createMorningRecovery} from './morning-recovery.js';
import {createMorningStatus} from './morning-status.js';
import {esc} from '../../core/values.js';
import {money} from '../../core/money.js';
import {$} from '../../state/constants.js';
import {morningDebtImpact} from './morning-debt.js';
import {customerDebtProgressData} from '../../shared/customer-debt-progress.js';
import {bankMorningEligibility,bankMorningPrefill} from '../finance/bank-morning.js';
import {createMorningDebtRecoveryContext,loadMorningDebtRecoveryContext,saveMorningDebtRecoveryContext,clearMorningDebtRecoveryContext,morningDebtRecoveryMatchesVerified,morningVerifiedApplicationDurable,morningFinancialSnapshot,morningFinancialChanges} from './morning-debt-recovery.js';
import {createMorningPayments,morningPaymentTotalCents} from './morning-payments.js';
import {activeMorningBankDebts,collapseMorningBankDebtPicker,filterMorningBankDebtPicker,morningBankDebtPickerMarkup,syncMorningBankDebtPickerSelection} from './morning-bank-debt-picker.js';
import {createMorningBankLinks} from './morning-bank-links.js';

const {documentButton,foot,form:morningFormMarkup,debt:morningDebtUpdateMarkup,operation:morningOperationMarkup}=createMorningDocumentView({format:{esc,money},financial:{changes:morningFinancialChanges}});

function todayLocal(){const d=new Date(),shift=d.getTimezoneOffset()*60_000;return new Date(d.getTime()-shift).toISOString().slice(0,10)}

function cleanText(value,max=250){return String(value??'').trim().slice(0,max)}
function setBusy(button,busy,label=''){if(!button)return;button.ariaBusy=String(!!busy);button.disabled=!!busy;if(busy&&label){if(!button.dataset.idleLabel)button.dataset.idleLabel=button.textContent||'';button.textContent=label}else if(!busy&&button.dataset.idleLabel)button.textContent=button.dataset.idleLabel}

export function debtMorningPrefill(debt={}){const clearingApproval=String(debt?.clearingApproval||'').replace(/\D/g,'').slice(0,20),customerId=String(debt?.customerId||'').replace(/\D/g,'').slice(0,9),amount=Number(debt?.amount),payment=clearingApproval?{type:3,date:todayLocal(),price:Number.isFinite(amount)&&amount>0?amount:'',currency:'ILS',cardType:1,cardNum:'****'}:undefined;return {customerName:debt?.customerName||'',amount:debt?.amount,orderNumber:'',phone:debt?.phone||'',email:debt?.email||'',taxId:customerId,remarks:clearingApproval?`אשראי נסלק באתר ת.ב.י רהיטים. אישור סליקה באתר - ${clearingApproval}`:'',...(payment?{payment}:{})}}

export function createDomainsCustomersDocuments({operationScope,subscribeAccountScope=()=>()=>{},model,modal,toast,confirmDialog,markModalDraftSaved,request,dateEditorMarkup,setDateValue=()=>{},documentsBrowser,applyVerifiedDebtDocument,rejectSecondaryIssuance,rejectSecondaryMutation,refreshForMorningRecovery,getBusinessBankTransactions=()=>[],ensureBusinessBankTransactions=async()=>false,onBankDocumentVerified=()=>{}}){
if(typeof operationScope?.capture!=='function'||typeof operationScope?.captureRead!=='function')throw new TypeError('morning_operation_scope_required');
if(typeof request?.json!=='function')throw new TypeError('morning_request_required');
let disposed=false;
const scopeChanged=error=>error?.code==='MORNING_OPERATION_SCOPE_CHANGED';
let activeOperationId='',activeDebtId='',activeSource={kind:'standalone'},issuanceContext=null,createBusy=false,blocked=false,completed=false;
let issuanceInterruptionEpoch=0;
const lifetime=createMorningLifetime({operationScope,getPendingOperationId:()=>pendingRecovery?.operationId,recover:recoverPendingMorningOperation,onInterrupt:()=>{issuanceInterruptionEpoch++}});
const captureScope=lifetime.capture,scheduleRecoveryCheck=lifetime.scheduleRecovery;
let pendingRecovery=loadMorningDebtRecoveryContext();
const modalSession=createMorningModalSession({
  authority:{captureRead:()=>captureScope(true)},account:{subscribe:subscribeAccountScope},
  surface:{find:generation=>document.querySelector(`#modal [data-morning-generation="${generation}"]`),isOpen:()=>$('#modalBackdrop')?.classList.contains('open')===true},
  presentation:{render:modal,clear:owned=>{clearMorningDisplay(owned,modal)}},
});
function modalAssert(){modalSession.assert()}
function currentRoot(){return modalSession.element}
function currentField(id){return modalSession.element?.closest('#modal')?.querySelector('#'+id)||null}
if(pendingRecovery){activeOperationId=pendingRecovery.operationId;activeDebtId=pendingRecovery.debtId;activeSource=sourceFromRecovery(pendingRecovery);issuanceContext=pendingRecovery;blocked=true}
const {paymentFields,readPaymentRows,replaceMorningPayments,addMorningPayment,removeMorningPayment,syncPaymentType,syncPaymentBank,syncPaymentTotal}=createMorningPayments({dateEditorMarkup,toast,currentField,getSource:()=>activeSource,getSelectedType:()=>selectedType()});
const bankTransactionLinker=createMorningBankLinks({
  session:{generation:()=>modalSession.generation,isActive,root:currentRoot,field:currentField},
  catalog:{read:getBusinessBankTransactions,ensure:ensureBusinessBankTransactions},
  source:{read:()=>activeSource,set:value=>{activeSource=value}},
  editor:{
    payments:{read:()=>readPaymentRows({strict:false}),replace:replaceMorningPayments,sync:()=>{syncPaymentType();syncPaymentTotal()}},
    document:{type:selectedType,sync:syncDocumentType},
    date:value=>{const field=currentField('morningDocumentDate');if(field)setDateValue(field.closest?.('[data-date-editor]')||field,String(value||''),false)},
  },toast,
});
function isDebtRecoveryPending(debtId){
  const stored=loadMorningDebtRecoveryContext();
  return !!debtId&&[stored,pendingRecovery].some(context=>context?.debtId===debtId);
}
function rejectDebtRecoveryMutation(debtId){
  if(!isDebtRecoveryPending(debtId))return false;
  toast('קיימת הפקת Morning שממתינה לאימות עבור חוב זה. יש להשלים בדיקת מצב הפקה לפני שינוי התשלום/חשבונית.');return true;
}
function sourceFromRecovery(context){const kind=context?.sourceKind||((context?.debtId)?'debt':'standalone');return kind==='bank'?{kind:'bank',bankTransactionId:Number(context?.bankTransactionId)||0}:{kind}}
function sourceKey(source=activeSource){return source?.kind==='bank'?`bank:${Number(source.bankTransactionId)||0}`:source?.kind==='debt'?`debt:${String(activeDebtId||'')}`:'standalone'}
function hydrateRecoveredSource(recovered,requested){if(recovered?.kind!=='bank'||requested?.kind!=='bank'||Number(recovered.bankTransactionId)!==Number(requested.bankTransactionId))return recovered;return {...recovered,...requested,kind:'bank',bankTransactionId:Number(recovered.bankTransactionId)}}

function newOperationId(){return globalThis.crypto.randomUUID()}

const operationCommands=createMorningOperationCommands({request});
const debtApplication=createMorningDebtApplication({
  lifetime,recovery:{read:loadMorningDebtRecoveryContext},
  debts:{
    read:id=>(model.state.customerDebts||[]).find(d=>d.id===id),
    refresh:()=>refreshForMorningRecovery?.(),
    isBlocked:()=>rejectSecondaryMutation?.()===true,
    apply:command=>applyVerifiedDebtDocument?.(command)||{changed:false,reason:'no-handler'},
  },
  policy:{matches:morningDebtRecoveryMatchesVerified,snapshot:morningFinancialSnapshot,changes:morningFinancialChanges},
  feedback:{toast,status:connectionStatus,decide:(...args)=>recoveryDecision.show(...args)},
});
const issuance=createMorningIssuance({commands:operationCommands,recovery:{persist:persistRecoveryContext,reset:resetOperationAfterTerminal,block:()=>{blocked=true}}});
const recoveryFlow=createMorningRecovery({
  lifetime,commands:operationCommands,
  recovery:{
    read:()=>{const stored=loadMorningDebtRecoveryContext();if(stored)pendingRecovery=stored;return pendingRecovery},
    abandon:abandonRecoveredReservation,reset:resetOperationAfterTerminal,
  },
  application:{apply:applyVerifiedContext,settle:settleVerifiedRecovery},
  publish:{
    isBusy:()=>createBusy,
    state:(nextBlocked,nextCompleted)=>{blocked=nextBlocked;if(nextCompleted!==undefined)completed=nextCompleted},
    notify:notifyBankVerified,toast,
  },
});
const statusFlow=createMorningStatus({
  lifetime,commands:operationCommands,
  session:{
    assertModal:()=>{modalAssert?.()},isActive,
    read:()=>({generation:modalSession.generation,operationId:activeOperationId,busy:createBusy,blocked,completed,pendingOperationId:pendingRecovery?.operationId||null,context:issuanceContext||pendingRecovery}),
    update:state=>{blocked=state.blocked;if(state.completed!==undefined)completed=state.completed},
  },
  recovery:{abandon:abandonRecoveredReservation,reset:resetOperationAfterTerminal},
  application:{apply:applyVerifiedOperation,settle:settleVerifiedRecovery,notify:notifyBankVerified},
  presentation:{
    status:connectionStatus,operation:renderOperation,markSaved:()=>{markModalDraftSaved?.()},
    button:({disabled,completed:done=false})=>{const button=modalSession.element?.closest('#modal')?.querySelector('[data-action="morning-create"]');if(button){button.disabled=disabled;if(done){button.dataset.idleLabel='הופק ואומת';button.textContent='הופק ואומת'}}},
  },
});

const recoveryDecision=createMorningRecoveryDecision({
  session:{isActive,generation:()=>modalSession.generation,assertModal:modalAssert,capture:captureScope,scopeChanged},
  debts:{read:id=>(model.state.customerDebts||[]).find(d=>d.id===id),refresh:()=>refreshForMorningRecovery?.(),isBlocked:()=>rejectSecondaryMutation?.()===true},
  recovery:{read:loadMorningDebtRecoveryContext,save:saveMorningDebtRecoveryContext,adopt:context=>{pendingRecovery=context;issuanceContext=context},isPending:()=>lifetime.pending('recovery'),run:recoverPendingMorningOperation},
  application:debtApplication,
  display:{isOpen:()=>$('#modalBackdrop')?.classList.contains('open')===true,open:(...args)=>modalSession.open(...args),field:currentField,status:connectionStatus,markSaved:()=>markModalDraftSaved?.(),busy:setBusy},
  feedback:{toast},
});
const issueCommand=createMorningIssueCommand({
  session:{read:()=>({createBusy,blocked,completed}),update:next=>{if('createBusy' in next)createBusy=next.createBusy;if('blocked' in next)blocked=next.blocked;if('completed' in next)completed=next.completed},
    reject:()=>activeDebtId?rejectSecondaryMutation?.()===true:rejectSecondaryIssuance?.()===true,assertModal:modalAssert,capture:captureScope,generation:()=>modalSession.generation,signal:()=>modalSession.signal,
    interruptionEpoch:()=>issuanceInterruptionEpoch,operationId:()=>issuanceContext?.operationId||activeOperationId,isActive,scopeChanged,cancelStatus:()=>statusFlow.cancelPending()},
  form:{read:readForm,policy:debtUpdatePolicy,context:recoveryContext,confirmation:debtImpactConfirmation},issuance,application:debtApplication,
  recovery:{settle:settleVerifiedRecovery,notify:notifyBankVerified,adopt:adoptRecoveryOperationId,reset:resetOperationAfterTerminal,schedule:scheduleRecoveryCheck},
  display:{confirm:confirmDialog,busy:setBusy,operation:renderOperation,status:connectionStatus,markSaved:()=>markModalDraftSaved?.()},media:documentsBrowser,feedback:{toast},
  connectivity:{isOnline:()=>globalThis.navigator?.onLine!==false},
});

function debtUpdatePanel(){return activeDebtId?morningDebtUpdateMarkup(customerDebtProgressData(currentDebt()||{})):''}
function activeBankDebts(){return activeMorningBankDebts(model.state.customerDebts||[])}
function bankDebtLinkPanel(){return activeSource?.kind==='bank'?morningBankDebtPickerMarkup({debts:model.state.customerDebts||[],transaction:activeSource.bankTransaction||null,activeDebtId,aggregate:activeSource.aggregate===true}):''}
function filterBankDebtPicker(query=''){return filterMorningBankDebtPicker(query,currentRoot())}
function syncBankDebtPickerSelection(){return syncMorningBankDebtPickerSelection({activeDebtId,debt:currentDebt(),root:currentRoot()})}
function bankTransactionLinkPanel(source=activeSource){return bankTransactionLinker.panelMarkup(source)}
function filterBankTransactionPicker(query=''){return bankTransactionLinker.filter(query)}
function linkBankTransaction(transactionId){return bankTransactionLinker.link(transactionId,{blocked,busy:createBusy})}
function clearBankTransactionLink(){return bankTransactionLinker.clear({blocked,busy:createBusy})}

function formBody(d,type,dateEditorMarkup,{source=activeSource}={}){
  const documentDate=cleanText(d?.date,10)||todayLocal();
  return morningFormMarkup(d,type,{generation:modalSession.generation,kind:source?.kind||'standalone',
    dates:{document:dateEditorMarkup('morningDocumentDate',documentDate,{label:'תאריך מסמך'}),due:dateEditorMarkup('morningDueDate','',{label:'תאריך לתשלום'})},
    panels:{bankTransactions:bankTransactionLinkPanel(source),bankDebts:bankDebtLinkPanel(),debtUpdate:debtUpdatePanel(),payments:paymentFields(d,source)},
  });
}

function openMorningDocument(debtId){
  const d=(model.state.customerDebts||[]).find(item=>item.id===debtId);if(!d)return toast('חוב הלקוח לא נמצא');
  return openMorningDocumentModal({prefill:debtMorningPrefill(d),debtId:d.id,source:{kind:'debt'}});
}
function openStandaloneMorningDocument(){return openMorningDocumentModal({prefill:null,debtId:'',source:{kind:'standalone'}})}
function openBankMorningDocument(transaction,type=DEFAULT_DOCUMENT_TYPE){
  const eligibility=bankMorningEligibility(transaction,'business');if(!eligibility.eligible){toast(eligibility.reason||'לא ניתן להפיק מסמך מתנועה זו');return}
  let prefill;try{prefill=bankMorningPrefill(transaction)}catch{return toast('לא ניתן להכין את פרטי תנועת הבנק להפקת מסמך')}
  const requestedType=[320,400].includes(Number(type))?Number(type):DEFAULT_DOCUMENT_TYPE;
  return openMorningDocumentModal({prefill,debtId:'',source:{...prefill.source,bankTransaction:transaction},initialType:requestedType});
}
async function openMorningDocumentModal({prefill=null,debtId='',source=null,initialType=DEFAULT_DOCUMENT_TYPE}={}){
  try{captureScope(true)()}catch(error){toast(error.message);return}
  const requestedDebtId=String(debtId||''),requestedSource=source&&typeof source==='object'?source:{kind:requestedDebtId?'debt':'standalone'},requestedKey=requestedSource.kind==='bank'?`bank:${Number(requestedSource.bankTransactionId)||0}`:requestedSource.kind==='debt'?`debt:${requestedDebtId}`:'standalone';
  if(createBusy){toast('הפקת Morning קודמת עדיין מתבצעת. יש להמתין לתוצאתה לפני פתיחת מסמך נוסף.');return}
  pendingRecovery=loadMorningDebtRecoveryContext()||pendingRecovery;
  if(pendingRecovery&&!completed){activeOperationId=pendingRecovery.operationId;activeDebtId=pendingRecovery.debtId;activeSource=sourceFromRecovery(pendingRecovery);issuanceContext=pendingRecovery;blocked=true}
  if(blocked&&requestedKey!==sourceKey(activeSource)){toast('יש ניסיון הפקה קודם שעדיין ממתין לאימות. יש להשלים את בדיקת ההפקה שלו לפני פתיחת מקור מסמך אחר.');return}
  if(!blocked){activeOperationId=newOperationId();activeDebtId=requestedDebtId;activeSource=requestedSource;bankTransactionLinker.reset(requestedSource);issuanceContext=null;completed=false}else if(issuanceContext?.operationId===activeOperationId){activeDebtId=issuanceContext.debtId;activeSource=hydrateRecoveredSource(sourceFromRecovery(issuanceContext),requestedSource);bankTransactionLinker.reset(activeSource)}
  const safeType=activeSource.kind==='bank'&&![320,400].includes(Number(initialType))?320:Number(initialType)||DEFAULT_DOCUMENT_TYPE;
  modalSession.open('בודק חיבור ל-Morning…',()=>formBody(prefill||{},safeType,dateEditorMarkup,{source:activeSource}),foot());
  mountMorningConnectionStatus();
  syncDocumentType();syncPaymentType();syncPaymentTotal();syncBankDebtPickerSelection();if(currentField('morningBankTransactionRows'))void lifetime.run(()=>bankTransactionLinker.refresh());await refreshStatus();
}
function isActive(generation){return !disposed&&modalSession.isActive(generation)}

function selectedType(){return Number(modalSession.element?.querySelector('input[name="morningDocumentType"]:checked')?.value||0)}
function debtUpdatePolicy(type=selectedType()){
  if(!activeDebtId)return {applyPayment:false,applyInvoice:false};
  const paymentSupported=type===320||type===400,invoiceSupported=type===305||type===320;
  return {applyPayment:paymentSupported&&currentField('morningApplyPayment')?.checked!==false,applyInvoice:invoiceSupported&&currentField('morningApplyInvoice')?.checked!==false};
}
function syncDocumentType(){
  const type=selectedType(),needsPayment=type===320||type===400,payment=currentField('morningPaymentFields'),linked=currentField('morningLinkedDocumentPanel'),paymentUpdate=currentField('morningApplyPaymentOption'),invoiceUpdate=currentField('morningApplyInvoiceOption'),amount=currentField('morningAmount');
  if(activeSource.kind==='bank'&&![320,400].includes(type))return;
  if(payment)payment.hidden=!needsPayment;if(linked)linked.hidden=type!==400;if(paymentUpdate)paymentUpdate.hidden=!(type===320||type===400);if(invoiceUpdate)invoiceUpdate.hidden=!(type===305||type===320);if(amount)amount.readOnly=false;
  modalSession.element?.querySelectorAll('[data-document-kind]').forEach(el=>{el.hidden=Number(el.dataset.documentKind)!==type});if(needsPayment)syncPaymentTotal();
}
function applyLinkedDebtIdentity(debt){const prefill=debt?debtMorningPrefill(debt):{taxId:'',remarks:''};for(const [fieldId,key] of [['morningClientTaxId','taxId'],['morningRemarks','remarks']]){const field=currentField(fieldId);if(!field)continue;const previous=String(field.dataset.debtPrefill||'');if(!field.value||field.value===previous)field.value=String(prefill[key]||'');field.dataset.debtPrefill=String(prefill[key]||'')}}
function linkBankDebt(debtId){if(activeSource.kind!=='bank'||blocked||createBusy)return;const id=String(debtId||''),debt=id?activeBankDebts().find(row=>String(row.id)===id):null,exists=!id||!!debt;if(!exists)return toast('החוב שנבחר אינו קיים או שכבר הושלם');activeDebtId=id;applyLinkedDebtIdentity(debt);const host=currentField('morningDebtUpdateHost');if(host)host.innerHTML=debtUpdatePanel();syncDocumentType();syncBankDebtPickerSelection();collapseMorningBankDebtPicker(currentRoot())}

const commandForm=createMorningCommandForm({session:{context:()=>({operationId:activeOperationId,debtId:activeDebtId,source:activeSource})},fields:{read:currentField,type:selectedType},receipts:{read:readPaymentRows,totalCents:morningPaymentTotalCents},format:{money}});
const confirmation=createMorningDebtConfirmation({format:{money},financial:{impact:morningDebtImpact}});
function readForm(){return commandForm.read()}
function debtImpactConfirmation(type,amount,policy=debtUpdatePolicy(type)){return confirmation.message(activeDebtId,currentDebt(),type,amount,policy)}
function currentDebt(){return activeDebtId?(model.state.customerDebts||[]).find(row=>row.id===activeDebtId)||null:null}

function recoveryContext(type,amount,policy=debtUpdatePolicy(type),operationId=activeOperationId){return createMorningDebtRecoveryContext({operationId,debtId:activeDebtId,type,amount,applyPayment:policy.applyPayment,applyInvoice:policy.applyInvoice,financialSnapshot:morningFinancialSnapshot(currentDebt()),sourceKind:activeSource.kind||'standalone',bankTransactionId:activeSource.kind==='bank'?Number(activeSource.bankTransactionId):null})}
function persistRecoveryContext(context){
  if(!saveMorningDebtRecoveryContext(context))throw new Error('לא ניתן לשמור נקודת התאוששות מקומית לפני ההפקה. המסמך לא נשלח ל-Morning כדי שלא יאבד הקשר לחוב במקרה של ניתוק או רענון.');
  pendingRecovery=context;issuanceContext=context;return context;
}
function clearRecoveryContext(operationId=''){
  const target=operationId||pendingRecovery?.operationId||issuanceContext?.operationId||'';
  const cleared=clearMorningDebtRecoveryContext(target);if(cleared&&(!pendingRecovery||!target||pendingRecovery.operationId===target)){pendingRecovery=null;recoveryDecision.clear()}return cleared;
}
function adoptRecoveryOperationId(operationId){
  const id=String(operationId||'').trim();if(!id||!issuanceContext||issuanceContext.operationId===id)return issuanceContext;
  const next=createMorningDebtRecoveryContext({...issuanceContext,operationId:id});
  if(saveMorningDebtRecoveryContext(next)){const freshSource=activeSource;pendingRecovery=next;issuanceContext=next;activeOperationId=id;activeDebtId=next.debtId;activeSource=hydrateRecoveredSource(sourceFromRecovery(next),freshSource);return next}
  return issuanceContext;
}

function applyVerifiedContext(context,args={},options={}){return debtApplication.apply(context,args,options)}

function applyVerifiedOperation(args={},options={}){return applyVerifiedContext(issuanceContext,args,options)}
function settleVerifiedRecovery(operationId,result,{serverLinkPending=false}={}){
  const durable=morningVerifiedApplicationDurable(result),recoveryCleared=durable&&!serverLinkPending?clearRecoveryContext(operationId):false;
  return {durable,recoveryCleared,blocked:!durable||serverLinkPending||!recoveryCleared};
}
function notifyBankVerified(context,bankLink){if(context?.sourceKind!=='bank'||!context.bankTransactionId||!bankLink||bankLink.pending===true)return;try{onBankDocumentVerified(Number(context.bankTransactionId),bankLink)}catch(error){console.error('Bank Morning local projection update failed',error)}}

function mountMorningConnectionStatus(){const panel=modalSession.element?.closest('#modal'),heading=panel?.querySelector('.modal-head h3');if(!heading||!panel.querySelector('.morning-document-dialog'))return;heading.id='morningConnectionStatus';heading.className='morning-connection morning-modal-connection loading';heading.innerHTML='<span class="morning-dot"></span><span>בודק חיבור ל-Morning…</span>'}
function connectionStatus(kind,text){const el=currentField('morningConnectionStatus');if(!el)return;const inHeader=el.matches('#modal .modal-head h3');el.className=`morning-connection ${inHeader?'morning-modal-connection ':''}${kind}`;el.innerHTML=`<span class="morning-dot"></span><span>${esc(text)}</span>`}
function renderOperation(op){const result=currentField('morningOperationResult'),markup=morningOperationMarkup(op);if(result&&markup!==null)result.innerHTML=markup}
function resetOperationAfterTerminal(operationId){
  if(!clearRecoveryContext(operationId)){blocked=true;scheduleRecoveryCheck();return false}
  const debtId=issuanceContext?.debtId??activeDebtId,recovered=issuanceContext?sourceFromRecovery(issuanceContext):activeSource,source=hydrateRecoveredSource(recovered,activeSource);blocked=false;completed=false;activeOperationId=newOperationId();activeDebtId=String(debtId||'');activeSource=source;issuanceContext=null;return true;
}
async function abandonRecoveredReservation(operationId,{quiet=false,assertCurrent=captureScope()}={}){
  const data=await operationCommands.abandonReservation(operationId,assertCurrent);assertCurrent();
  if(data.abandoned===true){const cleared=resetOperationAfterTerminal(operationId);if(cleared&&!quiet)toast('ניסיון ההפקה הקודם נעצר לפני שנשלח ל-Morning. לא הופק מסמך ולא בוצע שינוי בחוב.');return {abandoned:cleared,operation:data.operation}}
  return {abandoned:false,operation:data.operation||null};
}
function refreshStatus(...args){return statusFlow.refresh(...args)}

function recoverPendingMorningOperation(...args){return recoveryFlow.recover(...args)}

async function previewMorningDocument(button){
  let payload,assertCurrent;try{modalAssert?.();assertCurrent=captureScope(true);payload=readForm()}catch(error){return toast(error.message)}
  const generation=modalSession.generation;setBusy(button,true,'מכין…');
  try{return await documentsBrowser.previewDraft(payload,{assertCurrent,isCurrent:()=>isActive(generation)})}
  finally{setBusy(button,false)}
}

function openExistingDocument(documentId,button,operationId){try{captureScope(true)()}catch(error){toast(error.message);return false}return documentId?documentsBrowser.viewDocument(documentId,button):documentsBrowser.viewVerifiedOperation(operationId,button)}
async function reconcile(button){if(createBusy)return;setBusy(button,true,'בודק…');try{await refreshStatus({reconcile:true})}finally{setBusy(button,false)}}

function dispose(){if(disposed)return false;disposed=true;lifetime.dispose();modalSession.dispose();return true}
function editCommand(run,args){return disposed||!isActive(modalSession.generation)?false:run(...args)}
function command(run,args){return disposed?Promise.resolve(false):lifetime.run(()=>run(...args))}
const runtime={dispose,cancelPending:()=>{lifetime.cancelPending();statusFlow.cancelPending()},drain:lifetime.drain,isPending:lifetime.isPending};
return {
  dispose,runtime,isDebtRecoveryPending,rejectDebtRecoveryMutation,documentButton,recoverPendingMorningOperation,
  saveRecoveryChoice:(...args)=>disposed?false:recoveryDecision.save(...args),
  confirmRecoveryChoice:(...args)=>command(recoveryDecision.confirm,args),
  openMorningDocumentModal:(...args)=>command(openMorningDocumentModal,args),
  openMorningDocument:(...args)=>command(openMorningDocument,args),
  openStandaloneMorningDocument:(...args)=>command(openStandaloneMorningDocument,args),
  openBankMorningDocument:(...args)=>command(openBankMorningDocument,args),
  linkBankDebt:(...args)=>editCommand(linkBankDebt,args),
  filterBankDebtPicker:(...args)=>editCommand(filterBankDebtPicker,args),
  linkBankTransaction:(...args)=>editCommand(linkBankTransaction,args),
  clearBankTransactionLink:(...args)=>editCommand(clearBankTransactionLink,args),
  filterBankTransactionPicker:(...args)=>editCommand(filterBankTransactionPicker,args),
  addMorningPayment:(...args)=>editCommand(addMorningPayment,args),
  removeMorningPayment:(...args)=>editCommand(removeMorningPayment,args),
  syncPaymentTotal:(...args)=>editCommand(syncPaymentTotal,args),
  syncDocumentType:(...args)=>editCommand(syncDocumentType,args),
  syncPaymentType:(...args)=>editCommand(syncPaymentType,args),
  syncPaymentBank:(...args)=>editCommand(syncPaymentBank,args),
  previewMorningDocument:(...args)=>command(previewMorningDocument,args),
  createMorningDocument:(...args)=>command(issueCommand.create,args),
  openExistingDocument:(...args)=>command(openExistingDocument,args),
  reconcile:(...args)=>command(reconcile,args),
  refreshStatus:(...args)=>command(refreshStatus,args),
};
}
