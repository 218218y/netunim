import assert from 'node:assert/strict';
import {bankReturnedCheque,bankReturnedChequeReason,bankWarningItems} from '../netunim-orders/site/assets/js/domains/bank/alerts.js';
import {createDomainsFinanceController} from '../netunim-orders/site/assets/js/domains/finance/controller.js';
import {createUiAlertCenter} from '../netunim-orders/site/assets/js/ui/alert-center.js';

const returned={
  archiveId:21,
  date:'2026-08-21T09:00:00.000Z',
  amount:1250,
  description:'החזרת שיק',
  messageHeadline:'סיבת החזרה:',
  messageDetail:'· א.כ.מ - אין כיסוי מספיק',
  presenceState:'present',
  alertAcknowledgements:{},
};
assert.equal(bankReturnedCheque(returned),true,'the exact Hapoalim returned-cheque activity is recognized');
assert.equal(bankReturnedChequeReason(returned),'א.כ.מ - אין כיסוי מספיק','the return reason is extracted without the bank label/bullet noise');
for(const description of ['החזרת שיקים','החזרת צ׳ק','החזרת צ\'ק','החזרת המחאה','החזרת המחאות','שיק הוחזר','צ׳ק חזר','Returned cheque']){
  assert.equal(bankReturnedCheque({...returned,description}),true,`explicit returned-cheque spelling is recognized: ${description}`);
}
for(const row of [
  {...returned,description:'הפקדת שיק'},
  {...returned,description:'פירעון שיק'},
  {...returned,description:'עמלה',memo:'החזרת שיק'},
  {...returned,description:'העברה',messageDetail:'סיבת החזרה: א.כ.מ'},
])assert.equal(bankReturnedCheque(row),false,'free-form memo/details cannot manufacture a returned-cheque alert');

const missing={
  archiveId:44,
  date:'2026-08-20T09:00:00.000Z',
  amount:900,
  description:'הפקדת שיק',
  cheque:true,
  presenceState:'missing',
  lastSeenAt:'2026-09-05T02:00:00.000Z',
  missingSince:'2026-09-06T02:00:00.000Z',
  missingAcknowledgedAt:null,
  alertAcknowledgements:{},
};
const bank={feed:{transactions:[returned,missing]},homeFeed:{transactions:[]}};
let warnings=bankWarningItems(bank);
assert.deepEqual(warnings.map(x=>x.kind),['bank_returned_cheque','bank_missing'],'returned cheque is surfaced ahead of the durable missing-bank incident');
assert.equal(warnings[0].reason,'א.כ.מ - אין כיסוי מספיק');
assert.equal(warnings[0].account,'עסקי');
assert.equal(warnings[1].cheque,true,'a disappeared known cheque deposit keeps its cheque-specific warning context');

warnings=bankWarningItems({feed:{transactions:[
  {...returned,alertAcknowledgements:{returned_cheque:'2026-09-06T12:00:00.000Z'}},
  {...missing,missingAcknowledgedAt:'2026-09-06T12:01:00.000Z'},
]},homeFeed:{transactions:[]}});
assert.equal(warnings.length,0,'each acknowledgement suppresses only its own durable bank incident');
assert.equal(bankWarningItems({feed:{transactions:[{...returned,archiveId:null}]}}).length,0,'an undurable feed row is never exposed as an alert that cannot be acknowledged');

Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});

const baselinedAt='2026-09-06T12:10:00.000Z';
const staleChecksSession={kupaCloudReadState:{bank:{feed:{provider:'hapoalim',accountNumber:'12-655-1',balance:5000,syncedAt:'2026-09-06T12:00:00.000Z',transactions:[{...returned,alertAcknowledgements:{}}]}},creditSync:{},cards:[],credits:[]},checksBankEvents:[]};
const staleController=createDomainsFinanceController({
  tab:{primaryTab:true},checksSession:staleChecksSession,
  bridge:{bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=>'daily',getBridgeToken:()=>'',setBankAutoEnabled(){},setCreditAutoEnabled(){},setCreditAutoMode(){}},
  loadSession:()=>({access_token:'x'}),refreshKupaReadout:async()=>true,readKupaReadOnlyCloud:async()=>null,rpcSaveKupaDocument:async()=>null,acceptKupaCloudRow:()=>true,
  syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,getSharedChecks:()=>[],toast:()=>{},
  readBankTransactions:async()=>[{...returned,id:'returned-row',alertAcknowledgements:{returned_cheque:baselinedAt}}],readBankTransactionSnapshot:async()=>null,
});
const staleAlertCenter=createUiAlertCenter({model:{state:{checks:[]}},financeSnapshot:()=>staleController.snapshot()});
assert.equal(staleController.snapshot().bankAlertsReady,false,'bank alerts remain untrusted until the durable archive for the current bank sync is hydrated');
assert.equal(staleAlertCenter.currentAlerts().length,0,'a stale finance-document copy cannot flash an already-acknowledged returned-cheque warning before archive hydration');
await staleController.ensureBankDisplayArchive();
assert.equal(staleController.snapshot().bankAlertsReady,true,'bank alerts become eligible only after the matching durable archive is loaded');
assert.equal(staleAlertCenter.currentAlerts().length,0,'the durable archive acknowledgement keeps the historical returned cheque suppressed after hydration');

let releaseOldArchive;
const oldArchiveRead=new Promise(resolve=>{releaseOldArchive=resolve});
let raceArchiveReads=0;
const raceChecksSession={kupaCloudReadState:{bank:{feed:{provider:'hapoalim',accountNumber:'12-655-1',balance:5000,syncedAt:'2026-09-06T12:00:00.000Z',transactions:[{...returned,alertAcknowledgements:{}}]}},creditSync:{},cards:[],credits:[]},checksBankEvents:[]};
const raceController=createDomainsFinanceController({
  tab:{primaryTab:true},checksSession:raceChecksSession,
  bridge:{bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=>'daily',getBridgeToken:()=>'',setBankAutoEnabled(){},setCreditAutoEnabled(){},setCreditAutoMode(){}},
  loadSession:()=>({access_token:'x'}),refreshKupaReadout:async()=>true,readKupaReadOnlyCloud:async()=>null,rpcSaveKupaDocument:async()=>null,acceptKupaCloudRow:()=>true,
  syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,getSharedChecks:()=>[],toast:()=>{},
  readBankTransactions:async()=>{raceArchiveReads++;if(raceArchiveReads===1)return oldArchiveRead;return [{...returned,id:'returned-row',alertAcknowledgements:{returned_cheque:baselinedAt}}]},readBankTransactionSnapshot:async()=>null,
});
const firstRaceHydration=raceController.ensureBankDisplayArchive();
await Promise.resolve();
raceChecksSession.kupaCloudReadState.bank.feed.syncedAt='2026-09-06T12:05:00.000Z';
const secondRaceHydration=raceController.ensureBankDisplayArchive();
releaseOldArchive([{...returned,id:'returned-row',alertAcknowledgements:{}}]);
await Promise.all([firstRaceHydration,secondRaceHydration]);
assert.equal(raceArchiveReads,2,'a finance refresh arriving during archive hydration queues verification of the newer bank sync instead of accepting the stale read');
assert.equal(raceController.snapshot().bankAlertsReady,true,'the archive cache finishes aligned to the newest bank sync after an in-flight refresh race');
assert.equal(bankWarningItems(raceController.snapshot().bank).length,0,'the stale in-flight archive cannot resurrect an acknowledged historical warning');
const acknowledgementAt='2026-09-06T12:30:00.000Z';
const checksSession={kupaCloudReadState:{bank:{feed:{provider:'hapoalim',accountNumber:'12-655-1',balance:5000,syncedAt:'2026-09-06T12:00:00.000Z',transactions:[]}},creditSync:{},cards:[],credits:[]},checksBankEvents:[]};
let archiveReads=0,ackCalls=0,missingAckCalls=0;
const controller=createDomainsFinanceController({
  tab:{primaryTab:true},checksSession,
  bridge:{bankAutoEnabled:()=>false,creditAutoEnabled:()=>false,creditAutoMode:()=>'daily',getBridgeToken:()=>'',setBankAutoEnabled(){},setCreditAutoEnabled(){},setCreditAutoMode(){}},
  loadSession:()=>({access_token:'x'}),refreshKupaReadout:async()=>true,readKupaReadOnlyCloud:async()=>null,rpcSaveKupaDocument:async()=>null,acceptKupaCloudRow:()=>true,
  syncSharedChecksFromCloud:async()=>true,saveSharedChecksToCloud:async()=>true,checksHaveLocalWork:()=>false,getSharedChecks:()=>[],toast:()=>{},
  readBankTransactions:async()=>{archiveReads++;return [{...returned,id:'returned-row'},{...missing,id:'missing-row'}]},readBankTransactionSnapshot:async()=>null,
  acknowledgeBankTransactionMissing:async id=>{missingAckCalls++;assert.equal(id,44);return {transaction_id:id,acknowledged_at:acknowledgementAt}},
  acknowledgeBankTransactionAlert:async(id,kind)=>{ackCalls++;assert.equal(id,21);assert.equal(kind,'returned_cheque');return {transaction_id:id,alert_kind:kind,acknowledged_at:acknowledgementAt}},
});
const liveAlertCenter=createUiAlertCenter({model:{state:{checks:[]}},financeSnapshot:()=>({bank:controller.snapshot().bank,bankAlertsReady:controller.snapshot().bankAlertsReady,kupa:null})});
assert.equal(controller.snapshot().bankAlertsReady,false,'fresh controller does not trust inline bank-feed alert metadata before archive hydration');
assert.equal(liveAlertCenter.currentAlerts().length,0,'genuine bank warnings wait for durable archive verification instead of using an inline projection');
await controller.ensureBankDisplayArchive();
assert.equal(controller.snapshot().bankAlertsReady,true,'matching archive hydration marks bank alert metadata authoritative');
assert.equal(liveAlertCenter.currentAlerts().length,2,'genuine unacknowledged bank warnings appear immediately after durable archive verification');
assert.equal(bankWarningItems(controller.snapshot().bank).length,2,'startup archive hydration exposes both durable bank warning types');
assert.equal(await controller.acknowledgePersistentBankAlert(21,'returned_cheque'),true);
assert.equal(ackCalls,1);
assert.equal(archiveReads,1,'successful dismissal updates the verified local archive immediately instead of requiring a second network read');
assert.deepEqual(bankWarningItems(controller.snapshot().bank).map(x=>x.kind),['bank_missing'],'returned-cheque acknowledgement suppresses only that incident');
assert.equal(await controller.acknowledgeMissingBankTransaction(44),true);
assert.equal(missingAckCalls,1);
assert.equal(archiveReads,1,'missing-transaction acknowledgement also updates the loaded archive without a redundant full-history reread');
assert.equal(bankWarningItems(controller.snapshot().bank).length,0,'both server acknowledgements are reflected immediately in the current alert center snapshot');

console.log('PASS bank alert models: returned-cheque detection is conservative, reasons are preserved, and durable dismissals are incident-specific');
