/** Only this small adapter enters the startup graph. The workspace is lazy. */
export function createLazyTaxCalculator(ports) {
  let workspace=null,loading=null,previous=null;
  async function ready(){
    if(workspace)return workspace;
    if(!loading)loading=import('./workspace.js').then(({createTaxWorkspace})=>{workspace=createTaxWorkspace({...ports,back:()=>ports.navigate(previous??ports.defaultPage)});return workspace;}).catch(error=>{loading=null;throw error;});
    return loading;
  }
  async function open(){previous=ports.currentPage();ports.navigate('tax-calculator');const feature=await ready();return feature.activate();}
  function render(){
    if(workspace)return workspace.render();
    const node=ports.container();if(node)node.innerHTML='<section class="tax-page" dir="rtl"><p role="status">טוען מחשבון מסים וארנונה…</p></section>';
    return ready().then(feature=>feature.activate()).catch(()=>{if(ports.active()&&node)node.textContent='טעינת המחשבון נכשלה. רענן את הדף ונסה שוב.';});
  }
  return {open,render,command:async(key,element,event)=>(await ready()).command(key,element,event),dispose:async()=>{if(loading)await loading;return workspace?.dispose();}};
}
