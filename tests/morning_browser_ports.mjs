import {createDomainsCustomersDocumentsBrowser} from '../netunim-orders/site/assets/js/domains/customers/documents-browser.js';
import {createMorningMediaComposition} from '../netunim-orders/site/assets/js/composition/morning-media.js';
export function createMorningBrowserFixture(ports){
  const documentMedia=createMorningMediaComposition({request:ports.request,modal:ports.modal,toast:ports.toast});
  return createDomainsCustomersDocumentsBrowser({...ports,documentMedia});
}
