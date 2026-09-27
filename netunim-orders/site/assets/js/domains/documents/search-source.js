import {isAndroidDocumentSearch} from './google-drive.js';

export function createDomainsDocumentSearch({localBridge,googleDrive,userAgent=globalThis.navigator?.userAgent||''}={}){
  const useDrive=isAndroidDocumentSearch(userAgent);
  const source=useDrive?googleDrive:localBridge;
  if(!source)throw new Error(useDrive?'Google Drive document search source is missing':'Local document search bridge is missing');
  return source;
}
