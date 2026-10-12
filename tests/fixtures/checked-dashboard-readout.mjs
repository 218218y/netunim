// @ts-check
import {createDomainsDashboardController} from '../../netunim-kupa/site/assets/js/domains/dashboard/controller.js';

/** @type {import('../../netunim-kupa/site/assets/js/domains/dashboard/controller.js').OrdersFinanceSummary} */
const summary = {customerOpen:10, customerOpenCount:1, supplierDebt:0, supplierCredit:0, supplierNet:0};
const ports = {
  access:{current:() => ({account:{owner:'A', epoch:1}, readable:true, online:true}), subscribe:() => () => {}},
  remote:{readMeta:async () => ({revision:1}), readDocument:async () => ({revision:1, state:{}})},
  project:() => summary, onChange:() => {}, onError:() => {}, clock:() => 100_000,
};
const owner = createDomainsDashboardController(ports);
owner.runtime.start();
const ready = owner.refreshOrdersFinanceSummary({force:true, renderIfChanged:false});
/** @type {Promise<boolean>} */
const result = ready;
owner.runtime.drain();
const observed = owner.summary();
if (observed) {
  /** @type {number} */
  const balance = observed.customerOpen;
  // @ts-expect-error a consumer cannot mutate an attributed read model
  observed.customerOpen = balance;
}
// @ts-expect-error a login epoch must be numeric
createDomainsDashboardController({...ports, access:{...ports.access, current:() => ({account:{owner:'A', epoch:'1'}, readable:true, online:true})}});
// @ts-expect-error online is an observation, not a UI string
createDomainsDashboardController({...ports, access:{...ports.access, current:() => ({account:{owner:'A', epoch:1}, readable:true, online:'online'})}});
// @ts-expect-error the projection must return numeric business values
createDomainsDashboardController({...ports, project:() => ({...summary, customerOpen:'10'})});
// @ts-expect-error callers cannot substitute a string for force
owner.refreshOrdersFinanceSummary({force:'yes'});
// @ts-expect-error metadata is a read envelope, not a revision scalar
createDomainsDashboardController({...ports, remote:{...ports.remote, readMeta:async () => 1}});
void result;
