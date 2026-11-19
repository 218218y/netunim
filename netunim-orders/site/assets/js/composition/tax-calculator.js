import {createLazyTaxCalculator} from '../shared/tax-calculator/entry.js';
export function createOrdersTaxCalculator({cloudAuth,tab,ui,navigation,modal,morningOperationScope}) {
  return createLazyTaxCalculator({
    accountScope:()=>cloudAuth.getAccountScope(),subscribeAccountScope:listener=>cloudAuth.subscribeAccountScope(listener),
    request:(...args)=>cloudAuth.supaFetch(...args),writable:()=>tab.primaryTab,
    active:()=>ui.currentView==='tax-calculator',container:()=>document.getElementById('main'),
    currentPage:()=>ui.currentView,defaultPage:'kupa',navigate:view=>navigation.switchView(view),
    confirmDialog:(...args)=>modal.confirmDialog(...args),
    async loadMorningBusiness(options) {
      let scope;
      try { scope=morningOperationScope.captureRead(); }
      catch { throw new Error('יש להתחבר לחשבון הענן של העסק כדי לקרוא נתוני Morning'); }
      const [{createMorningRequest},{readMorningTaxBusiness}]=await Promise.all([
        import('../integrations/morning.js'),import('../domains/finance/morning-tax-business.js'),
      ]);
      const request=createMorningRequest({supaFetch:(...args)=>cloudAuth.supaFetch(...args),operationScope:morningOperationScope});
      return readMorningTaxBusiness({...options,request:request.json,scope});
    },
  });
}
