import {normalizeSharedChecks,normalizeSharedBankEvents,checkAccountData} from '../../shared/shared-checks-contract.js';
/** @type {unknown} */ const raw=JSON.parse('[]');
const checks=normalizeSharedChecks(raw),events=normalizeSharedBankEvents(raw);
for(const check of checks){
  /** @type {number} */ const amount=check.amount;
  /** @type {string} */ const id=check.id;
  /** @type {number|null} */ const seq=check.depositSeq;
  // @ts-expect-error Deposit authority can be absent.
  /** @type {number} */ const confirmed=check.depositSeq;
  // @ts-expect-error Unvalidated date metadata is not a certified timestamp.
  /** @type {string} */ const at=check.depositedAt;
  void [amount,id,seq,confirmed,at];
}
for(const event of events){
  /** @type {number} */ const seq=event.seq,delta=event.delta;
  // @ts-expect-error A bank event sequence cannot become text.
  /** @type {string} */ const label=event.seq;
  // @ts-expect-error A bank-effect event is not a cloud publication ACK.
  /** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=event;
  void [seq,delta,label,ack];
}
// @ts-expect-error Canonical account roles cannot become arbitrary source labels.
/** @type {'provider'} */ const role=checkAccountData(raw);
void role;
