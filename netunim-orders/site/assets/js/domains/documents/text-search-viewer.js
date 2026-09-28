import {createDomSearchNavigator} from './document-search-navigator.js';

export async function createTextSearchViewer({host,text,query,contentSearch={},label='קובץ טקסט',truncated=false,onMatchState=()=>{}}){
  if(!host)throw new TypeError('Preview host is required');
  host.innerHTML='';
  const wrapper=document.createElement('div');wrapper.className='document-text-search-viewer';
  const head=document.createElement('div');head.className='document-preview-text-head';head.dataset.documentSearchIgnore='true';head.innerHTML=`<span></span>${truncated?'<em>תצוגה חלקית</em>':''}`;head.querySelector('span').textContent=label;
  const pre=document.createElement('pre');pre.className='document-preview-text';pre.textContent=String(text??'');wrapper.append(head,pre);host.append(wrapper);
  const navigator=createDomSearchNavigator({root:pre,scrollContainer:host,query,contentSearch,onMatchState});
  return {...navigator,destroy:async()=>{await navigator.destroy();host.innerHTML=''}};
}
