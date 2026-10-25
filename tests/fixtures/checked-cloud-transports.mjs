import {createCloudTransport as orders} from '../../netunim-orders/site/assets/js/cloud/transport.js';
import {createCloudTransport as kupa} from '../../netunim-kupa/site/assets/js/cloud/transport.js';
/** @type {import('../../shared/cloud-transport-contracts.js').Request} */
const request=async()=>new Response('[]');
const a=orders({supaFetch:request}),b=kupa({supaRest:request,session:{cloudDocumentName:'main'}});
const document=await a.readCloud();
if(document){
  /** @type {number} */ const revision=document.revision;
  // @ts-expect-error decoded JSON money is not proven by document admission
  /** @type {number} */ const amount=document.state.amount;
  void [revision,amount];
}
const raw=await b.rpcSaveFinanceSync({},0,'operation');
// @ts-expect-error the raw response is not a verified cloud ACK
/** @type {import('../../shared/storage-journal-contracts.js').CloudAck} */ const ack=raw.row;
// @ts-expect-error JSON is unknown until its canonical reader accepts it
raw.j.revision;
// @ts-expect-error HTTP success supplies no local commit receipt
/** @type {import('../../shared/storage-journal-contracts.js').AppendAdmission} */ const committed=raw;
// @ts-expect-error a deferred authority check must not authorize dispatch
a.readFinanceSyncDocument({assertCurrent:async()=>undefined});
// @ts-expect-error restore apply requires a stable string group identity
a.applyRestoreGroup(200);
// @ts-expect-error a string response is not an HTTP result
orders({supaFetch:async()=> 'saved'});
// @ts-expect-error Kupa document identity is not a numeric status
kupa({supaRest:request,session:{cloudDocumentName:200}});
const state=await b.readStorageProtocolState();
// @ts-expect-error protocol evidence remains unknown for its dedicated reader
state.version;
void [ack,committed];
