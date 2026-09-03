import {clone} from '../../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankCache({checksSession, ui, computeKupaNetReadout, renderKupa=()=>{}, renderChecks, renderSummary, loadSession, readKupaReadOnlyCloud, readKupaReadOnlyMeta, refreshAlertCenter=()=>{}}){
function rememberKupaNetState(kupa){checksSession.kupaCloudReadState=kupa&&typeof kupa==='object'?clone(kupa):null;checksSession.kupaNetReadout=computeKupaNetReadout(checksSession.kupaCloudReadState);return checksSession.kupaNetReadout}

function recomputeKupaNetFromCache(){if(checksSession.kupaCloudReadState)checksSession.kupaNetReadout=computeKupaNetReadout(checksSession.kupaCloudReadState);return checksSession.kupaNetReadout}

function acceptKupaCloudRow(row,{renderIfChanged=false}={}){if(!row)return false;const previousRevision=Number(checksSession.kupaReadRevision||0),previousFinanceRevision=Number(checksSession.financeReadRevision||0),hadState=!!checksSession.kupaCloudReadState,nextRevision=Number(row.revision||0),nextFinanceRevision=Number(row.financeRevision||0);checksSession.kupaReadRevision=nextRevision;checksSession.financeReadRevision=nextFinanceRevision;checksSession.financeReadUpdatedAt=row.financeUpdatedAt||checksSession.financeReadUpdatedAt||null;rememberKupaNetState(row.state||{});refreshAlertCenter();if(renderIfChanged&&(!hadState||nextRevision!==previousRevision||nextFinanceRevision!==previousFinanceRevision))renderKupaDependentView();return true}

function renderKupaDependentView(){recomputeKupaNetFromCache();refreshAlertCenter();if(ui.currentView==='kupa')renderKupa();else if(ui.currentView==='checks')renderChecks();else if(ui.currentView==='summary')renderSummary()}

async function refreshKupaReadout({force=false,renderIfChanged=false}={}){if(!loadSession()||!navigator.onLine)return false;try{if(!force){const meta=await readKupaReadOnlyMeta();if(!meta)return false;const rev=Number(meta.revision||0),financeRev=Number(meta.financeRevision||0);if(rev>0&&rev<=checksSession.kupaReadRevision&&financeRev<=Number(checksSession.financeReadRevision||0)){recomputeKupaNetFromCache();return true}}const row=await readKupaReadOnlyCloud();if(!row)return false;acceptKupaCloudRow(row,{renderIfChanged});return true}catch(e){console.error('kupa read-only refresh',e);return false}}

return { rememberKupaNetState, acceptKupaCloudRow, recomputeKupaNetFromCache, renderKupaDependentView, refreshKupaReadout };
}
