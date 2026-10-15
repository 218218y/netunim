import {createSpreadsheetRemote} from '../../shared/spreadsheet-remote.js';
import {createSpreadsheetRemote as createKupa} from '../../netunim-kupa/site/assets/js/shared/spreadsheet-remote.js';
import {createSpreadsheetRemote as createOrders} from '../../netunim-orders/site/assets/js/shared/spreadsheet-remote.js';
/** @typedef {{cells:string[]}} Workbook */
/** @param {unknown} raw @returns {Workbook} */
function decodeState(raw){
  if(!raw||typeof raw!=='object'||!('cells' in raw)||!Array.isArray(raw.cells)||!raw.cells.every(value=>typeof value==='string'))throw new Error('invalid');
  return {cells:raw.cells};
}
/** @type {import('../../shared/spreadsheet-remote.js').SpreadsheetFetch} */
const request=async()=>({ok:true,status:200,text:async()=> '[]'});
const access={capture:()=>()=>undefined},equalState=(/** @type {Workbook} */ a,/** @type {Workbook} */ b)=>JSON.stringify(a)===JSON.stringify(b);
const api=createSpreadsheetRemote({domain:'orders',request,access,decodeState,equalState});
createKupa({domain:'kupa',request,access,decodeState,equalState});createOrders({domain:'orders',request,access,decodeState,equalState});
/** @type {Promise<import('../../shared/spreadsheet-remote.js').SpreadsheetDocument<Workbook>|null>} */
const document=api.readDocument();
/** @type {Promise<import('../../shared/spreadsheet-remote.js').SpreadsheetAck<Workbook>>} */
const ack=api.write({state:{cells:[]},payload:{p_expected_revision:1}}, {cells:[]});
void document;void ack;
// @ts-expect-error Raw wire bodies cannot be validated record objects.
createSpreadsheetRemote({domain:'orders',request:async()=>({ok:true,status:200,text:async()=>({revision:7})}),access,decodeState,equalState});
// @ts-expect-error An asynchronous function cannot guard request/retry/body authority.
createSpreadsheetRemote({domain:'orders',request,access:{capture:()=>async()=>{}},decodeState,equalState});
// @ts-expect-error A codec must finish validating a workbook synchronously.
createSpreadsheetRemote({domain:'orders',request,access,decodeState:async()=>({cells:[]}),equalState:()=>true});
// @ts-expect-error Metadata reads supply no workbook or operation ACK.
api.readRevision().then(value=>value?.state);
api.readDocument().then(value=>{
  // @ts-expect-error The decoded state remains the domain codec's actual type.
  /** @type {number} */ const wrong=value?.state.cells;void wrong;
});
api.backups().then(value=>{
  // @ts-expect-error Backup metadata is not a workbook save ACK.
  /** @type {import('../../shared/spreadsheet-remote.js').SpreadsheetAck<Workbook>} */ const wrong=value[0];void wrong;
});
