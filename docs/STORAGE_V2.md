# Storage V2 — מצב מימוש וחוזי בטיחות

עודכן ב־23 בספטמבר 2026.

## תיקון בטיחות ל־rebase

בעת `revision_conflict` שאפשר למזג, ה־cloud base החדש, ה־checkpoint המקומי הממוזג, מחיקת ה־flight הישן וה־control נכתבים כעת באותה עסקת IndexedDB, עם בדיקת `expectedSeq`. קריסה לאחר ה־reject ולפני יצירת flight חלופי משחזרת גם שינוי מקומי וגם שינוי שהגיע מרחוק. אם עריכה נוספת מגיעה בזמן commit של ה־rebase, הסנכרון נעצר עם control מסוג `concurrent-rebase` בלי לדרוס את העריכה הגלויה. בדיקות Node ו־IndexedDB אמיתי מכסות קריסה, abort ופתיחה מחדש בנקודות האלה.

## מצב ההטמעה

מנוע Storage V2 מחובר כעת לשתי האפליקציות בשלושה מצבים: `off`, ‏`shadow` ו־`primary`. ברירת המחדל נשארת `off` עד להשלמת rollout מבוקר. במצב `primary`, פעולה מתוארת נשמרת מיד כפעולת journal קטנה ב־LocalStorage ומועברת ל־IndexedDB, בלי לכתוב browser snapshot מלא בכל עריכה. בשתי האפליקציות הושלם גם cutover מדורג של ה־Cloud Outbox הראשי: לאחר ש־V1 pending קודם נוקז ונקבע cloud cursor סמכותי, עריכות רגילות אינן בונות עוד `baseState + snapshot` מלא בכל mutation. Shared Checks נשאר בשלב זה על Outbox V1 בכוונה, עד soak של המסמך הראשי. V1 ממשיך לשמש compatibility/fallback לגבולות מלאים, restore/import ולשדרוגים ישנים.

החיבור כולל:

- שחזור `checkpoint + IndexedDB journal + emergency journal` בעת פתיחה;
- promotion בטוח מ־V1 או מ־shadow ל־primary באמצעות epoch חדש;
- בחירה ב־V1 כאשר עותק V1 חדש יותר, ולעולם לא בחירה שקטה בעותק V2 פגום;
- `mutationSeq`, ‏`operationId`, ‏generation, writer fencing ו־primary-tab protection;
- compaction אטומי לפי סף פעולות או זמן idle;
- cloud cursor מפורש (`ackSeq`), ‏cloud projection נפרד מ־browser state ו־immutable flight;
- שמירת operations ו־delete intents שלא אושרו בענן גם לאחר checkpoint מקומי;
- ACK שמאשר רק את ה־flight המדויק ואינו מוחק פעולות שנוצרו בזמן ה־RPC;
- reject/rebase מפורש ל־`revision_conflict` מוכח: lost ACK שומר את אותו flight, ואילו conflict ודאי מסובב operation ID חדש לאחר rebase;
- retry/conflict control עמיד ב־IndexedDB, ו־ACK בשתי האפליקציות מסוגל לכתוב cloud base + checkpoint נוכחי + control באותה transaction;
- reset מפורש של head סמכותי יוצר epoch חדש ומחליף checkpoint + cloud base תוך מחיקת flight/journal/control הישן באותה transaction. הוא משמש רק בוויתור מפורש על pending מקומי, לא כפתרון אוטומטי להתנגשות.

## חוזה mutation

כל קריאה עסקית אל `scheduleSave`, ‏`saveState`, ‏`scheduleCheckSave` או `saveChecksState` חייבת לספק אחד משני חוזים:

1. `operations` מלאות שמתארות את כל השינוי; או
2. `storageBoundary` מפורש עבור restore, import, remote authoritative apply או שינוי רחב אחר.

אין הסקה של פעולת delete מתוך `mutationType` או מתוך `deleteIntents`. מחיקת עסקת ספק כוללת גם את כל שינויי ה־sequence שנגרמו בעקבות resequence. ניקוי היסטוריית מלאי כולל גם את רשומות ה־adjustment שנוצרו. תופעות לוואי של normalization מתוארות כמחיקות מפורשות או גורמות ל־checkpoint boundary.

הכיסוי קיים כעת ב־Suppliers, Customers/Debts, Service, Inventory/Warehouse, Notes, Orders checks, ובקופה ב־Cash, Rights, Expenses, Cards/Credit, Bank, Credit Sync, Settings, Notes ו־Checks. בדיקת AST ב־CI מונעת הוספת mutation owner חדש ללא אחד משני החוזים.

## מסלול הכתיבה

ב־primary, פעולה רגילה עוברת כך:

```text
validation מלא
→ emergency operation קטן ומאומת ב־LocalStorage
→ עדכון UI יכול להיצבע
→ commit של אותה פעולה ב־IndexedDB
→ ניקוי emergency רק לאחר transaction.oncomplete
→ materialization כבד יותר בתור הבא
→ checkpoint בזמן idle או לאחר סף פעולות
```

אם כתיבת emergency נכשלת, הפעולה ממתינה לאישור commit של IndexedDB ואינה מסומנת כשמורה או נשלחת לענן לפניו; אין כתיבת full V1 snapshot רק בשל כשל זה. אם גם IndexedDB נכשל, השמירה נעצרת, מוצגת אזהרה שלא לסגור את החלון ו־beforeunload מנסה לחסום יציאה. כשל IndexedDB לאחר emergency מאומת אינו מאבד את הפעולה: היא משוחזרת מן ה־emergency journal בפתיחה הבאה. גבולות מלאים וחוסר מוכנות של V2 עדיין משתמשים במסלול התאימות של V1.

בקופה, במסלול primary מתואר, `action → local durable` מסתיים לפני normalize והכנת cloud/file payload. פעולת Checks אינה מנרמלת את כל הקופה לצורך העמידות המקומית. normalization, גיבוי וקובץ מקומי נשארים בתור הבטוח הקיים.

## checkpoints ו־Outbox

Checkpoint נכתב יחד עם `checkpointSeq` באותה עסקת IndexedDB. journal entries נמחקים רק עד הסמן שכבר אושר בענן. לכן delete intent אינו יכול להיעלם עקב compaction מקומי.

Cloud base הוא projection מפורש עם `revision` ו־`ackSeq`. בעת שליחה נוצר flight מלא אחד בלבד ובו `startSeq`, ‏`endSeq`, ‏operation ID, snapshot מדויק ו־delete intents שנאספו מטווח הפעולות. retry לאחר lost ACK מחזיר את אותו flight. ACK מעדכן base עד `endSeq` בלבד; פעולות חדשות יותר נשארות.

ה־RPCs של Supabase, finance fencing וגיבויי השרת לא שונו. ב־Orders וב־Kupa, כאשר Storage V2 `primary` מוכן ויש base תקין ואין V1 pending, ה־writer משתמש ב־V2 flight. כשל רשת או lost ACK משאיר את ה־flight immutable; `revision_conflict` שקיבל תשובה ודאית קורא remote, עושה 3-way merge, דוחה את ה־flight הישן ורק אז יוצר flight חדש לאותו `endSeq`. ACK מתקדם רק עד סוף ה־flight, ופעולות שנוצרו בזמן ה־RPC עוברות rebase ונשמרות ב־checkpoint באותה עסקה עם ה־ACK.

ה־migration אינו מנסה להמיר `baseState + snapshot` ישן לרשימת operations: V1 pending קיים ממשיך להישלח ב־writer הישן עד ACK, ורק כשהוא נקי נלכד cursor V2 מה־state הסמכותי. ניקיון ה־V1 head אינו מוסק מ־LocalStorage בלבד: לפני הפעלת writer/cursor של V2 נבדקים גם ה־cache המקומי וגם רשומת ה־IndexedDB העמידה. אם הקריאה העמידה נכשלת או שה־head טרם אומת כנקי, ה־cutover נשאר fail-closed במסלול V1 ואינו לוכד cursor חדש. אם אין עדיין cursor תקין, האפליקציה נשארת זמנית במסלול V1 במקום למחוק pending או לנחש בסיס. בקופה גם משיכת Shared Checks/Finance מרחוק מעדכנת checkpoint בתוך אותו epoch ואינה מאפסת את cursor של המסמך הראשי.

## מצבי הפעלה

Shadow, לצורך השוואת replay מול V1:

```js
localStorage.setItem('netunim-storage-v2-mode:kupa', 'shadow');
localStorage.setItem('netunim-storage-v2-mode:orders', 'shadow');
```

Primary מקומי מבוקר:

```js
localStorage.setItem('netunim-storage-v2-mode:kupa', 'primary');
localStorage.setItem('netunim-storage-v2-mode:orders', 'primary');
```

כיבוי:

```js
localStorage.setItem('netunim-storage-v2-mode:kupa', 'off');
localStorage.setItem('netunim-storage-v2-mode:orders', 'off');
```

הפעלת primary אינה מיועדת כרגע למשתמשי production לפני החלטת rollout. מעבר מ־shadow לעולם אינו מעניק ל־shadow סמכות אוטומטית: V1 מקודם ל־epoch ראשי מאומת. חזרה זמנית ל־V1 ולאחריה primary בוחרת ב־V1 אם `snapshotSeq` שלו חדש יותר.

## בדיקות וקבלה

```text
node --test tests/storage_journal.test.mjs tests/storage_operation_contract.test.mjs tests/storage_cloud_v2.test.mjs tests/orders_storage_v2_cloud.test.mjs tests/kupa_storage_v2_cloud.test.mjs
python tests/runtime_storage.py
python tests/run_all.py --keep-going
```

`runtime_storage.py` מריץ Chromium ו־IndexedDB אמיתיים ובודק בין היתר:

- crash לפני ואחרי emergency/IDB;
- transaction abort בזמן journal ובזמן checkpoint;
- duplicate emergency + IDB ללא effect כפול;
- mutation בזמן compaction ובזמן flight;
- lost ACK, ACK שגוי ו־ACK שאינו מוחק mutation חדש יותר;
- delete intent שנשמר עד ACK גם לאחר checkpoint;
- cloud projection ששונה ממבנה browser state;
- quota failure, כשל IDB וכשל של שתי השכבות;
- writer fencing ו־secondary tab;
- restore שמחליף epoch רק לאחר commit;
- hard navigation בשתי האפליקציות תחת primary;
- הוכחה שעריכה קטנה אינה משנה את full V1 LocalStorage snapshot.

במדידה הסינתטית הנוכחית, browser snapshot של כ־1.18MB דרש בערך 19–36ms במסלול V1, בהתאם לאפליקציה ולריצה. אותה עריכת Notes במסלול primary כתבה emergency של כ־595–597 bytes, ו־`save-local` הסתיים סביב 0.3–0.7ms. המדד הארכיטקטוני ב־CI הוא שהיקף הכתיבה הסינכרונית של edit קטן אינו גדל עם גודל המסמך.

## מה נשאר לפני rollout מלא

- כשל בכתיבת emergency כבר אינו מפעיל לבדו full V1 snapshot: רק commit מאושר ב־IndexedDB מתיר סימון שמירה ושליחת ענן. כשל בשתי השכבות נשאר fail-closed; בדיקות דפדפן מבצעות hard reload ומאמתות שחזור מדויק.
- פעולת שחזור ו־writer ננעלים לזהות החשבון שהתחילה אותם. החלפת חשבון בזמן פתיחת IndexedDB אינה יכולה להעביר Promise, הרשאת כתיבה או סימון corruption לחשבון החדש; בדיקות חפיפה מכסות זאת.
- ב־primary, ‏pagehide של המסמך הראשי אינו בונה snapshot מלא. מסלולי Shared Checks הזמניים עדיין עשויים לכתוב Outbox מלא בעת סגירה, עד להעברה שלהם ל־V2.
- לפני cutover סופי יש להחליף את Shared Checks Outbox V1 ב־cursor/flight עצמאי, להמיר את כל גבולות ה־full-state שעדיין נזקקים ל־`afterLegacy`, ולהוסיף בדיקת Production שמכשילה כל כתיבה רגילה למפתחות V1. אין להפעיל ברירת מחדל `primary` או למחוק מפתחות V1 לפני שהחוזים הללו עוברים בדיקות restart, lost ACK, הפקדה/החזרה/מחיקה ושני מחשבים.
- להריץ soak ייעודי ל־Cloud Outbox V2 הראשי בשתי האפליקציות על upgrade, restart, offline, lost ACK, conflict ונתונים גדולים;
- להעביר את Shared Checks רק לאחר שה־Outbox הראשי בשתי האפליקציות עבר soak מוצלח;
- להריץ upgrade/restart ו־offline soak מול נתוני production מייצגים;
- רק לאחר מכן לשנות את ברירת המחדל ל־primary ולהשאיר V1 checkpoint נדיר לתקופת rollback.

אין שינוי ברמת הגיבויים, ב־3-way merge, ב־conflict fail-closed, ב־delete semantics, ב־Local File conflict handling או ב־RPCs. כל מעבר סמכות דורש בדיקות התאוששות ירוקות; שיפור מהירות לבדו אינו תנאי קבלה.
