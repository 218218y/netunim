import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiTabGuard({tab, toast, acquirePrimaryTabLock}){
function showSecondaryTabGuard(){const readOnly=!tab.primaryTab;const g=$('#tabWriterGuard');if(g)g.hidden=!readOnly;document.body.classList.toggle('secondary-readonly',readOnly)}

async function retryPrimaryTabLock(){if(tab.primaryTab)return;location.reload()}

return { showSecondaryTabGuard, retryPrimaryTabLock };
}
