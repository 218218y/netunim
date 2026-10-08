import {clone} from '../../core/values.js';

// Read-model publication has an authorization owner, separately from Main writes.
export function createDomainsBankCache({checksSession,ui,operationScope,computeKupaNetReadout,renderKupa=()=>{},renderChecks,renderSummary,loadSession,readKupaReadOnlyCloud,readKupaReadOnlyMeta,refreshAlertCenter=()=>{},refreshBankAlertArchive=async()=>false,touchFinanceRevision=()=>{}}){
  if(typeof operationScope?.captureRead!=='function')throw new Error('bank_readout_scope_required');
  let publishedScope=null;
  const scopeChanged=error=>error?.code==='FINANCE_OPERATION_SCOPE_CHANGED';
  function samePublicationOwner(){try{if(!publishedScope)return false;publishedScope();return true}catch(error){if(!scopeChanged(error))throw error;return false}}

  function rememberKupaNetState(kupa){checksSession.kupaCloudReadState=kupa&&typeof kupa==='object'?clone(kupa):null;checksSession.kupaNetReadout=computeKupaNetReadout(checksSession.kupaCloudReadState);return checksSession.kupaNetReadout}
  function recomputeKupaNetFromCache(){if(checksSession.kupaCloudReadState)checksSession.kupaNetReadout=computeKupaNetReadout(checksSession.kupaCloudReadState);return checksSession.kupaNetReadout}

  function acceptKupaCloudRow(row,{renderIfChanged=false,assertCurrent=operationScope.captureRead()}={}){
    assertCurrent();if(!row)return false;
    const previousRevision=Number(checksSession.kupaReadRevision||0),previousFinanceRevision=Number(checksSession.financeReadRevision||0),hadState=!!checksSession.kupaCloudReadState,nextRevision=Number(row.revision||0),nextFinanceRevision=Number(row.financeRevision||0);
    if(samePublicationOwner()&&(nextRevision<previousRevision||nextFinanceRevision<previousFinanceRevision))return false;
    const changed=!hadState||!samePublicationOwner()||nextRevision!==previousRevision||nextFinanceRevision!==previousFinanceRevision;
    checksSession.kupaReadRevision=nextRevision;checksSession.financeReadRevision=nextFinanceRevision;
    checksSession.financeReadUpdatedAt=row.financeUpdatedAt||checksSession.financeReadUpdatedAt||null;
    publishedScope=operationScope.captureRead();
    if(changed)touchFinanceRevision();rememberKupaNetState(row.state||{});refreshAlertCenter();
    Promise.resolve(refreshBankAlertArchive()).then(archiveChanged=>{assertCurrent();refreshAlertCenter();if(archiveChanged&&ui.currentView==='checks')renderChecks()}).catch(error=>{if(!scopeChanged(error))console.error('orders bank alert archive refresh',error)});
    if(renderIfChanged&&changed)renderKupaDependentView();return true;
  }
  function renderKupaDependentView(){recomputeKupaNetFromCache();refreshAlertCenter();if(ui.currentView==='kupa')renderKupa();else if(ui.currentView==='checks')renderChecks();else if(ui.currentView==='summary')renderSummary()}

  async function refreshKupaReadout({force=false,renderIfChanged=false,assertCurrent:operationGuard,minimumRevision=0,minimumFinanceRevision=0}={}){
    if(!loadSession()||!navigator.onLine)return false;
    try{
      const assertOwner=operationScope.captureRead(),assertCurrent=()=>{assertOwner();operationGuard?.()};assertCurrent();
      if(!force){
        const meta=await readKupaReadOnlyMeta({assertCurrent});assertCurrent();if(!meta)return false;
        const rev=Number(meta.revision||0),financeRev=Number(meta.financeRevision||0);
        if(samePublicationOwner()&&rev>0&&rev<=checksSession.kupaReadRevision&&financeRev<=Number(checksSession.financeReadRevision||0)&&checksSession.kupaReadRevision>=minimumRevision&&checksSession.financeReadRevision>=minimumFinanceRevision){recomputeKupaNetFromCache();return true}
      }
      const row=await readKupaReadOnlyCloud({assertCurrent});assertCurrent();if(!row)return false;
      if(Number(row.revision||0)<minimumRevision||Number(row.financeRevision||0)<minimumFinanceRevision)return false;
      // Persist the read owner only; a caller's temporary lease does not own a cache.
      return acceptKupaCloudRow(row,{renderIfChanged,assertCurrent:assertOwner});
    }catch(error){if(!scopeChanged(error))console.error('kupa read-only refresh',error);return false}
  }
  return {rememberKupaNetState,acceptKupaCloudRow,recomputeKupaNetFromCache,renderKupaDependentView,refreshKupaReadout};
}
