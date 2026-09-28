const PDF_OPEN_PARAMS='toolbar=0&navpanes=0&view=FitH';
const PDF_FRAGMENT_CONTEXT_CHARS=84;

function encodedText(value){
  return encodeURIComponent(String(value||'')).replace(/-/g,'%2D');
}

function normalizedContext(value){
  return String(value||'').replace(/\s+/g,' ').trim();
}

function edgeContext(value,{tail=false,maxChars=PDF_FRAGMENT_CONTEXT_CHARS}={}){
  const text=normalizedContext(value);if(!text)return '';
  if(text.length<=maxChars)return text;
  const slice=tail?text.slice(-maxChars):text.slice(0,maxChars);
  if(tail){const boundary=slice.indexOf(' ');return (boundary>=0?slice.slice(boundary+1):slice).trim()||slice.trim()}
  const boundary=slice.lastIndexOf(' ');return (boundary>0?slice.slice(0,boundary):slice).trim()||slice.trim();
}

export function buildPdfTextDirective(snippet,query=''){
  const match=String(snippet?.match||query||'').trim();if(match.length<2)return '';
  const prefix=edgeContext(snippet?.before,{tail:true}),suffix=edgeContext(snippet?.after);
  const start=encodedText(match);
  if(prefix&&suffix)return `${encodedText(prefix)}-,${start},-${encodedText(suffix)}`;
  if(prefix)return `${encodedText(prefix)}-,${start}`;
  if(suffix)return `${start},-${encodedText(suffix)}`;
  return start;
}

export function buildPdfTextDirectives(info,{activeIndex=0}={}){
  if(!info?.active)return [];
  const snippets=Array.isArray(info.snippets)?info.snippets:[],query=String(info.query||'').trim();
  const directives=snippets.map(snippet=>buildPdfTextDirective(snippet,query)).filter(Boolean);
  if(!directives.length&&query.length>=2)directives.push(encodedText(query));
  if(directives.length<2)return directives;
  const index=Math.max(0,Math.min(directives.length-1,Number(activeIndex)||0));
  if(index===0)return directives;
  return [directives[index],...directives.slice(0,index),...directives.slice(index+1)];
}

export function buildPdfPreviewSrc(url,{query='',matchInfo=null,activeIndex=0}={}){
  const base=`${url}#${PDF_OPEN_PARAMS}`;
  const directives=buildPdfTextDirectives(matchInfo,{activeIndex});
  if(directives.length)return `${base}&:~:${directives.map(value=>`text=${value}`).join('&')}`;
  const fallback=String(query||'').trim();
  return fallback.length>=2?`${base}&:~:text=${encodedText(fallback)}`:base;
}
