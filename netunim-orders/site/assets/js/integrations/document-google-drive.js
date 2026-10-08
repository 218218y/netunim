import {createGoogleDriveClient} from '../shared/google-drive-client.js';
import {createBrowserGoogleDrivePlatform} from '../shared/browser-google-drive-platform.js';

export function createDocumentGoogleDriveIntegration({supaFetch,accountScope,platform=createBrowserGoogleDrivePlatform()}){
  return createGoogleDriveClient({accountScope,transport:{authenticatedRequest:supaFetch,fetchRequest:platform.fetchRequest},browser:platform.browser,clock:platform.clock});
}
