# Storage V2 — ארכיטקטורה וחוזי בטיחות

[מצב המעבר ושערי השחרור](STORAGE_V2_CUTOVER_STATUS.md) מתעדכנים בנפרד. ברירת המחדל עדיין אינה V2-only.

לכל אפליקציה ולכל בעלים יש Main journal. ל־Shared Checks יש journal נפרד משותף ל־Orders ולקופה. Main מחזיק נתוני אפליקציה; Shared הוא הסמכות ל־`checks` ול־`bankEvents` כאשר הוא Primary. מודל התצוגה מורכב משחזור שני המקורות. `checks` עדיין מופיעים ב־Main schema ישן לצורכי מעבר בלבד; הם אינם יעד לפעולת צ׳ק רגילה ויוסרו ב־cleanup.

פעולה רגילה נרשמת כ־operation קטן ומאומת ב־emergency log סינכרוני, ואחר כך ב־IndexedDB journal עם writer fencing. אם emergency אינו זמין, הפעולה אינה נחשבת durable עד לסיום transaction ב־IndexedDB. Checkpoint נכתב ברקע; journal entries שלא אושרו בענן נשמרים לצורך delete intents, generation ו־audit.

לכל מסמך ענן יש base עם `revision` ו־`ackSeq`. שליחה יוצרת flight בלתי משתנה עם snapshot, טווח רצפים, `operationId` ומחיקות מפורשות. Retry אחרי lost ACK משדר אותו payload. ACK מקדם רק את הרצפים שנשלחו ושומר עריכות שהגיעו בזמן ה־RPC. ב־revision conflict, rebase קובע checkpoint ממוזג ו־base חדש באותה transaction, ואז ניתן ליצור flight חלופי. אירועי בנק של Shared נקבעים עם ה־ACK/rebase.

שחזור ענן וייבוא מקומי מלא נוגעים בשני journals ולכן משתמשים ב־boundary coordinator. ה־intent נשמר לפני כתיבת אחד הצדדים, וכל צד רושם אותו boundary ID. Restart משלים שלב חסר באופן idempotent. שחזור ענן מתקין head סמכותי לפי תוצאת השרת; ייבוא מקומי שומר את ה־cloud base/revision ומייצר pending V2. פעולת `replace-state` מלאה מותרת רק ל־boundary ייבוא או לנרמול חד־פעמי ומזוהה של נתוני ענן ישנים; היא אינה במסלול העריכות הרגילות.

`storageCutoverVersion=2` הוא סמן עמיד לפי אפליקציה וחשבון ב־IndexedDB, עם cache סינכרוני ב־LocalStorage עבור writers. סמן IDB חסר מול cache קיים חוסם; cache שנמחק ניתן לשחזור רק מסמן IDB תקין. כתיבת הסמן דורשת שני checkpoints בתפקיד Primary, cursors נקיים וללא boundary פתוח. מסלול production ב־Settings מפעיל הכנה עמידה, ניקוז V1, bootstrap של שני המסמכים, השוואה של כל base למסמך הענן ולמצב המשוחזר מה־journal, ורק אז כתיבת הסמן. קבוצת bootstrap קשורה למזהה הכנת ה־cutover כדי שחידוש לאחר קריסה לא יגלה מחדש מסמך שנוצר במהלך אותו מעבר. המסלול הזה חל כיום על חשבון קיים; `local` והתקנה חדשה עדיין דורשים מסלול V2 נפרד לפני הסרת V1.

## חוזה שינוי וכשל

שמירה עסקית רגילה צריכה לספק `operations` שמתארות את כל השינויים, כולל מחיקות ושינויים נלווים בסדר הרשומות. `deleteIntents` אינם תחליף לפעולת מחיקה מקומית. שינוי מלא כגון import או restore משתמש ב־boundary מפורש; אין להסיק פעולות מתוך השוואת שני snapshots גדולים. בדיקות ה־AST ב־CI מגנות על בעלי mutation חדשים.

כאשר emergency log נכשל, אין להציג את הפעולה כעמידה לפני ש־IndexedDB אישר את הכתיבה. כשל של שני המסלולים משאיר אזהרת סגירה פעילה. לאחר checkpoint מקומי, פעולות שלא קיבלו ACK בענן נשארות ב־journal כדי לשמר את טווח ה־flight, המחיקות וה־audit. קריאת IndexedDB זמנית שנכשלה אינה מסמנת זהות תקינה כפגומה לצמיתות.

בתקופת המעבר, V1 pending קיים נשלח עד ACK ורק לאחר מכן נקבע cursor V2 ממקור סמכותי. אין להמיר אוטומטית `baseState + snapshot` ישן לרשימת פעולות משוערת. לאחר cutover עמיד אין להרשות חזרה רגילה לכתיבת V1, גם אם מפתח mode ישן שונה ידנית.

בדיקות רלוונטיות:

```text
node --test tests/storage_journal.test.mjs tests/storage_cloud_v2.test.mjs tests/storage_v2_boundary.test.mjs tests/storage_v2_write_gate.test.mjs
python tests/runtime_storage.py
python tests/run_all.py --keep-going
```

בדיקות הדפדפן משתמשות ב־IndexedDB אמיתי ובודקות abort/restart, איבוד ACK, rebase, ייבוא מקומי ו־writer fencing. שחרור cutover עדיין מחייב גם בדיקת שני לקוחות אמיתיים ושער zero-V1-write על workflows מלאים.
