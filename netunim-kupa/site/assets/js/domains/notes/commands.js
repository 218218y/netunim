// @ts-check
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';

/** @typedef {{id:string,content:string,createdAt?:string,updatedAt?:string}} StickyNote */
/** @typedef {{notes:StickyNote[]}} NotesState */
/** @typedef {{type:'put',collection:'notes',mode:'insert'|'replace',id:string,record:StickyNote,index?:number}|{type:'delete',collection:'notes',id:string}} NoteOperation */
/** @typedef {{operations:NoteOperation[],deleteIntents?:{notes:string[]},mutationType?:'delete',surface?:string}} NoteSaveOptions */
/**
 * @param {{state:()=>NotesState,scope:()=>unknown,canWrite:()=>boolean,
 *   save:(message:string,options:NoteSaveOptions)=>unknown,
 *   confirmDelete:()=>Promise<boolean>,onRemoved?:()=>void}} ports
 */
export function createStickyNoteCommands({state,scope,canWrite,save,confirmDelete,onRemoved=()=>{}}){
  const saves=createRuntimeTaskOwner();
  let commandEpoch=0;
  const writable=()=>saves.isActive()&&canWrite();
  /** @type {{cancelPending:()=>boolean,drain:()=>Promise<void>,isPending:()=>boolean,dispose:()=>boolean}} */
  const runtime={
    cancelPending:()=>{commandEpoch++;return true},
    drain:saves.drain,isPending:saves.isPending,
    dispose:()=>{commandEpoch++;return saves.close()},
  };

  /** @param {string} message @param {NoteSaveOptions} options */
  function submit(message,options){
    // Submit in the input turn. Persistence owns deferred cloud/file effects;
    // delaying the journal edit lets owner transfer recover an older note.
    const result=saves.run(()=>save(message,options));
    void result.catch(error=>console.error('Kupa sticky note save',error));
    return result;
  }

  /** @param {StickyNote} note */
  function add(note){
    if(!writable())return false;
    state().notes.unshift(note);
    return submit('פתק חדש נוסף',{operations:[{type:'put',collection:'notes',mode:'insert',id:note.id,index:0,record:{...note}}]});
  }

  /** @param {string} id @param {string} content */
  function update(id,content){
    if(!writable())return false;
    const note=state().notes.find(row=>row.id===id);
    if(!note)return false;
    note.content=content;note.updatedAt=new Date().toISOString();
    return submit('הפתק עודכן',{operations:[{type:'put',collection:'notes',mode:'replace',id,record:{...note}}]});
  }

  /** @param {string} id */
  async function remove(id){
    if(!writable()||!state().notes.some(row=>row.id===id))return false;
    const owner=scope(),epoch=commandEpoch;
    if(!await confirmDelete())return false;
    if(!writable()||epoch!==commandEpoch||owner!==scope()||!state().notes.some(row=>row.id===id))return false;
    state().notes=state().notes.filter(row=>row.id!==id);
    const saved=submit('הפתק נמחק',{deleteIntents:{notes:[id]},mutationType:'delete',surface:'kupa.delete.notes',operations:[{type:'delete',collection:'notes',id}]});
    onRemoved();return saved;
  }

  return {add,update,remove,runtime};
}
