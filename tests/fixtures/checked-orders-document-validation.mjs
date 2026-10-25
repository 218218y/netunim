import {assertEntityCollection,assertEntityCollections,collectionCounts} from '../../shared/data-invariants.js';
import {customerDebtProgressData,customerDebtProgressMode,validateCustomerDebtProgress} from '../../shared/customer-debt-progress.js';
import {validOrderCloudState,assertValidOrderCloudState,restoreJsonCounts} from '../../netunim-orders/site/assets/js/state/validation.js';
/** @type {unknown} */ const raw=JSON.parse('{}');
// @ts-expect-error Unvalidated JSON is not an Orders document.
/** @type {import('../../netunim-orders/site/assets/js/state/validation-contracts.js').OrderCloudState} */ const premature=raw;
const document=assertValidOrderCloudState(raw);
/** @type {string} */ const id=document.suppliers[0]?.id||'';
/** @type {number} */ const count=restoreJsonCounts(document).customerDebts;
if('notesSheet' in document){
  // @ts-expect-error A present optional workbook can still be explicitly undefined.
  /** @type {import('../../netunim-orders/site/assets/js/state/validation-contracts.js').NotesWorkbook} */ const book=document.notesSheet;
  void book;
}
// @ts-expect-error Document shape validation does not certify arbitrary debt amounts.
/** @type {number} */ const amount=document.customerDebts[0]?.amount;
if(validOrderCloudState(raw)){
  /** @type {string|undefined} */ const verifiedId=raw.notes[0]?.id;
  void verifiedId;
}
const entity=assertEntityCollections(raw,['customerDebts']);
validateCustomerDebtProgress(entity);
assertEntityCollection(raw,'notes',{required:false});
const counts=collectionCounts(raw,['notes']);
const progress=customerDebtProgressData({amount:-250,debtProgress:[{id:'P',kind:'payment',amount:100}]});
/** @type {number} */ const remaining=progress.remainingPayment;
/** @type {'true'|'partial'|'false'} */ const mode=customerDebtProgressMode(progress,'payment');
// @ts-expect-error Financial amounts cannot become display text.
/** @type {string} */ const formatted=progress.paymentApplied;
// @ts-expect-error Only payment and invoice progress domains are supported.
customerDebtProgressMode(progress,'bank');
// @ts-expect-error Required policy must be a boolean.
assertEntityCollection(raw,'notes',{required:'true'});
void [premature,id,count,amount,counts,remaining,mode,formatted];
