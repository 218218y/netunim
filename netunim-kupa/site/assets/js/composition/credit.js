import {createDomainsCreditSelectors} from '../domains/credit/selectors.js';
import {createDomainsCreditView} from '../domains/credit/view.js';
import {createDomainsCreditEditor} from '../domains/credit/editor.js';
import {createCreditActions} from '../ui/action-packs/credit.js';
import {KUPA_FINANCE_DOMAINS} from '../state/revisions.js';
import {createDomainsCreditController} from '../domains/credit/controller.js';
import {createCreditConnectionOwner} from '../domains/credit/connection-owner.js';
import {normalizeCreditSync,CREDIT_CONNECTOR_CONTRACT_VERSION} from '../domains/credit/sync-feed.js';
import {createCreditPreferences} from '../platform/credit-preferences.js';
import {createFinanceBrowserEffects} from '../shared/finance-browser-effects.js';
import {createLazyDeferredSearchUpdater} from '../shared/search-scheduler.js';
import {createCreditConnectionDialog} from '../ui/credit-connection-dialog.js';
import {createRuntimeTaskOwner} from '../shared/runtime-task-owner.js';
import {createFinanceLeaseOwner} from '../shared/finance-lease-owner.js';
import {createCreditCardOrderView} from '../shared/credit-card-order-view.js';
import {esc} from '../core/values.js';

// Owns Credit services, presentation and resources. Services bind before the
// view; editing binds after record commands, without exposing the controller.
export function createKupaCreditRuntime({model,ui,platform={}}){
  if(!model||!ui)throw new TypeError('credit_context_required');
  const selectors=createDomainsCreditSelectors({model});
  let view=null;
  let creditController=null;
  let actions=null;
  let disposed=false,connectionDialog=null,connections=null;
  const effects=platform.effects??createFinanceBrowserEffects();
  const editorWork=createRuntimeTaskOwner();
  const search=createLazyDeferredSearchUpdater(value=>{if(!disposed)ui.creditSearchValue=value},(...args)=>{if(!disposed)requireView().setCreditSearch(...args)});
  const requireController=()=>{if(!creditController)throw new Error('credit_services_not_bound');return creditController};
  function bindServices({bridge,cloud,persistence,authority,presentation}){
    if(disposed)throw new Error('credit_disposed');
    if(creditController)throw new Error('credit_services_already_bound');
    for(const [name,port,methods] of [
      ['cloud',cloud,['refresh','commit','claimLease','releaseLease']],
      ['persistence',persistence,['save']],
      ['scope',authority?.scope,['capture']],
      ['presentation',presentation,['toast','render','renderStatus','confirmDialog']],
      ['effects',effects,['writeText','saveJson','dispose']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`credit_${name}_${method}_required`);
    if(typeof authority?.automaticAccess!=='function')throw new TypeError('credit_automatic_access_required');
    connections=createCreditConnectionOwner({
      protocol:{minimumBridgeVersion:73,contractVersion:CREDIT_CONNECTOR_CONTRACT_VERSION},
      pairing:{token:()=>bridge.getBridgeToken()},
      transport:{readStatus:()=>bridge.creditStatus(),readDiagnostics:()=>bridge.creditDiagnostics(),
        readData:()=>bridge.creditDataDiagnostics(),saveProfile:payload=>bridge.saveCreditProfile(payload),
        deleteProfile:profileId=>bridge.deleteCreditProfile(profileId)},
      effects,profiles:{read:()=>normalizeCreditSync(model.state.creditSync).profiles},
      presentation:{toast:presentation.toast,render:presentation.render,
        confirmDialog:presentation.confirmDialog},
    });
    creditController=createDomainsCreditController({
      model,bridge,connections,preferences:platform.preferences??createCreditPreferences(),timers:platform.timers??globalThis,
      captureOperation:()=>authority.scope.capture(),autoScope:()=>disposed?null:authority.automaticAccess(),
      saveState:(...args)=>persistence.save(...args),
      toast:(...args)=>{if(!disposed)presentation.toast(...args)},
      render:(...args)=>{if(!disposed)presentation.render(...args)},
      renderStatus:(...args)=>{if(!disposed)presentation.renderStatus(...args)},
      confirmDialog:async(...args)=>!disposed&&await presentation.confirmDialog(...args)&&!disposed,
      refreshFinanceCloudSnapshot:(...args)=>cloud.refresh(...args),saveFinancePatch:(...args)=>cloud.commit(...args),
      syncLeases:createFinanceLeaseOwner({
        leases:{claim:(...args)=>cloud.claimLease(...args),release:(...args)=>cloud.releaseLease(...args)},
        authority:authority.scope,timers:platform.timers??globalThis,
      }),
    });
  }
  const commands=Object.fromEntries([
    'copySafeCreditDiagnostics','exportCreditDataDiagnostics','saveCreditConnection','deleteCreditConnection',
    'resetCreditSync','refreshCreditSync','retryCreditPublication','saveCreditCardOrder','setCreditCardMapping',
    'setCreditAutoRefresh','setCreditAutoMode',
  ].map(method=>[method,(...args)=>disposed?false:requireController()[method](...args)]));
  commands.openCreditConnectionModal=(...args)=>{
    if(disposed)return false;
    if(!connectionDialog)throw new Error('credit_editor_not_bound');
    return connectionDialog.open(...args);
  };
  const queries={
    uiState:()=>requireController().creditSyncUiState(),
    refreshStatus:(...args)=>disposed?Promise.resolve(null):requireController().refreshCreditBridgeStatus(...args),
  };
  const runtime={
    isActive:()=>!disposed,
    start:(...args)=>disposed?Promise.resolve(false):requireController().startAutoSync(...args),
    stop:()=>creditController?.stopAutoSync()??false,
    wake:(...args)=>disposed?Promise.resolve(false):requireController().maybeAutoRefreshCreditSync(...args),
    isPending:()=>editorWork.isPending()||(creditController?.runtime.isPending()??false)||(connections?.runtime.isPending()??false),
    async drain(){
      do{await Promise.all([editorWork.drain(),creditController?.runtime.drain(),connections?.runtime.drain()])}while(runtime.isPending());
    },
    dispose(){
      if(disposed)return false;
      disposed=true;editorWork.close();search.cancel();connectionDialog?.dispose();connections?.runtime.dispose();creditController?.runtime.dispose();effects.dispose();return true;
    },
  };

  function requireView(){
    if(!view)throw new Error('credit_view_not_bound');
    return view;
  }

  function bindView({uiBulk,uiDateEditor,financeDerivations,domainRevisions,expensesMarkup}={}){
    if(disposed)throw new Error('credit_disposed');
    if(view)throw new Error('credit_view_already_bound');
    requireController();
    for(const [name,port,methods] of [
      ['bulk',uiBulk,['syncBulkUi','bulkControls','bulkHeader','bulkCell']],
      ['date',uiDateEditor,['dateEditorMarkup']],
      ['finance',financeDerivations,['run']],
      ['revisions',domainRevisions,['stamp']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`credit_${name}_${method}_required`);
    if(typeof expensesMarkup!=='function')throw new TypeError('credit_expenses_markup_required');

    view=createDomainsCreditView({
      detailRevision:()=>domainRevisions.stamp(KUPA_FINANCE_DOMAINS),
      runFinance:financeDerivations.run,
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      model,ui,isActive:()=>!disposed,
      syncBulkUi:(...args)=>uiBulk.syncBulkUi(...args),
      bulkControls:(...args)=>uiBulk.bulkControls(...args),
      bulkHeader:(...args)=>uiBulk.bulkHeader(...args),
      bulkCell:(...args)=>uiBulk.bulkCell(...args),
      creditSyncUiState:queries.uiState,
      refreshCreditBridgeStatus:queries.refreshStatus,
      expensesMarkup,
    });
  }

  function bindEditor({uiModal,uiDateEditor,uiStatus,storagePersistence,domainsRecordsCommands}={}){
    if(disposed)throw new Error('credit_disposed');
    if(actions)throw new Error('credit_editor_already_bound');
    requireView();
    for(const [name,port,methods] of [
      ['modal',uiModal,['armModalDraftGuard','modal','closeModal']],
      ['date',uiDateEditor,['dateEditorMarkup','setDateValue']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['saveState']],
      ['records',domainsRecordsCommands,['deleteRecord']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`credit_${name}_${method}_required`);

    const editor=createDomainsCreditEditor({
      model,isActive:()=>!disposed,
      armModalDraftGuard:(...args)=>uiModal.armModalDraftGuard(...args),
      modal:(...args)=>uiModal.modal(...args),
      nextChargeDate:(...args)=>selectors.nextChargeDate(...args),
      deleteRecord:(...args)=>!disposed&&domainsRecordsCommands.deleteRecord(...args),
      saveState:(message,options={})=>editorWork.run(()=>storagePersistence.saveState(message,{...options,domains:['credits']})),
      toast:(...args)=>{if(!disposed)uiStatus.toast(...args)},
      closeModal:(...args)=>{if(!disposed)uiModal.closeModal(...args)},
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
      renderCredit:(...args)=>{if(!disposed)view.renderCredit(...args)},
    });
    connectionDialog=createCreditConnectionDialog({
      modal:(...args)=>{if(!disposed)uiModal.modal(...args)},armModalDraftGuard:(...args)=>{if(!disposed)uiModal.armModalDraftGuard(...args)},
      readProfile:(...args)=>requireController().connectionProfile(...args),saveConnection:commands.saveCreditConnection,
      closeModal:()=>{if(!disposed)uiModal.closeModal(true)},isActive:()=>!disposed,
    });
    const pack=createCreditActions({creditCommands:commands,domainsCreditEditor:editor,domainsCreditView:view,ui,search,isActive:()=>!disposed});
    const order=createCreditCardOrderView({
      isActive:()=>!disposed,getSync:()=>model.state.creditSync,saveOrder:commands.saveCreditCardOrder,
      modal:(title,body,footer)=>{
        uiModal.modal(title,body,'',()=>{});
        document.querySelector('#modal .modal-foot').innerHTML=footer;
      },
      closeModal:()=>{if(!disposed)uiModal.closeModal()},render:()=>{if(!disposed)view.renderCredit()},escapeHtml:esc,
    });
    actions=Object.fromEntries(Object.entries({...pack,...order.actions}).map(([name,run])=>[name,(...args)=>!disposed&&run(...args)]));
  }

  return {
    bindServices,bindView,bindEditor,commands,queries,runtime,
    renderCredit:(...args)=>!disposed&&requireView().renderCredit(...args),
    assertReady:()=>{if(!actions)throw new Error('credit_editor_not_bound');return true},
    get actions(){if(!actions)throw new Error('credit_editor_not_bound');return actions},
  };
}
