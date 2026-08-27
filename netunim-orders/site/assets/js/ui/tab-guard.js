import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiTabGuard({tab, toast, acquirePrimaryTabLock}){
function showSecondaryTabGuard(){const g=$('#tabWriterGuard');if(g)g.hidden=tab.primaryTab}

async function retryPrimaryTabLock(){if(tab.primaryTab)return;const ok=await acquirePrimaryTabLock();if(ok){location.reload();return}toast('הלשונית האחרת עדיין פעילה')}

return { showSecondaryTabGuard, retryPrimaryTabLock };
}
