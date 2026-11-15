const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function financialState(value){
  if(!object(value)||!object(value.creditSync)||!Array.isArray(value.creditSync.profiles))throw Error('מבנה נתוני האשראי אינו תקין');
  for(const profile of value.creditSync.profiles){
    if(!object(profile)||!Array.isArray(profile.accounts))throw Error('מבנה הכרטיסים אינו תקין');
    for(const account of profile.accounts){
      for(const field of ['months','txns','unassignedTransactions','pendingTransactions'])if(account[field]!==undefined&&!Array.isArray(account[field]))throw Error('מבנה תנועות האשראי אינו תקין');
      for(const month of account.months||[])if(!object(month)||!Array.isArray(month.transactions))throw Error('מבנה חודש האשראי אינו תקין');
    }
  }
  return value;
}
export async function sha256(text){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function readFinanceBackup(value){
  if(!object(value)||value.format!=='netunim-finance-backup'||value.version!==1||value.document!=='main'||
    !Number.isSafeInteger(value.revision)||value.revision<1||typeof value.stateText!=='string'||value.stateText.length>30_000_000||
    !/^[a-f0-9]{64}$/.test(value.sha256)||await sha256(value.stateText)!==value.sha256)throw Error('קובץ Finance או בדיקת התקינות שלו אינם תקינים');
  return financialState(JSON.parse(value.stateText));
}
export async function financeBackup(row){
  const value={format:'netunim-finance-backup',version:1,document:'main',revision:Number(row.revision),exportedAt:new Date().toISOString(),stateText:row.state_text,sha256:row.state_hash};
  await readFinanceBackup(value);return value;
}
export function creditEvidence(state){
  financialState(state);const rows=[];
  for(const profile of state.creditSync.profiles)for(const account of profile.accounts){
    const add=(tx,month)=>{
      if(!object(tx))throw Error('רשומת אשראי אינה תקינה');
      rows.push({profile:profile.profileId||'',provider:profile.provider||'',card:String(account.accountNumber||''),month,tx});
    };
    if(account.months?.length){for(const slice of account.months)for(const tx of slice.transactions)add(tx,slice.month)}
    else for(const tx of account.txns||[])if(tx.status!=='pending'&&tx.processedDate)add(tx,String(tx.processedDate).slice(0,7));
    for(const tx of account.unassignedTransactions||(!account.months?.length?(account.txns||[]).filter(tx=>tx.status!=='pending'&&!tx.processedDate):[]))add(tx,'ללא חודש');
    for(const tx of account.pendingTransactions||(!account.months?.length?(account.txns||[]).filter(tx=>tx.status==='pending'):[]))add(tx,'ממתינות');
  }
  return rows;
}
function key(row){const tx=row.tx;return JSON.stringify([row.profile,row.provider,row.card,row.month,tx.id||'',tx.date,tx.processedDate,tx.type,tx.status,tx.originalAmount,tx.originalCurrency,tx.chargedAmount,tx.chargedCurrency,tx.installments?.number??null,tx.installments?.total??null,tx.foreignTransaction,tx.chargeAmountStatus,tx.id?'':tx.description])}
export function creditVersionDiff(before,after){
  const old=creditEvidence(before),next=creditEvidence(after),available=new Map(),changes=[];
  for(const row of next){const id=key(row);if(!available.has(id))available.set(id,[]);available.get(id).push(row)}
  for(const row of old){const same=available.get(key(row));if(same?.length)same.pop();else changes.push({...row,kind:'removed'})}
  for(const rows of available.values())for(const row of rows)changes.push({...row,kind:'added'});
  const groups=new Map();
  for(const [side,rows] of [['before',old],['after',next]])for(const row of rows){
    const id=JSON.stringify([row.profile,row.provider,row.card,row.month]);
    if(!groups.has(id))groups.set(id,{provider:row.provider,card:row.card.slice(-4),month:row.month,before:{count:0,ilsCents:0,unknown:0},after:{count:0,ilsCents:0,unknown:0}});
    const group=groups.get(id)[side];group.count++;
    if(typeof row.tx.chargedAmount==='number'&&Number.isFinite(row.tx.chargedAmount)&&row.tx.chargedCurrency==='ILS')group.ilsCents+=Math.round(row.tx.chargedAmount*100);else group.unknown++;
  }
  return {beforeCount:old.length,afterCount:next.length,groups:[...groups.values()],changes};
}
