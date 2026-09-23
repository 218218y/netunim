# Storage V2 — מצב מעבר ושערי שחרור

עודכן ב־23 בספטמבר 2026. ברירת המחדל בשתי האפליקציות עדיין אינה V2-only. הסרת V1 אינה מאושרת לפני cutover מתוזמר ובדיקה של שני מחשבי המשתמש על נתונים אמיתיים.

## הושלם בקוד

- Main V2 ו־Shared Checks V2 שומרים journal, checkpoint, cloud cursor ו־flight עצמאיים. ACK/rebase ו־lost ACK מוגנים מקריסה. עריכת צ׳ק רגילה בזמן Shared Primary נכתבת ל־Shared בלבד.
- שחזור ענן קבוצתי עובר coordinator עמיד בין Main ל־Shared. ייבוא JSON/קובץ מקומי בזמן Shared Primary עובר כעת `replace-local-with-pending`: ה־cloud base וה־revision אינם נמחקים, בשני ה־journals נוצר pending, מחיקות נרשמות במפורש, ו־`bankEvents` חיים נשמרים. Restart ממשיך boundary שנקטע.
- סימון cutover נשמר ב־IndexedDB. ה־transaction המסמנת בודקת כעת גם רצף נקי ללא pending, flight או control בשני ה־journals. Cache חסר ב־LocalStorage משוחזר רק מסימון IDB תקין; הכיוון ההפוך חסום.
- Orders אינו מציג נתונים עסקיים בלשונית משנית לאחר cutover לפני Shared hydration סמכותי. מסלולי V1 רבים כבר חוסמים כתיבה תחת marker.
- בקופה, פתיחת קובץ מקומי מול cloud cursor קיים יוצרת pending import מתואם ב־Main וב־Shared. שמירה נוספת לקובץ מחייבת התאמה ל־journal; שינוי חיצוני בקובץ נעצר לבדיקה, בלי להחליף checkpoint או cloud base בשקט.
- נרמול נתוני קופה ישנים מהענן (מזהי כרטיסים חסרים או אשראי שפג) נרשם כ־pending V2 עמיד ומזוהה, במקום טיימרים שמנסים למחוק שוב רשומות שכבר אינן ב־checkpoint. ה־cloud base משמר את מזהי האשראי שבשרת עד ACK, כך שנשלחים `deleteIntents` מדויקים דרך RPC של מחיקה מרובה גם כשנוקו רשומות רבות. ניקוי אשראי ללא פעולות typed מתקבל רק אם השוואה ל־journal מוכיחה שאין שינוי נוסף. מסלולי first-cloud נעצרים לפני כתיבת V1 כאשר V2 נדרש אך head של החשבון טרם אותחל.
- התנתקות יזומה תחת V2 נחסמת כל עוד אין handoff עמיד לחשבון המקומי. כך הנתונים המוצגים של החשבון אינם עוברים בשקט ל־writer של `local`; לפני שחרור V2-only צריך להחליף חסימה זו בזרימת התנתקות מלאה ובטוחה.
- בדיקת דפדפן עם IndexedDB אמיתי ו־marker עמיד מנטרת כתיבות עסקיות ישנות ב־LocalStorage וב־IndexedDB בזמן startup, עריכת נתונים וצ׳ק, pagehide ו־restart בשתי האפליקציות.

## מה עדיין חוסם V2-only

1. **First-cloud בשתי האפליקציות:** ה־UI עדיין יוצר מסמך ראשון דרך V1. נדרש bootstrap עמיד של Main+Shared, עם המשך בטוח אחרי קריסה בין יצירת שני מסמכי הענן, בלי V1 outbox.
2. **מעבר זהויות:** ה־runtime דורש intent מפורש, אך login/logout, אובדן session לאחר כישלון refresh והחלפת חשבון ב־UI עדיין לא משלימים `load-account` מול `upload-local`, חסימת תצוגת חשבון קודם וניקוז pending של בעלים ישן. חסימת logout היזום אינה פותרת אובדן session אוטומטי.
3. **Cutover coordinator בייצור:** `markCutover` הוא primitive מוקשח, אך אין עדיין workflow באפליקציה שמבצע migration, בדיקת parity ו־revisions, ניקוז V1, קידום Shared והפעלת marker כפעולה אחת מבוקרת.
4. **שער zero-V1-write מלא:** הבדיקות הקיימות ממוקדות. יש להריץ workflows אמיתיים תחת marker ולנטר LocalStorage ואת חנויות IndexedDB הישנות, כולל startup, import, first-cloud, restore, offline, logout והחלפת חשבון.
5. **אימות שחרור:** נדרש גיבוי ובדיקת A→B ו־B→A בשני המחשבים, כולל offline→restart→online, lost ACK, conflict, צ׳קים ואירוע בנק. רק אחר כך ניתן להפעיל default V2 ולבצע soak.

## סדר השחרור

אימות מקומי ב־23 בספטמבר 2026: כל 39 חבילות `tests/run_all.py` עברו, כולל בדיקות IndexedDB בדפדפן, סנכרון מדומה של שני מחשבים ו־zero-V1-write תחת marker. בדיקה זו אינה תחליף ל־soak על שני המחשבים עם הנתונים האמיתיים.

להשלים תחילה first-cloud, account handoff ו־cutover coordinator; להריץ שער zero-V1-write ובדיקות דפדפן/שני מחשבים; לשחרר cutover שבו V2 הוא writer יחיד ו־V1 נשאר reader ל־migration/drain בלבד. בגרסת cleanup נפרדת, אחרי שאין legacy pending, להסיר `checks` מ־Main schema/checkpoint, `afterLegacy`, browser snapshots ו־outboxes ישנים, shadow adapters וענפי migration שאינם בני־השגה. מחיקת keys/stores תהיה מרשימה מפורשת, ללא wildcard על `.v1`.
