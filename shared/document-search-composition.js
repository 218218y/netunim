import {createDocumentBridgeIntegration} from '../integrations/document-bridge.js';
import {createDomainsGoogleDriveSearch} from '../domains/documents/google-drive.js';
import {createDomainsDocumentSearch} from '../domains/documents/search-source.js';

// Both apps use the same provider selection and fallback policy. The caller
// supplies only its authenticated Supabase transport.
export function composeDocumentSearch({supaFetch}){
  if(typeof supaFetch!=='function')throw new Error('document_search_cloud_port_required');
  const localBridge=createDocumentBridgeIntegration();
  const googleDrive=createDomainsGoogleDriveSearch({supaFetch});
  return createDomainsDocumentSearch({localBridge,googleDrive});
}
