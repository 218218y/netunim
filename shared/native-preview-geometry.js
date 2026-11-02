// Browser frame sizes include docked DevTools. Native placement instead uses
// page-relative physical pixels and the actual render window's client origin.
export function nativePreviewGeometry(rect,win){
  const scale=Math.max(.5,Math.min(5,Number(win.devicePixelRatio)||1)),physical=value=>Math.round(value*scale);
  if(!rect||![rect.left,rect.top,rect.width,rect.height,win.innerWidth,win.innerHeight].every(Number.isFinite))return null;
  const left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(win.innerWidth,rect.left+rect.width),bottom=Math.min(win.innerHeight,rect.top+rect.height);
  if(right-left<80||bottom-top<80)return null;
  return {coordinateSpace:'viewport',x:physical(left),y:physical(top),width:physical(right-left),height:physical(bottom-top),
    viewportWidth:physical(win.innerWidth),viewportHeight:physical(win.innerHeight),scale};
}
