import {financeMoneySum} from '../../shared/business-position.js';
function finite(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}

export function dashboardNetPositionData(longPosition,ordersSummary){
  const long=longPosition&&typeof longPosition==='object'?longPosition:{},base=finite(long.net),summary=ordersSummary&&typeof ordersSummary==='object'?ordersSummary:null;
  if(!summary)return {...long,customerOpen:null,supplierNet:null,net:null};
  const customerOpen=finite(summary.customerOpen),supplierNet=finite(summary.supplierNet);
  return {...long,customerOpen,supplierNet,net:base===null||customerOpen===null||supplierNet===null?null:financeMoneySum([base,customerOpen,supplierNet])};
}
