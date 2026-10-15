import {createMorningCommandForm} from '../../netunim-orders/site/assets/js/domains/customers/morning-command-form.js';
import {createMorningDebtConfirmation} from '../../netunim-orders/site/assets/js/domains/customers/morning-debt-confirmation.js';
const ports={session:{context:()=>({operationId:'op',debtId:'debt',source:{kind:'debt'}})},fields:{read:()=>({value:''}),type:()=>320},receipts:{read:()=>[{type:4,date:'2026-10-15',price:30,currency:'ILS'}],totalCents:()=>3000},format:{money:(/** @type {number} */value)=>String(value)}};
const form=createMorningCommandForm(ports),payload=form.read();/** @type {number} */const amount=payload.document.amount;void amount;
// @ts-expect-error unvalidated text cannot become a numeric receipt
createMorningCommandForm({...ports,receipts:{...ports.receipts,read:()=>[{type:4,date:'',price:'30',currency:'ILS'}]}});
// @ts-expect-error fields must be captured synchronously
createMorningCommandForm({...ports,fields:{...ports.fields,read:async()=>({value:''})}});
// @ts-expect-error a draft cannot reserve or issue documents
form.issue(payload);
// @ts-expect-error formatting must produce ready text
createMorningCommandForm({...ports,format:{money:async()=>''}});
// @ts-expect-error financial impact must be explicit before confirmation text
createMorningDebtConfirmation({format:ports.format,financial:{impact:()=>({eligible:'yes'})}});
