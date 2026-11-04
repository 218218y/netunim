import {esc} from '../core/values.js';
import {documentSearchEmptyHtml,documentSearchPartialHtml} from '../ui/document-search-view.js';

function resultMeta(item,siteResultMeta){const parts=siteResultMeta?.(item);return Array.isArray(parts)?parts.filter(Boolean):[]}
function sourceHeader(label,count,{loading=false}={}){return `<header class="global-search-source-head"><b>${esc(label)}</b>${loading?'<span class="global-search-source-loading">מחפש…</span>':`<span>${esc(count)}</span>`}</header>`}
export function renderGlobalSiteSource(raw,{siteSearch,siteResultMeta,siteResultLimit,siteResultMax,registerResult}){
    const data=siteSearch?.(raw,{limitPerGroup:siteResultLimit})||{total:0,groups:[]},visibleGroups=(data.groups||[]).filter(group=>group.total>0);
    let hiddenTotal=0;
    const groups=visibleGroups.map(group=>{const rows=group.items.map((item,index)=>{const key=`${group.key}:${item.kind}:${item.id}:${index}`;registerResult(key,item);const metaParts=resultMeta(item,siteResultMeta);return `<button class="global-search-result" type="button" data-global-result-key="${esc(key)}"><span class="global-search-result-main"><span class="global-search-result-kicker">${
  esc(item.context||group.label)} · ${esc(item.badge||group.label)}</span><b>${esc(item.title||'תוצאה')}</b>${item.subtitle?`<span class="global-search-result-subtitle">${esc(item.subtitle)}</span>`:''}</span>${metaParts.length?`<span class="global-search-result-meta">${metaParts.map(x=>`<em>${
  esc(x)}</em>`).join('')}</span>`:''}<span class="global-search-result-arrow" aria-hidden="true">←</span></button>`}).join('');const hidden=Math.max(0,Number(group.total||0)-group.items.length);hiddenTotal+=hidden;return `<section class="global-search-group"><header><b>${esc(group.label)}</b><span>${esc(group.total)}</span></header><div class="global-search-group-results">${rows}</div>${
  hidden>0?`<div class="global-search-more">מוצגות ${esc(group.items.length)} מתוך ${esc(group.total)} תוצאות בקבוצה.</div>`:''}</section>`}).join('');
    const canLoadMore=hiddenTotal>0&&siteResultLimit<siteResultMax,loadMore=canLoadMore?`<div class="document-search-load-more" data-site-load-more>גלול להמשך תוצאות האתר</div>`:'';
    const body=groups?`${groups}${loadMore}`:'<div class="global-search-source-empty">לא נמצאו תוצאות באתר.</div>';
    return {total:data.total,settledEmpty:data.total===0,hasMore:canLoadMore,html:`<section class="global-search-source-section" data-search-source="site">${sourceHeader('חיפוש באתר',data.total)}<div class="global-search-source-body">${body}</div></section>`};
  }
export function renderGlobalDocumentSource(mode,raw,{state,label,filter,documentProviderLabel,documentPairing,documentErrorHtml,documentIntro,renderDocumentTable,providerNoticeHtml}){
    const count=state.rows.length,hasRows=state.status==='done'&&count>0;
    let body='';
    if(state.status==='loading')body=`<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>מחפש דרך ${esc(documentProviderLabel())}…</div>`;
    else if(state.status==='pairing')body=documentPairing({compact:filter==='all'&&mode==='content'});
    else if(state.status==='unavailable'||state.status==='error')body=documentErrorHtml(state.error||{message:'רכיב החיפוש המקומי אינו זמין.'},`search:${mode}`);
    else if(state.status==='short')body=documentIntro(mode);
    else if(state.status==='done'){
      body=hasRows?renderDocumentTable(state.rows,mode,{hasMore:state.hasMore}):documentSearchEmptyHtml(label,state.partial);
      if(hasRows&&(state.loadingMore||state.hasMore))body+=state.loadingMore?'<div class="document-search-load-more loading"><span class="document-search-spinner">⌕</span>טוען עוד תוצאות…</div>':`<div class="document-search-load-more" data-document-load-more="${esc(mode)}">גלול להמשך התוצאות</div>`;
      body+=documentSearchPartialHtml(state.partial);
      if(state.error)body+=documentErrorHtml(state.error,`more:${mode}`);
    }else body=raw?'<div class="global-search-source-empty">החיפוש המקומי עדיין לא הופעל.</div>':documentIntro(mode);
    const header=hasRows?'':sourceHeader(label,count,{loading:state.status==='loading'}),notice=providerNoticeHtml();
    return {total:count,settledEmpty:state.status==='done'&&count===0&&!state.partial,html:`<section class="global-search-source-section" data-search-source="${esc(mode)}">${header}<div class="global-search-source-body">${notice}${body}</div></section>`};
  }

export function recentDocumentLabels(type){return type==='all'?{label:'\u05e4\u05e8\u05d9\u05d8\u05d9\u05dd \u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd',emptyLabel:'\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd'}:type==='folders'?{label:'\u05ea\u05d9\u05e7\u05d9\u05d5\u05ea \u05d0\u05d7\u05e8\u05d5\u05e0\u05d5\u05ea',emptyLabel:'\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05ea\u05d9\u05e7\u05d9\u05d5\u05ea'}:{label:'\u05e7\u05d1\u05e6\u05d9\u05dd \u05d0\u05d7\u05e8\u05d5\u05e0\u05d9\u05dd',emptyLabel:'\u05dc\u05d0 \u05e0\u05de\u05e6\u05d0\u05d5 \u05e7\u05d1\u05e6\u05d9\u05dd'}}
export function renderGlobalRecentDocumentBody(state,rows,{label,emptyLabel,provider,documentPairing,documentErrorHtml,renderDocumentTable,recentDocumentSort}){
    let body='';
    if(state.status==='loading')body=`<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>טוען ${esc(label)} מ־${esc(provider)}…</div>`;
    else if(state.status==='pairing')body=documentPairing();
    else if(state.status==='unavailable'||state.status==='error')body=documentErrorHtml(state.error||{message:'רכיב החיפוש המקומי אינו זמין.'});
    else if(state.status==='done'&&rows.length)body=renderDocumentTable(rows,'everything',{label:label,hint:'לחיצה על כותרת ממיינת · לחיצה אחת לתצוגה · לחיצה כפולה לפתיחה',sortScope:'recent',sort:recentDocumentSort});
    else if(state.status==='done')body=`<div class="global-search-source-empty">${esc(emptyLabel)} ב־${esc(provider)}.</div>`;
    else body='<div class="global-search-source-progress"><span class="document-search-spinner">⌕</span>טוען קבצים אחרונים…</div>';
    return body;
}
