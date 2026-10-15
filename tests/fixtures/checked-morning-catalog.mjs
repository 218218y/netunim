import {createMorningCatalog,defaultDocumentSearch} from '../../netunim-orders/site/assets/js/domains/customers/morning-catalog.js';
import {decodeMorningCatalogPage} from '../../netunim-orders/site/assets/js/domains/customers/morning-catalog-evidence.js';
const ports={authority:{capture:()=>()=>undefined},request:{json:async()=>/** @type {unknown} */({})},clock:{now:()=>0}};
const catalog=createMorningCatalog(ports);void catalog.search(defaultDocumentSearch());void catalog.metadata('operation');void catalog.runtime.drain();
/** @type {unknown} */const value={};
const page=decodeMorningCatalogPage(value);/** @type {number} */const total=page.total;void total;
// @ts-expect-error undecoded pages cannot become search results
/** @type {typeof page} */const unsafe=value;void unsafe;
// @ts-expect-error current authority must be synchronous
createMorningCatalog({...ports,authority:{capture:()=>async()=>{}}});
// @ts-expect-error timestamps remain numeric
createMorningCatalog({...ports,clock:{now:()=> 'now'}});
// @ts-expect-error caller cannot create a document through the readonly catalog
catalog.issue({});
// @ts-expect-error field filters have numeric provider codes
void catalog.search({...defaultDocumentSearch(),type:['305']});
