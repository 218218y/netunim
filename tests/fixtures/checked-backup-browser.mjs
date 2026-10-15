import {createBackupBrowserResources} from '../../shared/backup-browser-resources.js';
import {createBackupFileAuthority} from '../../shared/backup-file-authority.js';
import {createBackupBrowserResources as orders} from '../../netunim-orders/site/assets/js/shared/backup-browser-resources.js';
import {createBackupBrowserResources as kupa} from '../../netunim-kupa/site/assets/js/shared/backup-browser-resources.js';

const authority=createBackupFileAuthority({owner:()=> 'local',generation:()=>1,account:()=>({owner:null,epoch:0}),writable:()=>true});
/** @type {true} */ export const current=authority.capture('restore').assertCurrent();
const resources=createBackupBrowserResources({authority});
orders({authority});kupa({authority});
/** @type {Promise<number|null>} */ export const selected=resources.choose(raw=>JSON.parse(raw).length,50);
/** @type {Promise<string|null>} */ export const read=resources.read({name:'backup.json',size:2,text:async()=> '{}'},raw=>raw);
/** @type {Promise<boolean|null>} */ export const accepted=resources.run(resources.capture(),async()=>true);
// @ts-expect-error Deferred authority cannot authorize native file work.
createBackupBrowserResources({authority:{capture:async()=>({assertCurrent:()=>true})}});
// @ts-expect-error A proof must be synchronous, even when a promise resolves true.
createBackupBrowserResources({authority:{capture:()=>({assertCurrent:async()=>true})}});
// @ts-expect-error Text status is not primary-writer authority.
createBackupFileAuthority({owner:()=> 'local',generation:()=>1,account:()=>({owner:null,epoch:0}),writable:()=> 'ready'});
// @ts-expect-error Login epochs are numeric evidence.
createBackupFileAuthority({owner:()=> 'local',generation:()=>1,account:()=>({owner:'A',epoch:'1'}),writable:()=>true});
// @ts-expect-error Native read bytes cannot become a number.
resources.read({name:'backup.json',size:2,text:async()=>7},raw=>raw);
// @ts-expect-error No restore starts from an unproven scope.
resources.run({assertCurrent:()=>true},async()=>true);
// @ts-expect-error Accepted read/restore draining cannot be treated as a sync flag.
/** @type {boolean} */ export const drained=resources.runtime.drain();
