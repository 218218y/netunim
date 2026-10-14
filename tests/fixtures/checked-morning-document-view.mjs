import {createMorningDocumentView} from '../../netunim-orders/site/assets/js/domains/customers/morning-document-view.js';
const ports={format:{esc:/** @param {unknown} value */ value=>String(value),money:/** @param {number} value */ value=>String(value)},financial:{changes:()=>({payment:false,invoice:false,changed:false})}};
const view=createMorningDocumentView(ports),snapshot={amount:100,paymentApplied:0,invoiceApplied:0,paymentComplete:false,invoiceComplete:false};
const context={operationId:'bound-operation',debtId:'exact-debt',type:320,amount:30,applyPayment:true,applyInvoice:true,financialSnapshot:snapshot};
/** @type {string} */ const markup=view.decision(context,snapshot);void markup;
/** @type {string|null} */ const operation=view.operation({state:'created',verified_at:'2026-10-14T00:00:00Z'});void operation;
const form={generation:1,kind:'debt',dates:{document:'<date/>',due:'<date/>'},panels:{bankTransactions:'',bankDebts:'',debtUpdate:view.debt(snapshot),payments:''}};
view.form({customerName:'Exact customer',amount:30},320,form);
// @ts-expect-error formatter must return ready text, never defer into another display
createMorningDocumentView({...ports,format:{...ports.format,esc:async()=>''}});
// @ts-expect-error a text financial change flag cannot choose allocation defaults
createMorningDocumentView({...ports,financial:{changes:()=>({payment:'changed',invoice:false,changed:true})}});
// @ts-expect-error a deferred financial comparison cannot authorize checkbox defaults
createMorningDocumentView({...ports,financial:{changes:async()=>({payment:false,invoice:false,changed:false})}});
// @ts-expect-error presentation receives verified numeric financial snapshots
view.decision({...context,amount:'30'},snapshot);
// @ts-expect-error saved choice must remain explicitly boolean
view.decision({...context,applyPayment:'approved'},snapshot);
// @ts-expect-error presentation cannot mutate provider or journal through its capability
view.issue(context);
// @ts-expect-error generation must stay numeric in its rendered marker
view.form({},320,{...form,generation:'mounted'});
