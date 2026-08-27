export function nextSeriesCheckNumber(base,i){const raw=String(base||'').trim();if(!raw)return '';if(/^\d+$/.test(raw))return String(Number(raw)+i).padStart(raw.length,'0');return ''}
