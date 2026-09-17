import {num} from '../../core/money.js';

const BASE_LEDGER_TYPES=['יתרת פתיחה / ספירה','הכנסה','הוצאה','התאמה'];

export function ledgerTypePolarity(type){return type==='הכנסה'?1:type==='הוצאה'?-1:0}
export function applyLedgerTypeSign(type,amount){const value=num(amount),polarity=ledgerTypePolarity(type);return polarity?polarity*Math.abs(value):value}
export function ledgerEditorAmount(type,amount){if(amount===undefined||amount===null||amount==='')return '';const value=num(amount);return ledgerTypePolarity(type)?Math.abs(value):value}
export function ledgerTypeLabel(collection,type){const value=String(type||'');if(collection==='rights'){if(value==='הכנסה')return 'זכות למעשר';if(value==='הוצאה')return 'חובה למעשר'}return value}
export function ledgerTypeOptions(collection){return BASE_LEDGER_TYPES.map(value=>({value,label:ledgerTypeLabel(collection,value)}))}

export function cashBalanceData(state){return state.cash.reduce((a,x)=>a+num(x.amount),0)}
export function rightsBalanceData(state){return (state.rights||[]).reduce((a,x)=>a+num(x.amount),0)}
