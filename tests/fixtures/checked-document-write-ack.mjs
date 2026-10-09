// Compile-only Main receipt consumers. Invalid calls must never be executed.
import {readDocumentWriteAck,documentWriteAckRevision} from '../../shared/document-write-ack.js';
import {readDocumentWriteAck as readKupaAck} from '../../netunim-kupa/site/assets/js/shared/document-write-ack.js';
import {readDocumentWriteAck as readOrdersAck} from '../../netunim-orders/site/assets/js/shared/document-write-ack.js';

/** @type {unknown} */ const response={revision:11,state:{notes:[{id:'N',content:'sent'}]}};
const sentState={notes:[{id:'N',content:'sent'}]};
/** @param {Record<string, unknown>} raw */
function prepareState(raw){
  // This fixture's owner validates the shape before producing its typed model.
  if(!Array.isArray(raw.notes))throw new Error('missing notes');
  return sentState;
}
const options={baseRevision:10,sentState,prepareState};
const receipt=readDocumentWriteAck(response,options);
readKupaAck(response,options);readOrdersAck(response,options);
/** @type {number} */ const revision=receipt.revision;
/** @type {number | null} */ const operationRevision=receipt.operationRevision;
/** @type {boolean} */ const replayed=receipt.replayed;
const first=receipt.state.notes[0];if(first){/** @type {string} */ const id=first.id;void id}
documentWriteAckRevision(response,{baseRevision:10,sentState,authoritativeState:sentState});
// @ts-expect-error numeric expected revision is required at the trusted call boundary
readDocumentWriteAck(response,{...options,baseRevision:'10'});
// @ts-expect-error a document preparation port is mandatory
readDocumentWriteAck(response,{baseRevision:10,sentState});
// @ts-expect-error the sent document is required
readDocumentWriteAck(response,{baseRevision:10,prepareState});
// @ts-expect-error preparation is synchronous before durable ACK begins
readDocumentWriteAck(response,{...options,prepareState:async()=>sentState});
// @ts-expect-error preparation must produce an object document
readDocumentWriteAck(response,{...options,prepareState:()=>[]});
// @ts-expect-error missing preparation output cannot become an ACK document
readDocumentWriteAck(response,{...options,prepareState:()=>undefined});
// @ts-expect-error arbitrary callbacks cannot become persisted state
readDocumentWriteAck(response,{...options,prepareState:()=>({callback:()=>{}})});
// @ts-expect-error the equality port is synchronous boolean evidence
readDocumentWriteAck(response,{...options,equalState:async()=>true});
// @ts-expect-error void-returning equality is not evidence
readDocumentWriteAck(response,{...options,equalState:()=>{}});
// @ts-expect-error errors must remain stable string codes
readDocumentWriteAck(response,{...options,stateErrorCode:404});
// @ts-expect-error revisions cannot be mistaken for timestamps
/** @type {string} */ const wrongRevision=receipt.revision;
// @ts-expect-error an optional operation revision cannot be treated as always present
/** @type {number} */ const missingOperationRevision=receipt.operationRevision;
// @ts-expect-error preserved state fields are checked
/** @type {number} */ const wrongNote=receipt.state.notes[0]?.id;
// @ts-expect-error generated Kupa receipts check actual implementation and ports
readKupaAck(response,{...options,prepareState:async()=>sentState});
// @ts-expect-error generated Orders receipts check actual implementation and ports
readOrdersAck(response,{...options,baseRevision:'10'});
// @ts-expect-error compatibility metadata consumers still need a numeric base
documentWriteAckRevision(response,{baseRevision:'10'});
void revision;void operationRevision;void replayed;
