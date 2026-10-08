import {createDocumentBridgeIntegration} from '../integrations/document-bridge.js';
import {createDocumentGoogleDriveIntegration} from '../integrations/document-google-drive.js';
import {createDomainsDocumentSearch} from '../domains/documents/search-source.js';
import {createBrowserGoogleDrivePlatform} from './browser-google-drive-platform.js';

// Both apps use the same provider selection and fallback policy. The caller
// supplies authenticated transport and the live account identity.
export function composeDocumentSearch({supaFetch,accountScope,drivePlatform}){
  if(typeof supaFetch!=='function')throw new Error('document_search_cloud_port_required');
  const platform=drivePlatform||createBrowserGoogleDrivePlatform();
  const localBridge=createDocumentBridgeIntegration();
  const googleDrive=createDocumentGoogleDriveIntegration({supaFetch,accountScope,platform});
  return createDomainsDocumentSearch({localBridge,googleDrive,userAgent:platform.userAgent||''});
}
