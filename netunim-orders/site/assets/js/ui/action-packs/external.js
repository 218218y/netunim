import {markMutationActions} from '../../shared/action-registry.js';

const notesMutations=[
  'add-notes-sheet','delete-notes-sheet','rename-notes-sheet',
  'add-notes-sheet-row','add-notes-sheet-row-after','update-notes-sheet-cell',
  'save-notes-sheet-cell','delete-notes-sheet-row','add-notes-sheet-column',
  'draft-notes-sheet-column-title','rename-notes-sheet-column',
  'set-notes-sheet-column-numeric','delete-notes-sheet-column',
  'spreadsheet-import','spreadsheet-restore','spreadsheet-use-remote',
];

export function createExternalActionPacks({notesSheetActions,creditOrderActions}){
  return [
    {name:'credit-order',actions:markMutationActions(creditOrderActions,{finance:['credit-card-order-save']})},
    {name:'notes-sheet',actions:markMutationActions(notesSheetActions,{notes:notesMutations})},
  ];
}
