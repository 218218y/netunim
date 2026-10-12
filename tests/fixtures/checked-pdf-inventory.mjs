import {createPdfInventory} from '../../netunim-orders/document-bridge/pdf-inventory.mjs';
import {decodeEverythingCount,decodeEverythingRows} from '../../netunim-orders/document-bridge/everything-result-codec.mjs';
/** @type {{open: (signal:AbortSignal|null) => Promise<import('../../netunim-orders/document-bridge/pdf-inventory.mjs').PdfInventorySession<{fullPath:string,extension:string,isDirectory:boolean,text:string}>>,isStopping:()=>boolean}} */
const ports={open:async()=>({count:async()=>0,page:async()=>[]}),isStopping:()=>false};
const inventory=createPdfInventory(ports,{pageSize:250});inventory.read().then(rows=>rows[0]?.text.slice(0,1));inventory.assertActive(null);
// @ts-expect-error counts are asynchronous numeric evidence
createPdfInventory({...ports,open:async()=>({count:async()=>'0',page:async()=>[]})},{pageSize:250});
// @ts-expect-error full-path identity stays string typed at the boundary
createPdfInventory({...ports,open:async()=>({count:async()=>0,page:async()=>[{fullPath:1,extension:'pdf',isDirectory:false}]})},{pageSize:250});
// @ts-expect-error page size is numeric
createPdfInventory(ports,{pageSize:'250'});
// @ts-expect-error commands cannot smuggle an untyped abort signal
inventory.read({signal:'aborted'});
// @ts-expect-error redirected stdout is text, not a generic object
decodeEverythingCount({count:1});
// @ts-expect-error normalization is synchronous before any page can be accepted
decodeEverythingRows('[]',async()=>({fullPath:'C:\\synthetic.pdf'}));
