const ALL_HIGHLIGHT='netunim-document-search-all';
const CURRENT_HIGHLIGHT='netunim-document-search-current';
const DEFAULT_MAX_MATCHES=5000;
const CONTENT_MATCH_MODES=new Set(['phrase','all','any','proximity']);

function normalized(value){return String(value??'').toLocaleLowerCase('he-IL')}
function compact(value){return String(value??'').replace(/\s+/g,' ')}
function regexLiteral(value){return String(value??'').replace(/[\\^$.*+?()[\]{}|]/g,'\\$&')}
export function normalizeContentSearch(value={}){const source=value&&typeof value==='object'?value:{};return {matchMode:CONTENT_MATCH_MODES.has(source.matchMode)?source.matchMode:'phrase',proximityWords:Math.max(0,Math.min(50,Math.trunc(Number(source.proximityWords)||0)))}}
export function contentSearchTerms(query){return String(query??'').replace(/\s+/g,' ').trim().split(' ').map(term=>term.trim()).filter(Boolean).slice(0,16)}
function proximityPattern(terms,proximityWords){if(terms.length<2)return '';const gap=`(?:\\s+\\S+){0,${proximityWords}}\\s+`;return terms.map(regexLiteral).join(gap)}

export function findTextMatchOffsets(text,query,{maxMatches=DEFAULT_MAX_MATCHES,matchMode='phrase',proximityWords=0}={}){
  const source=String(text??''),needle=String(query??'').replace(/\s+/g,' ').trim(),search=normalizeContentSearch({matchMode,proximityWords}),terms=contentSearchTerms(needle);
  if(!source||needle.length<2)return {matches:[],capped:false,search};
  const haystack=normalized(source),limit=Math.max(1,Math.min(20000,Number(maxMatches)||DEFAULT_MAX_MATCHES));
  let matches=[],capped=false;
  if(search.matchMode==='proximity'&&terms.length>1){
    const regex=new RegExp(proximityPattern(terms.map(normalized),search.proximityWords),'gu');let match;
    while((match=regex.exec(haystack))){matches.push({start:match.index,end:match.index+match[0].length});if(matches.length>=limit){capped=true;break}if(!match[0].length)regex.lastIndex+=1}
    return {matches,capped,search};
  }
  if((search.matchMode==='all'||search.matchMode==='any')&&terms.length>1){
    const unique=[...new Set(terms.map(normalized))],termMatches=[];let missing=false;
    for(const term of unique){let found=0,offset=0;while(offset<=haystack.length-term.length){const index=haystack.indexOf(term,offset);if(index<0)break;termMatches.push({start:index,end:index+term.length});found+=1;offset=index+Math.max(1,term.length);if(termMatches.length>=limit){capped=true;break}}if(!found)missing=true;if(capped)break}
    if(search.matchMode==='all'&&missing)return {matches:[],capped:false,search};
    matches=termMatches.sort((a,b)=>a.start-b.start||(b.end-b.start)-(a.end-a.start)).filter((row,index,list)=>index===0||row.start!==list[index-1].start||row.end!==list[index-1].end).slice(0,limit);
    return {matches,capped:capped||termMatches.length>limit,search};
  }
  const target=normalized(needle);let offset=0;
  while(offset<=haystack.length-target.length){const index=haystack.indexOf(target,offset);if(index<0)break;matches.push({start:index,end:index+target.length});offset=index+Math.max(1,target.length);if(matches.length>=limit){capped=haystack.indexOf(target,offset)>=0;break}}
  return {matches,capped,search};
}

export function buildViewerFindQuery(query,contentSearch={}){
  const needle=String(query??'').replace(/\s+/g,' ').trim(),search=normalizeContentSearch(contentSearch),terms=contentSearchTerms(needle);
  if(needle.length<2)return '';
  if((search.matchMode==='all'||search.matchMode==='any')&&terms.length>1)return terms;
  return needle;
}

export function buildTextMatchSnippet(text,match,{contextChars=72}={}){
  if(!match)return null;const source=String(text??''),context=Math.max(24,Math.min(180,Number(contextChars)||72));
  const start=Math.max(0,match.start-context),end=Math.min(source.length,match.end+context);
  return {before:compact(source.slice(start,match.start)).trimStart(),match:source.slice(match.start,match.end),after:compact(source.slice(match.end,end)).trimEnd(),leading:start>0,trailing:end<source.length};
}

function usableTextNode(node){
  const parent=node?.parentElement,tag=String(parent?.tagName||'').toLowerCase();
  return !!node?.nodeValue&&!['script','style','noscript','template'].includes(tag)&&!parent?.closest?.('[data-document-search-ignore]');
}
function collectText(root){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:node=>usableTextNode(node)?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT});
  const nodes=[];let text='',node;
  while((node=walker.nextNode())){const value=String(node.nodeValue||'');if(!value)continue;nodes.push({node,start:text.length,end:text.length+value.length});text+=value}
  return {text,nodes};
}
function entryAt(nodes,offset,{end=false}={}){
  let low=0,high=nodes.length-1,best=null;
  while(low<=high){const mid=(low+high)>>1,item=nodes[mid];if(offset<item.start)high=mid-1;else if(offset>item.end||(end&&offset===item.end&&mid<nodes.length-1))low=mid+1;else{best=item;break}}
  return best||nodes[Math.max(0,Math.min(nodes.length-1,low))]||null;
}
function rangeFor(nodes,match){
  const start=entryAt(nodes,match.start),end=entryAt(nodes,Math.max(match.start,match.end-1),{end:true});if(!start||!end)return null;
  const range=document.createRange();range.setStart(start.node,Math.max(0,match.start-start.start));range.setEnd(end.node,Math.max(0,match.end-end.start));return range;
}
function canHighlight(){return typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight!=='undefined'}
function setHighlight(name,ranges){if(!canHighlight())return;CSS.highlights.set(name,new Highlight(...ranges))}
function clearHighlights(){if(!canHighlight())return;CSS.highlights.delete(ALL_HIGHLIGHT);CSS.highlights.delete(CURRENT_HIGHLIGHT)}
function scrollRange(container,range,{behavior='smooth',horizontalScroll=true}={}){
  const rect=range?.getBoundingClientRect?.();if(!rect||(!rect.width&&!rect.height))return;
  const host=container.getBoundingClientRect();const top=container.scrollTop+(rect.top-host.top)-(container.clientHeight/2)+(rect.height/2),left=horizontalScroll?container.scrollLeft+(rect.left-host.left)-(container.clientWidth/2)+(rect.width/2):0;
  container.scrollTo({top:Math.max(0,top),left:Math.max(0,left),behavior});
}

export function createDomSearchNavigator({root,scrollContainer=root,query,contentSearch={},maxMatches=DEFAULT_MAX_MATCHES,onMatchState=()=>{},horizontalScroll=true}){
  if(!root)throw new TypeError('Search root is required');
  const index=collectText(root),search=normalizeContentSearch(contentSearch),found=findTextMatchOffsets(index.text,query,{...search,maxMatches});
  const rows=found.matches.map(match=>({match,range:rangeFor(index.nodes,match)})).filter(row=>row.range);
  let current=rows.length?0:-1,destroyed=false;
  setHighlight(ALL_HIGHLIGHT,rows.map(row=>row.range));
  function state(){const row=current>=0?rows[current]:null;return {current:row?current+1:0,total:rows.length,capped:found.capped,snippet:row?buildTextMatchSnippet(index.text,row.match):null}}
  function publish({scroll=false,behavior='smooth'}={}){if(destroyed)return state();const value=state();setHighlight(CURRENT_HIGHLIGHT,current>=0?[rows[current].range]:[]);if(scroll&&current>=0)scrollRange(scrollContainer,rows[current].range,{behavior,horizontalScroll});onMatchState(value);return value}
  function go(indexValue,{behavior='smooth'}={}){if(!rows.length)return publish();current=(Number(indexValue)%rows.length+rows.length)%rows.length;return publish({scroll:true,behavior})}
  const api={matchState:state,next:()=>go(current+1),previous:()=>go(current-1),go,resize:()=>current>=0&&scrollRange(scrollContainer,rows[current].range,{behavior:'auto',horizontalScroll}),destroy:async()=>{destroyed=true;clearHighlights()}};
  queueMicrotask(()=>publish({scroll:rows.length>0,behavior:'auto'}));return api;
}
