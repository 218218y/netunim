// Release activation runs before importing any application state or business code.
import {mayStartApp,showAppReleaseBlocked} from './js/shared/app-release-startup.js';
if(await mayStartApp({serviceWorker:navigator.serviceWorker,location,onBlocked:()=>showAppReleaseBlocked({document,location})}))await import('./js/main.js');
