

export function createDashboardActions({domainsDashboardView,domainsFinanceView,ui}){
const setSummarySupplierYearView=(...args)=>{domainsDashboardView.setSummarySupplierYearView(...args,{render:false});if(ui.currentView==='kupa')domainsFinanceView.renderKupa();else domainsDashboardView.renderSummary()};
const actions={
  'set-summary-supplier-year-view':(element,event)=>{setSummarySupplierYearView(element.value)},
};
return actions;
}
