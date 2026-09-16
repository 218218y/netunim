import {creditOrderCardsData} from './credit-card-order.js';

export function createCreditCardOrderView({getSync,saveOrder,modal,closeModal,render,escapeHtml:esc}){
  let cards=[],draft=[],alphabetical=false,saving=false,generation=0;
  function paint(){
    const list=document.getElementById('creditCardOrderList');if(!list)return;
    const byKey=new Map(cards.map(card=>[card.key,card]));
    list.innerHTML=draft.map((key,index)=>{const card=byKey.get(key);return `<div class="credit-order-row" draggable="${!saving}" data-modal-draft="${esc(key)}" data-dragstart="credit-card-order-drag-start" data-dragover="credit-card-order-drag-over" data-drop="credit-card-order-drop" data-dragend="credit-card-order-drag-end" data-card-key="${esc(key)}"><span class="credit-order-handle" title="גרור לשינוי סדר">⋮⋮</span><span class="credit-order-name"><b>${esc(card.card)}</b><small>${esc(card.detail)}</small></span><span class="credit-order-actions"><button type="button" class="btn" aria-label="העבר ${esc(card.card)} למעלה" data-action="credit-card-order-move" data-click-arg0="${esc(key)}" data-click-arg1="-1" ${saving||index===0?'disabled':''}>↑</button><button type="button" class="btn" aria-label="העבר ${esc(card.card)} למטה" data-action="credit-card-order-move" data-click-arg0="${esc(key)}" data-click-arg1="1" ${saving||index===draft.length-1?'disabled':''}>↓</button></span></div>`}).join('');
    const save=document.querySelector('[data-action="credit-card-order-save"]'),reset=document.querySelector('[data-action="credit-card-order-reset"]');
    if(save){save.disabled=saving;save.textContent=saving?'שומר… ממתין אם מתבצע סנכרון':'שמור סדר'}
    if(reset){reset.disabled=saving;reset.setAttribute('aria-pressed',String(alphabetical))}
  }
  function open(){
    if(saving)return;generation++;cards=creditOrderCardsData(getSync());draft=cards.map(card=>card.key);alphabetical=false;
    modal('סידור כרטיסי אשראי',`<div class="notice">גרור את הכרטיסים או השתמש בחיצים. הסדר יחול בתוך אותו תאריך חיוב בעסקאות ותשלומים בשתי המערכות.</div><div id="creditCardOrderList" class="credit-order-list"></div><div id="creditCardOrderError" role="alert"></div>`,`<button type="button" class="btn primary" data-action="credit-card-order-save">שמור סדר</button><button type="button" class="btn" data-action="credit-card-order-reset">חזרה לא״ב</button><button type="button" class="btn" data-action="close-modal">ביטול</button>`);paint();
  }
  function move(key,to){const from=draft.indexOf(key);if(saving||from<0||to<0||to>=draft.length||from===to)return;draft.splice(from,1);draft.splice(to,0,key);alphabetical=false;paint()}
  async function save(){
    if(saving)return;const current=generation;saving=true;paint();
    try{
      const result=await saveOrder(alphabetical?null:draft.slice());
      if(result!==true)throw new Error('הסדר לא נשמר. הרשימה נשארה פתוחה לניסיון נוסף.');
      if(current===generation&&document.getElementById('creditCardOrderList'))closeModal();render();
    }catch(error){const target=document.getElementById('creditCardOrderError');if(current===generation&&target)target.textContent=error?.message||'שמירת הסדר נכשלה'}
    finally{saving=false;if(current===generation)paint()}
  }
  return {actions:{
    'open-credit-card-order':open,
    'credit-card-order-save':save,
    'credit-card-order-reset':()=>{if(saving)return;draft=cards.slice().sort((a,b)=>a.card.localeCompare(b.card,'he')||a.key.localeCompare(b.key)).map(card=>card.key);alphabetical=true;paint()},
    'credit-card-order-move':element=>move(element.dataset.clickArg0,draft.indexOf(element.dataset.clickArg0)+Number(element.dataset.clickArg1)),
    'credit-card-order-drag-start':(element,event)=>{if(saving){event.preventDefault();return}event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',element.dataset.cardKey);element.classList.add('dragging')},
    'credit-card-order-drag-over':(element,event)=>{event.preventDefault();event.dataTransfer.dropEffect='move'},
    'credit-card-order-drop':(element,event)=>{event.preventDefault();move(event.dataTransfer.getData('text/plain'),draft.indexOf(element.dataset.cardKey))},
    'credit-card-order-drag-end':element=>element.classList.remove('dragging'),
  }};
}
