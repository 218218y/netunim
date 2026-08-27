

export function num(v){const n=Number(v);return Number.isFinite(n)?n:0}

export function wholeMoney(v){return Math.round(num(v))}

export function money(v){return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',maximumFractionDigits:0}).format(num(v))}

export function formatNullableMoney(v){return v===null?'—':money(v)}
