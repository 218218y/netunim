import {createCalendarDeliveryOwner} from '../../netunim-orders/site/assets/js/platform/calendar-delivery-owner.js';
const owner=createCalendarDeliveryOwner();
/** @type {Promise<number>} */ const outcome=owner.run(()=>{},async()=>1);
// @ts-expect-error authority must be a live function, not a cached boolean
owner.run(true,async()=>1);
// @ts-expect-error cancellation must use a real signal, not a cached flag
owner.run(()=>{},async()=>1,{signal:true});
// @ts-expect-error work settlement determines lock lifetime; a void callback is not a receipt
owner.run(()=>{},()=>{});
// @ts-expect-error native lock ownership is required, not an in-memory boolean
createCalendarDeliveryOwner({locks:true});
// @ts-expect-error delivery is not synchronously confirmed by calling run
/** @type {number} */ const confirmed=outcome;
void confirmed;void outcome;
