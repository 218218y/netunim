// @ts-check
import {selectKupaCreditDetail} from '../../netunim-kupa/site/assets/js/domains/credit/detail-read-model.js';
import {selectOrdersCreditDetail} from '../../netunim-orders/site/assets/js/domains/finance/credit-detail-read-model.js';
import {creditDetailMonthlySections} from '../../shared/credit-detail-policy.js';
/** @type {import('../../shared/credit-detail-read-contracts.js').DetailQuery} */
const query={creditDetailMode:'month',creditDetailChargeDay:'all',creditDetailFocus:null,
  creditAccountFilter:'all',creditProviderFilter:'all',creditCardFilter:'all',creditView:'all',creditDateFrom:'',creditDateTo:''};
const rows=[{amount:3,marker:'retained',date:'2026-10-10'}];
const months=[{key:'2026-10',total:3,items:rows}];
/** @type {import('../../shared/credit-detail-read-contracts.js').KupaDetailInput<typeof rows[number]>} */
const kupa={prepared:{detail:{months},upcoming:{items:rows}},query,reference:'2026-10-01',matches:row=>row.marker.length>0};
/** @type {import('../../shared/credit-detail-read-contracts.js').OrdersDetailInput<typeof rows[number]>} */
const orders={allMonths:months,upcomingRows:rows,query,reference:'2026-10-01',matches:row=>row.marker.length>0};
selectKupaCreditDetail(kupa).focusedCount.toFixed();
selectOrdersCreditDetail(orders).focusedCount.toFixed();
selectKupaCreditDetail(kupa).detailItems[0]?.marker.toUpperCase();
selectOrdersCreditDetail(orders).items[0]?.marker.toUpperCase();
creditDetailMonthlySections(rows).ordered[0]?.amount.toFixed();
// @ts-expect-error a matched row retains its numeric amount type
creditDetailMonthlySections(rows).ordered[0]?.amount.toUpperCase();
// @ts-expect-error display matching must be synchronous
selectKupaCreditDetail({...kupa,matches:async()=>true});
// @ts-expect-error display matching must be synchronous
selectOrdersCreditDetail({...orders,matches:async()=>true});
// @ts-expect-error date input is a captured calendar day, not a timestamp number
selectOrdersCreditDetail({...orders,reference:42});
// @ts-expect-error textual money is not a validated numeric display row
selectKupaCreditDetail({...kupa,prepared:{detail:{months},upcoming:{items:[{amount:'3'}]}}});
// @ts-expect-error card focus needs a stable string identity
selectOrdersCreditDetail({...orders,query:{...query,creditDetailFocus:{monthKey:'2026-10',cardKey:3}}});
