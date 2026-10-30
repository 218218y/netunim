// Release activation runs before importing any application state or business code.
import {mayStartApp,showAppReleaseBlocked,watchVendorCompatibility} from './js/shared/app-release-startup.js';
watchVendorCompatibility({serviceWorker:navigator.serviceWorker,document});
if(await mayStartApp({serviceWorker:navigator.serviceWorker,location,onBlocked:()=>showAppReleaseBlocked({document,location})}))await import('./js/main.js');
