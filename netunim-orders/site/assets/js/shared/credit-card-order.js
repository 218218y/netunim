import {creditCardCompare} from './credit-history.js';

export function creditOrderCardsData(sync={}){
  const labels={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'American Express'},mappings=sync.cardMappings||{},cards=[];
  for(const profile of sync.profiles||[])for(const account of profile.accounts||[]){
    const key=`${profile.profileId}:${account.accountNumber}`,mapping=mappings[key]||{};
    cards.push({key,creditAccountKey:`sync:${key}`,card:mapping.cardName||`${labels[profile.provider]||profile.label} ••${String(account.accountNumber||'').slice(-4)}`,detail:[profile.ownerLabel,profile.label,mapping.account||profile.defaultAccount,mapping.included===false?'לא כלול':''].filter(Boolean).join(' · ')});
  }
  return cards.sort((a,b)=>creditCardCompare(a,b,mappings));
}

export function applyCreditCardOrderData(sync,keys){
  const mappings={...sync.cardMappings};
  if(keys===null){for(const [key,mapping] of Object.entries(mappings))mappings[key]={...mapping,sortOrder:null}}
  else{
    if(!Array.isArray(keys))throw new Error('סדר הכרטיסים אינו תקין');
    const known=new Set(creditOrderCardsData(sync).map(card=>card.key)),seen=new Set();let position=0;
    for(const key of keys){if(!known.has(key)||seen.has(key))continue;seen.add(key);mappings[key]={...mappings[key],sortOrder:++position}}
  }
  return {...sync,cardMappings:mappings};
}
