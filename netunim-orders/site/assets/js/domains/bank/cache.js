import {clone} from '../../core/values.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsBankCache({checksSession, ui, computeKupaNetReadout, renderChecks, renderSummary, loadSession, readKupaReadOnlyCloud, readKupaReadOnlyMeta}){
function rememberKupaNetState(kupa){checksSession.kupaCloudReadState=kupa&&typeof kupa==='object'?clone(kupa):null;checksSession.kupaNetReadout=computeKupaNetReadout(checksSession.kupaCloudReadState);return checksSession.kupaNetReadout}

function recomputeKupaNetFromCache(){if(checksSession.kupaCloudReadState)checksSession.kupaNetReadout=computeKupaNetReadout(checksSession.kupaCloudReadState);return checksSession.kupaNetReadout}

function renderKupaDependentView(){recomputeKupaNetFromCache();if(ui.currentView==='checks')renderChecks();else if(ui.currentView==='summary')renderSummary()}

async function refreshKupaReadout({force=false,renderIfChanged=false}={}){if(!loadSession()||!navigator.onLine)return false;try{if(!force){const meta=await readKupaReadOnlyMeta();if(!meta)return false;const rev=Number(meta.revision||0);if(rev>0&&rev<=checksSession.kupaReadRevision){recomputeKupaNetFromCache();return true}}const row=await readKupaReadOnlyCloud();if(!row)return false;const previousRevision=Number(checksSession.kupaReadRevision||0),hadState=!!checksSession.kupaCloudReadState,nextRevision=Number(row.revision||0);checksSession.kupaReadRevision=nextRevision;rememberKupaNetState(row.state||{});if(renderIfChanged&&(!hadState||nextRevision!==previousRevision))renderKupaDependentView();return true}catch(e){console.error('kupa read-only refresh',e);return false}}

return { rememberKupaNetState, recomputeKupaNetFromCache, renderKupaDependentView, refreshKupaReadout };
}
