# Storage V2 — מצב מימוש וחוזי בטיחות

עודכן ב־22 בספטמבר 2026.

## מצב ההטמעה

מנוע Storage V2 מחובר כעת לשתי האפליקציות בשלושה מצבים: `off`, ‏`shadow` ו־`primary`. ברירת המחדל נשארת `off` עד להשלמת rollout מבוקר של Outbox הענן ו־Shared Checks. במצב `primary`, פעולה מתוארת נשמרת מיד כפעולת journal קטנה ב־LocalStorage ומועברת ל־IndexedDB, בלי לכתוב browser snapshot מלא בכל עריכה. V1 נשאר fallback מאומת לגבולות מלאים ולכשלי מעבר.

החיבור כולל:

- שחזור `checkpoint + IndexedDB journal + emergency journal` בעת פתיחה;
- promotion בטוח מ־V1 או מ־shadow ל־primary באמצעות epoch חדש;
- בחירה ב־V1 כאשר עותק V1 חדש יותר, ולעולם לא בחירה שקטה בעותק V2 פגום;
- `mutationSeq`, ‏`operationId`, ‏generation, writer fencing ו־primary-tab protection;
- compaction אטומי לפי סף פעולות או זמן idle;
- cloud cursor מפורש (`ackSeq`), ‏cloud projection נפרד מ־browser state ו־immutable flight;
- שמירת operations ו־delete intents שלא אושרו בענן גם לאחר checkpoint מקומי;
- ACK שמאשר רק את ה־flight המדויק ואינו מוחק פעולות שנוצרו בזמן ה־RPC.

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

אם כתיבת emergency נכשלת, מסלול ה־browser snapshot של V1 משמש fallback. אם גם V1 נכשל, הפעולה אינה מסומנת כשמורה. כשל IndexedDB לאחר emergency אינו מאבד את הפעולה: היא משוחזרת מן ה־emergency journal בפתיחה הבאה.

בקופה, במסלול primary מתואר, `action → local durable` מסתיים לפני normalize והכנת cloud/file payload. פעולת Checks אינה מנרמלת את כל הקופה לצורך העמידות המקומית. normalization, גיבוי וקובץ מקומי נשארים בתור הבטוח הקיים.

## checkpoints ו־Outbox

Checkpoint נכתב יחד עם `checkpointSeq` באותה עסקת IndexedDB. journal entries נמחקים רק עד הסמן שכבר אושר בענן. לכן delete intent אינו יכול להיעלם עקב compaction מקומי.

Cloud base הוא projection מפורש עם `revision` ו־`ackSeq`. בעת שליחה נוצר flight מלא אחד בלבד ובו `startSeq`, ‏`endSeq`, ‏operation ID, snapshot מדויק ו־delete intents שנאספו מטווח הפעולות. retry לאחר lost ACK מחזיר את אותו flight. ACK מעדכן base עד `endSeq` בלבד; פעולות חדשות יותר נשארות.

ה־RPCs של Supabase, חוזי merge/rebase, finance fencing וגיבויי השרת לא שונו. ה־Outbox הפעיל של האפליקציות נשאר V1 בברירת המחדל עד rollout ייעודי, אף שתשתית cursor/flight של V2 והבדיקות שלה מוכנות.

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
node --test tests/storage_journal.test.mjs tests/storage_operation_contract.test.mjs
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

- להעביר את Outbox הפעיל בשתי האפליקציות מ־`baseState + snapshot` של V1 אל cloud cursor/flight של V2;
- להעביר את Shared Checks לאחר שה־Outbox הראשי עבר soak מוצלח;
- להריץ upgrade/restart ו־offline soak מול נתוני production מייצגים;
- רק לאחר מכן לשנות את ברירת המחדל ל־primary ולהשאיר V1 checkpoint נדיר לתקופת rollback.

אין שינוי ברמת הגיבויים, ב־3-way merge, ב־conflict fail-closed, ב־delete semantics, ב־Local File conflict handling או ב־RPCs. כל מעבר סמכות דורש בדיקות התאוששות ירוקות; שיפור מהירות לבדו אינו תנאי קבלה.
