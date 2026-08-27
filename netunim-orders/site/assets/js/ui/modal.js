import {esc} from '../core/values.js';
import {$} from '../state/constants.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createUiModal({}){
function modal(title,body,foot=''){const back=$('#modalBackdrop');$('#modal').innerHTML=`<div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-action="close-modal">✕</button></div><div class="modal-body">${body}</div><div class="modal-foot">${foot}</div>`;back.classList.add('open')}

function closeModal(){$('#modalBackdrop').classList.remove('open')}

function triSelect(id,label,val,na=true){return `<div class="field"><label>${esc(label)}</label><select id="${esc(id)}">${na?`<option value="null" ${val==null?'selected':''}>לא רלוונטי</option>`:''}<option value="true" ${val===true?'selected':''}>כן</option><option value="false" ${val===false?'selected':''}>לא</option></select></div>`}

function parseTri(id){const v=$('#'+id).value;return v==='true'?true:v==='false'?false:null}

return { modal, closeModal, triSelect, parseTri };
}
