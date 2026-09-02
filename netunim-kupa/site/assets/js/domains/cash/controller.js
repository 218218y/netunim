// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createDomainsCashController({model, saveState, toast}){
function validIsoDate(value){
  const text=String(value||'').trim();
  if(!text)return true;
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if(!match)return false;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const d=new Date(Date.UTC(year,month-1,day));
  return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day;
}

function setRightsLastCalculatedDate(value){
  const next=String(value||'').trim();
  if(!validIsoDate(next)){toast('תאריך חישוב המעשר אינו תקין');return false}
  const normalized=next||null;
  if((model.state.rightsLastCalculatedDate||null)===normalized)return true;
  model.state.rightsLastCalculatedDate=normalized;
  saveState(normalized?'תאריך חישוב המעשר נשמר':'תאריך חישוב המעשר נוקה');
  return true;
}

return { setRightsLastCalculatedDate };
}
