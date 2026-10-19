import {createMorningReports} from '../domains/finance/morning-reports.js';
import {createMorningRequest} from '../integrations/morning.js';
import {createMorningMediaComposition} from './morning-media.js';

export function createFinanceMorningReports({auth, morningOperationScope, modal, toast, dateEditorMarkup, isActive}) {
  const request = createMorningRequest({supaFetch:(...args) => auth.supaFetch(...args), operationScope:morningOperationScope});
  const media = createMorningMediaComposition({request, modal, toast}).create({capture:() => morningOperationScope.captureRead(), onStandalone:() => {}});
  return createMorningReports({request:request.json, captureRead:() => morningOperationScope.captureRead(),
    subscribeAccountScope:listener => auth.subscribeAccountScope?.(listener) || (() => {}), media, dateEditorMarkup, isActive});
}
