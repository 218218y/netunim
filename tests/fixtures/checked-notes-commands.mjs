import {createStickyNoteCommands} from '../../netunim-kupa/site/assets/js/domains/notes/commands.js';

const notes=createStickyNoteCommands({state:()=>({notes:[]}),scope:()=> 'local',canWrite:()=>true,
  save:(_message,options)=>options.operations.length,confirmDelete:async()=>true,
});
notes.update('N','exact content');
notes.add({id:'N',content:'exact content'});
/** @type {Promise<void>} */
const drain=notes.runtime.drain();
void drain;
// @ts-expect-error IDs must be strings.
notes.update(7,'content');
// @ts-expect-error Business text must be decoded before it reaches the command.
notes.update('N',{content:'unchecked'});
// @ts-expect-error A UI guard cannot authorize a write with display text.
createStickyNoteCommands({state:()=>({notes:[]}),scope:()=>null,canWrite:()=> 'writable',save:()=>{},confirmDelete:async()=>true});
// @ts-expect-error Confirmation must resolve a boolean.
createStickyNoteCommands({state:()=>({notes:[]}),scope:()=>null,canWrite:()=>true,save:()=>{},confirmDelete:async()=> 'approved'});
