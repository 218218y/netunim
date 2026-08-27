export const HEB_MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

export function dateFmt(v){if(!v)return '—'; const d=new Date(v+'T12:00:00'); return new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'}).format(d)}

export function todayISO(){const d=new Date();return localISO(d)}

export function localISO(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

export function dObj(v){return v?new Date(v+'T12:00:00'):null}

export function daysFromToday(v){const a=dObj(v),b=dObj(todayISO());return a?Math.round((a-b)/86400000):99999}

export function monthKey(v){if(!v)return '';return v.slice(0,7)}

export function monthLabel(k){if(!k)return '';const [y,m]=k.split('-').map(Number);return `${HEB_MONTHS[m-1]} ${y}`}

export function checkDateParts(value){const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!m)return {day:'',month:'',year:''};return {day:m[3],month:m[2],year:String(Number(m[1])%100).padStart(2,'0')}}
