import {esc} from '../core/values.js';

// One visual contract for all in-view searches. Matching stays in each domain;
// this helper owns only accessible, symmetric presentation.
export function localSearchMarkup({value='',placeholder='חיפוש…',inputAction,label=placeholder,className=''}){
  return `<label class="local-search ${esc(className)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 21-4.35-4.35m1.35-5.15a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"/></svg><input type="search" autocomplete="off" value="${esc(value)}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}" data-input="${esc(inputAction)}"></label>`;
}
