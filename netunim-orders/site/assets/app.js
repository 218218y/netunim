// Release activation runs before importing any application state or business code.
import {mayStartApp} from './js/shared/app-release-startup.js';
if(await mayStartApp({serviceWorker:navigator.serviceWorker,location}))await import('./js/main.js');
