import {bankTransactionMatchesSearch} from '../../shared/bank-transaction-order.js';

export function bankDateLabel(value){if(!value)return '—';const d=new Date(value);if(!Number.isFinite(d.getTime()))return '—';const weekday=['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'][d.getDay()]||'',dd=String(d.getDate()).padStart(2,'0'),mm=String(d.getMonth()+1).padStart(2,'0'),yy=String(d.getFullYear()).slice(-2);return `${weekday} ${dd}/${mm}/${yy}`}
export function bankRowMatchesSearch(row,query){return bankTransactionMatchesSearch(row,query,bankDateLabel(row?.date||row?.processedDate))}
