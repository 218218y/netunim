import {createSpreadsheetStore} from '../../shared/spreadsheet-store.js';
import {createSpreadsheetStore as kupa} from '../../netunim-kupa/site/assets/js/shared/spreadsheet-store.js';
import {createSpreadsheetStore as orders} from '../../netunim-orders/site/assets/js/shared/spreadsheet-store.js';
const store=createSpreadsheetStore({indexedDB,emergency:localStorage});
kupa({emergency:null});orders({indexedDB});
/** @type {Promise<boolean>} */ const committed=store.commit('A',{working:{}});
/** @type {Promise<boolean>} */ const journaled=store.journal('A',[{rowId:'r',columnId:'c',value:'v',generation:1}]);
// @ts-expect-error A receipt is a boolean, not a user-facing status string.
/** @type {Promise<string>} */ const wrong=store.commit('A',{});
// @ts-expect-error Storage namespaces are explicit strings.
store.commit(['A'],{});
// @ts-expect-error Draft input cannot coerce a number into cell text.
store.journal('A',[{rowId:'r',columnId:'c',value:1}]);
// @ts-expect-error Emergency recovery reads must return synchronous text.
createSpreadsheetStore({emergency:{getItem:async()=>'',setItem:()=>{},removeItem:()=>{}}});
store.load('A').then(value=>{
  // @ts-expect-error Raw persisted documents need the sync owner's decoder.
  value.record.revision.toFixed();
  // @ts-expect-error Historical recovery entries remain unknown.
  value.drafts[0].rowId.toUpperCase();
});
void [committed,journaled,wrong];
