

export function money(n){const v=Number(n||0);return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:Math.abs(v%1)>1e-8?2:0,maximumFractionDigits:2}).format(v)}

export function wholeShekel(n){const v=Number(n||0);return Math.sign(v)*Math.round(Math.abs(v))}

export function moneyWhole(n){const v=wholeShekel(n);return new Intl.NumberFormat('he-IL',{style:'currency',currency:'ILS',minimumFractionDigits:0,maximumFractionDigits:0}).format(v)}

export function num(n){return Number(n||0).toLocaleString('he-IL',{maximumFractionDigits:2})}

export function checkNum(v){const n=Number(v);return Number.isFinite(n)?n:0}

export function checkWholeMoney(v){return Math.round(checkNum(v))}

export function kupaWholeMoney(v){return Math.round(checkNum(v))}
