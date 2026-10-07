import {markMutationActions} from '../../shared/action-registry.js';

export function createCloudActions({uiCloud}){
const enableCloud=(...args)=>uiCloud.enableCloud(...args);
const finishCloudLogin=(...args)=>uiCloud.finishCloudLogin(...args);
const finishLocalResetLogin=(...args)=>uiCloud.finishLocalResetLogin(...args);
const logoutCloud=(...args)=>uiCloud.logoutCloud(...args);
const openCloud=(...args)=>uiCloud.openCloud(...args);
const resetLocalSiteStorage=(...args)=>uiCloud.resetLocalSiteStorage(...args);
const actions={
  'finish-cloud-login':(element,event)=>{finishCloudLogin(element.dataset.clickArg0)},
  'finish-local-reset-login':()=>{finishLocalResetLogin()},
  'enable-cloud':(element,event)=>{enableCloud()},
  'open-cloud':(element,event)=>{openCloud()},
  'logout-cloud':(element,event)=>{logoutCloud()},
  'reset-local-site-storage':()=>resetLocalSiteStorage(),
};
return markMutationActions(actions,{all:['finish-cloud-login', 'enable-cloud', 'open-cloud', 'logout-cloud']});
}
