import {createMorningBankTransactionLinker} from '../../netunim-orders/site/assets/js/domains/customers/morning-bank-transaction-link.js';
import {createMorningBankLinkForm} from '../../netunim-orders/site/assets/js/domains/customers/morning-bank-link-form.js';
/** @type {import('../../netunim-orders/site/assets/js/domains/customers/morning-bank-link-form.js').BankSource} */ const source={kind:'standalone'};
const formPorts={source:{read:()=>source,set:()=>undefined},fields:{get:()=>null,query:()=>null,date:()=>undefined},payments:{read:()=>[],replace:()=>false,sync:()=>undefined},document:{type:()=>320,sync:()=>undefined}};
const form=createMorningBankLinkForm(formPorts);
const ports={session:{generation:()=>1,isActive:()=>true},catalog:{read:()=>({unexpected:'raw JSON'}),ensure:async()=>undefined},policy:{eligible:()=>({eligible:false}),prefill:()=>({source,customerName:'Exact',amount:42,date:'2026-10-14',description:'Exact bank',payment:[]})},form,presentation:{panel:()=>'',exists:()=>true,query:()=>'',render:()=>0,select:()=>undefined,blur:()=>undefined,toast:()=>undefined,error:()=>undefined}};
const owner=createMorningBankTransactionLinker(ports);
/** @type {Promise<boolean>} */ const refreshing=owner.refresh();void refreshing;
/** @type {boolean} */ const linked=owner.link('71');void linked;
// @ts-expect-error deferred form effects cannot cross a replacement account
createMorningBankTransactionLinker({...ports,form:{...form,link:async()=>{}}});
// @ts-expect-error a deferred permission cannot grant current form authority
createMorningBankTransactionLinker({...ports,session:{...ports.session,isActive:async()=>true}});
// @ts-expect-error eligibility must return an explicitly boolean grant
createMorningBankTransactionLinker({...ports,policy:{...ports.policy,eligible:()=>({eligible:'approved'})}});
// @ts-expect-error catalog rows begin unknown and cannot be treated as raw authority
createMorningBankTransactionLinker({...ports,policy:{...ports.policy,prefill:/** @param {{archiveId:number}} row */ row=>({source,customerName:'Exact',amount:row.archiveId,date:'2026-10-14',description:'Exact bank',payment:[]})}});
// @ts-expect-error publication must return a ready synchronous result
createMorningBankTransactionLinker({...ports,presentation:{...ports.presentation,render:async()=>0}});
// @ts-expect-error error publication cannot escape its current request check
createMorningBankTransactionLinker({...ports,presentation:{...ports.presentation,error:async()=>{}}});
// @ts-expect-error caller cannot fabricate a type selection from async editor state
createMorningBankLinkForm({...formPorts,document:{...formPorts.document,type:async()=>320}});
// @ts-expect-error source replacement must be synchronous
createMorningBankLinkForm({...formPorts,source:{...formPorts.source,set:async()=>{}}});
// @ts-expect-error Bank amount cannot be presentation text in the typed form command
form.link({...ports.policy.prefill(),amount:'42'},null,source,form.capture());
// @ts-expect-error link capability has no provider or journal writer API
owner.createDocument();
