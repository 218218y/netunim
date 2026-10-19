import {createLazyTaxCalculator} from '../shared/tax-calculator/entry.js';
export function createOrdersTaxCalculator({cloudAuth,tab,ui,navigation,modal}) {
  return createLazyTaxCalculator({
    accountScope:()=>cloudAuth.getAccountScope(),subscribeAccountScope:listener=>cloudAuth.subscribeAccountScope(listener),
    request:(...args)=>cloudAuth.supaFetch(...args),writable:()=>tab.primaryTab,
    active:()=>ui.currentView==='tax-calculator',container:()=>document.getElementById('main'),
    currentPage:()=>ui.currentView,defaultPage:'kupa',navigate:view=>navigation.switchView(view),
    confirmDialog:(...args)=>modal.confirmDialog(...args),
  });
}
