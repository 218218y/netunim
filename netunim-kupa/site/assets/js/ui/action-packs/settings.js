// Settings owns these delegated UI actions and its local event ports.
export function createSettingsActions({uiSettings}){
const updateCard=(...args)=>uiSettings.updateCard(...args);
const updateCashflowMinimum=(...args)=>uiSettings.updateCashflowMinimum(...args);
return {
  'update-card':(element,event)=>{updateCard(Number(element.dataset.changeArg0),'name',element.value)},
  'update-card-2':(element,event)=>{updateCard(Number(element.dataset.changeArg0),'account',element.value)},
  'update-card-3':(element,event)=>{updateCard(Number(element.dataset.changeArg0),'chargeDay',Number(element.value))},
  'update-card-4':(element,event)=>{updateCard(Number(element.dataset.changeArg0),'active',element.value==='כן')},
  'update-cashflow-minimum':(element,event)=>{updateCashflowMinimum(element.dataset.changeArg0,element.value)},
};
}
