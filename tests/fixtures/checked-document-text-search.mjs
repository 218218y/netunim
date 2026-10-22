import {createDocumentTextMatcher,normalizeContentSearch,isWholeWordTextRange} from '../../shared/document-text-search.js';

const matcher=createDocumentTextMatcher('אב אין',{matchMode:'all'});
const result=matcher.find('אב אין',{maxMatches:1,matchMode:'any'});
/** @type {number|undefined} */ const coordinate=result.matches[0]?.start;
/** @type {boolean} */ const capped=result.capped;
/** @type {readonly string[]} */ const terms=matcher.requiredTerms;
/** @type {'phrase'|'all'|'any'|'proximity'} */ const mode=normalizeContentSearch({matchMode:'untrusted'}).matchMode;
isWholeWordTextRange('אב',0,2);
// @ts-expect-error An arbitrary result label is not a highlight coordinate.
const badCoordinate=/** @type {string} */ (result.matches[0]?.end);
// @ts-expect-error Collection overrides must retain the canonical mode union.
matcher.find('אב',{matchMode:'nearest'});
// @ts-expect-error Highlight limits at typed consumers must be numeric.
matcher.find('אב',{maxMatches:'5000'});
// @ts-expect-error A presence report cannot be replaced by a total count.
const badPresence=/** @type {number} */ (result.foundTerms);
// @ts-expect-error Consumers do not own or edit the matcher term inventory.
matcher.requiredTerms.push('injected');
void [coordinate,capped,terms,mode,badCoordinate,badPresence];
