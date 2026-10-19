import {createLazyTaxCalculator} from '../shared/tax-calculator/entry.js';
export function createKupaTaxCalculator({cloudAuth,tab,ui,navigation,modal}) {
  return createLazyTaxCalculator({
    accountScope:()=>cloudAuth.getAccountScope(),subscribeAccountScope:listener=>cloudAuth.subscribeAccountScope(listener),
    request:(...args)=>cloudAuth.supaRest(...args),writable:()=>tab.primaryTab,
    active:()=>ui.currentPage==='tax-calculator',container:()=>document.getElementById('content'),
    currentPage:()=>ui.currentPage,defaultPage:'dashboard',navigate:page=>navigation.setPage(page),
    confirmDialog:(...args)=>modal.confirmDialog(...args),
  });
}
