import {cashflowAlertForAccount,normalizeCashflowSettings} from '../../shared/cashflow.js';
import {cashflowNotificationData} from '../../shared/cashflow-notification.js';
const settings=normalizeCashflowSettings({businessMinimum:null,homeMinimum:0});
/** @type {number|null} */ const threshold=settings.businessMinimum;
const alert=cashflowAlertForAccount(null,settings,'business');
if(alert.reason==='unavailable'){
  /** @type {null} */ const missing=alert.projected;
  // @ts-expect-error missing evidence cannot become a real zero balance
  /** @type {number} */ const known=alert.projected;
  // @ts-expect-error an unavailable projection cannot be an active breach
  /** @type {true} */ const active=alert.active;
  void [missing,known,active];
}
const warning=cashflowNotificationData({account:'business',balance:0,projected:null,creditRows:[{amount:0,date:'2026-12-31'}]});
// @ts-expect-error absence of a breach has no numeric day count
/** @type {number} */ const days=warning.daysUntilBreach;
// @ts-expect-error notification text is not a local or cloud commit receipt
/** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=warning;
void [threshold,days,ack];
