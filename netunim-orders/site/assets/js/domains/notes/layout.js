const FALLBACK_ROW_HEIGHT=4;
const FALLBACK_GAP=8;

function cssPixels(value,fallback){const parsed=Number.parseFloat(String(value||''));return Number.isFinite(parsed)&&parsed>=0?parsed:fallback}

export function stickyNoteGridSpan(height,{rowHeight=FALLBACK_ROW_HEIGHT,gap=FALLBACK_GAP}={}){
  const measured=Math.max(0,Number(height)||0),row=Math.max(1,Number(rowHeight)||FALLBACK_ROW_HEIGHT),spacing=Math.max(0,Number(gap)||0);
  return Math.max(1,Math.ceil((measured+spacing)/(row+spacing)));
}

export function layoutStickyNoteCard(card,grid=card?.parentElement){
  if(!card||!grid)return 0;
  const style=getComputedStyle(grid),rowHeight=cssPixels(style.gridAutoRows,FALLBACK_ROW_HEIGHT),gap=cssPixels(style.rowGap,FALLBACK_GAP);
  const span=stickyNoteGridSpan(card.getBoundingClientRect().height,{rowHeight,gap}),value=`span ${span}`;
  if(card.style.gridRowEnd!==value)card.style.gridRowEnd=value;
  return span;
}

export function layoutStickyNoteGrid(grid=document.querySelector('.notes-grid')){
  if(!grid)return [];
  return [...grid.querySelectorAll('.sticky-note')].map(card=>layoutStickyNoteCard(card,grid));
}
