

export function num(v){const n=Number(v);return Number.isFinite(n)?n:0}

export function wholeMoney(v){return Math.round(num(v))}

export function decimalMoney(v){const n=num(v);return Math.round((n+Math.sign(n)*Number.EPSILON)*100)/100}

export function money(v){return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(num(v))}

export function moneyWithCents(v){const n=decimalMoney(v),fractionDigits=Number.isInteger(n)?0:2;return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:fractionDigits,maximumFractionDigits:fractionDigits}).format(n)}

export function formatNullableMoney(v){return v===null?'—':money(v)}
