import {esc} from './html.js';

export function checkSummaryData(rows=[]){
  const groups=new Map();
  for(const row of rows){
    const status=row.status||'בקופה',group=groups.get(status)||{status,count:0,cents:0};
    group.count++;group.cents+=Math.round((Number(row.amount)||0)*100);groups.set(status,group);
  }
  return [...groups.values()].map(group=>({...group,amount:group.cents/100}));
}
export function checkFutureTotalData(rows=[]){return checkSummaryData(rows).find(group=>group.status==='בקופה')?.amount||0}
export function checkMonthSummaryMarkup(rows,money){
  const labels={'בקופה':['צ׳ק עתידי','צ׳קים עתידיים'],'הופקד - במעקב':['צ׳ק שהופקד','צ׳קים שהופקדו'],'נפרע':['צ׳ק שנפרע','צ׳קים שנפרעו'],'חזר':['צ׳ק שחזר','צ׳קים שחזרו'],'בוטל':['צ׳ק שבוטל','צ׳קים שבוטלו']};
  return checkSummaryData(rows).sort((a,b)=>Number(b.status==='הופקד - במעקב')-Number(a.status==='הופקד - במעקב')).map(group=>`<span class="check-summary-part" data-check-summary-status="${esc(group.status)}">${group.count} ${esc(labels[group.status]?.[group.count===1?0:1]||group.status)} · ${money(group.amount)}</span>`).join('');
}
