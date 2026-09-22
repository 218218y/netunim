// Reviewed against Bank of Israel's identification-code table updated 2026-07-12; bank/credit-union entries only.
const BANKS=Object.freeze([
  {code:'3',name:'בנק אש ישראל בע״מ',aliases:['אש','esh']},
  {code:'4',name:'בנק יהב לעובדי המדינה בע״מ',aliases:['יהב']},
  {code:'10',name:'בנק לאומי לישראל בע״מ',aliases:['לאומי']},
  {code:'11',name:'בנק דיסקונט לישראל בע״מ',aliases:['דיסקונט']},
  {code:'12',name:'בנק הפועלים בע״מ',aliases:['הפועלים','פועלים']},
  {code:'13',name:'בנק אגוד לישראל בע״מ',aliases:['אגוד','איגוד']},
  {code:'14',name:'בנק אוצר החייל בע״מ',aliases:['אוצר החייל']},
  {code:'15',name:'אופק אגודת אשראי שיתופית בע״מ',aliases:['אופק']},
  {code:'17',name:'בנק מרכנתיל דיסקונט בע״מ',aliases:['מרכנתיל','מרכנתיל דיסקונט']},
  {code:'18',name:'וואן זירו הבנק הדיגיטלי בע״מ',aliases:['וואן זירו','one zero']},
  {code:'20',name:'בנק מזרחי טפחות בע״מ',aliases:['מזרחי','מזרחי טפחות','טפחות']},
  {code:'22',name:'סיטיבאנק, אן.איי',aliases:['סיטיבנק','citibank','citi']},
  {code:'23',name:"אייצ׳ אס בי סי בנק",aliases:['hsbc']},
  {code:'25',name:'בי אן פי פאריבס אס איי',aliases:['bnp','פאריבס']},
  {code:'26',name:'יובנק בע״מ',aliases:['יובנק','u-bank','ubank']},
  {code:'31',name:'הבנק הבינלאומי הראשון לישראל בע״מ',aliases:['הבינלאומי','בינלאומי']},
  {code:'34',name:'בנק ערבי ישראלי בע״מ',aliases:['ערבי ישראלי']},
  {code:'37',name:'בנק אלאורדון',aliases:['bank of jordan']},
  {code:'38',name:"בנק אל תיג׳ארי אלפלסטיני",aliases:['commercial bank of palestine']},
  {code:'39',name:'דה סטייט בנק אוף אינדיה',aliases:['state bank of india']},
  {code:'43',name:'בנק אלאהאלי אלאורדוני',aliases:['jordan national bank']},
  {code:'46',name:'בנק מסד בע״מ',aliases:['מסד']},
  {code:'49',name:'אלבנק אלערבי',aliases:['arab bank']},
  {code:'52',name:'בנק פועלי אגודת ישראל בע״מ',aliases:['פאגי','פועלי אגודת ישראל']},
  {code:'54',name:'בנק ירושלים בע״מ',aliases:['ירושלים']},
  {code:'66',name:'בנק אלקאהירה עמאן',aliases:['cairo-amman']},
  {code:'67',name:'בנק אלעקארי אלערבי',aliases:['arab land bank']},
  {code:'68',name:'בנק מוניציפל בע״מ',aliases:['מוניציפל']},
  {code:'71',name:"בנק אלאורדון ואלחליג׳",aliases:['jordan gulf bank']},
  {code:'73',name:'בנק אלאסלאמי אלערבי',aliases:['arab islamic bank']},
  {code:'76',name:'בנק אלאסתתמאר אלפלסטיני',aliases:['palestine investment bank']},
  {code:'82',name:'בנק אלקודס ללתמניה וללסתתמר',aliases:['al-quds']},
  {code:'84',name:'בנק אלאסכאן',aliases:['housing bank']},
  {code:'89',name:'בנק פלסטין',aliases:['bank of palestine']},
  {code:'93',name:'בנק אלאורדון ואלכווית',aliases:['jordan kuwait bank']},
  {code:'99',name:'בנק ישראל',aliases:['ישראל']},
]);

function clean(value,max=120){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function normalize(value){return clean(value,160).toLocaleLowerCase('he').replace(/["'׳״`.,()\[\]{}]/g,' ').replace(/[-–—_/]+/g,' ').replace(/\s+/g,' ').trim()}
function normalizedCode(value){const match=clean(value,30).match(/^0*(\d{1,3})(?:\s*[·:\-–—]|\s|$)/);if(!match)return'';return String(Number(match[1]))}
function aliases(bank){return [bank.name,...bank.aliases].map(normalize).filter(Boolean)}

export const MORNING_BANKS=BANKS;

export function resolveMorningBank(value){
  const text=clean(value,160);if(!text)return null;
  const code=normalizedCode(text);if(code){const byCode=BANKS.find(bank=>bank.code===code);if(byCode)return byCode}
  const needle=normalize(text);if(!needle)return null;
  return BANKS.find(bank=>aliases(bank).includes(needle))||null;
}

export function findMorningBanks(query,limit=20){
  const text=clean(query,160),codeText=text.replace(/\D/g,''),needle=normalize(text);if(!text)return BANKS.slice(0,limit);
  const scored=[];
  for(const bank of BANKS){let score=0;if(codeText&&bank.code.startsWith(String(Number(codeText)||codeText)))score=Math.max(score,bank.code===String(Number(codeText))?100:80);for(const alias of aliases(bank)){if(alias===needle)score=Math.max(score,100);else if(alias.startsWith(needle))score=Math.max(score,85);else if(alias.includes(needle))score=Math.max(score,70)}if(score)scored.push({bank,score})}
  return scored.sort((a,b)=>b.score-a.score||Number(a.bank.code)-Number(b.bank.code)).slice(0,limit).map(row=>row.bank);
}

export function formatMorningBank(value){const bank=typeof value==='object'&&value?.code?value:resolveMorningBank(value);return bank?`${bank.code} · ${bank.name}`:clean(value,160)}
export function morningBankName(value){return resolveMorningBank(value)?.name||clean(value,80)}
export function morningBankCode(value){return resolveMorningBank(value)?.code||normalizedCode(value)}

export function inferMorningBankFromText(value){
  const text=clean(value,500);if(!text)return null;
  const explicit=text.match(/(?:מבנק|בנק)\s*0*(\d{1,3})(?=\D|$)/);if(explicit){const bank=resolveMorningBank(explicit[1]);if(bank)return bank}
  const normalized=normalize(text),candidates=[];
  for(const bank of BANKS){for(const alias of aliases(bank)){if(alias.length>=3&&normalized.includes(alias)){candidates.push({bank,length:alias.length});break}}}
  return candidates.sort((a,b)=>b.length-a.length)[0]?.bank||null;
}

export function morningBankDatalistMarkup(id='morningBankDirectory'){
  const options=[];
  for(const bank of BANKS){
    options.push(`<option value="${bank.code} · ${bank.name}">${bank.aliases.join(' · ')}</option>`);
    options.push(`<option value="${bank.name}">${bank.code}</option>`);
    for(const alias of bank.aliases)options.push(`<option value="${alias}">${bank.code} · ${bank.name}</option>`);
  }
  return `<datalist id="${id}">${options.join('')}</datalist>`;
}
