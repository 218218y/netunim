

// Owns review commands; application startup supplies its narrow ports.
export function createCloudReview({session,view={},main={}}){
  const {toast,confirmDialog}=view;
  const {loadSupabaseState}=main;

async function discardCloudPendingAndLoadRemote(){if(!session.cloudConflictPending)return loadSupabaseState();if(!await confirmDialog('טעינת גרסת הענן','פעולה זו תוותר על השינוי המקומי שממתין ותטען את גרסת הענן. מומלץ קודם ללחוץ על ייצא JSON.',{confirmText:'טען גרסת ענן',cancelText:'ביטול',tone:'danger'}))return;await loadSupabaseState({discardLocalV2:true});toast('נטענה גרסת הענן')}

return {discardCloudPendingAndLoadRemote};
}
