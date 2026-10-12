// Construction is inert; native picker invocation remains in a user gesture.
export function createFolderPicker({environment=globalThis}={}){
  return {
    isAvailable:()=>typeof environment.showDirectoryPicker==='function',
    pick:()=>environment.showDirectoryPicker({mode:'readwrite'}),
  };
}
