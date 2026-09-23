# Shared Checks Storage V2

מצב החיבור החדש ל־Primary והחסמים להפעלת V2-only מפורטים ב־[STORAGE_V2_CUTOVER_STATUS.md](STORAGE_V2_CUTOVER_STATUS.md).

עודכן ב־23 בספטמבר 2026. המימוש הנוכחי הוא **תשתית ו־shadow בלבד**. מנגנון
Shared Checks הישן עדיין אחראי לשמירה ולסנכרון בפועל; אין להפעיל cutover רק משום
שבדיקות היחידה של המנוע החדש עוברות.

`rejectAndRebase` שומר כעת את ה־cloud base החדש וה־checkpoint הממוזג בעסקת IndexedDB אחת. בדיקת restart מוכיחה ש־check ואירוע בנק שהגיעו מרחוק אינם נעלמים אם הדפדפן נסגר לפני יצירת flight חלופי. תיקון זה חל גם על מנוע המסמך הראשי; הוא אינו הופך את Shared Checks למסלול Primary פעיל.

המנוע החדש נמצא ב־`shared/shared-checks-storage-v2.js`. לכל חשבון יש namespace
נפרד, `account:shared-checks`, עם checkpoint ו־journal של `{checks, bankEvents}`,
cloud cursor עצמאי ו־flight בלתי משתנה. פעולת מחיקה מחייבת גם operation מפורש
וגם delete intent תואם. ACK שכותב אירועי בנק מחייב checkpoint של אותם אירועים
באותה עסקת IndexedDB; ACK עם sequence מיושן נדחה. ל־shadow אין הרשאה לכתוב
cursor, flight או control של הענן.

אפשר להפעיל השוואת replay מקומית בלבד בעזרת
`localStorage.setItem('netunim-shared-checks-v2-shadow', '1')` ורענון הדף.
אחרי פעולה אפשר לקרוא את
`(await import('/assets/js/main.js')).sharedChecksStorageV2Diagnostics()`
בכל אחת משתי האפליקציות. `mismatches`, `missingOperations`,
`unverifiedBaseline`, `errors` ו־`ownerTransitions` חייבים להישאר אפס לאורך
בדיקת תרחישים מייצגים. בעת החלפת
חשבון, ה־shadow עוצר במקום לייחס את הנתונים הגלויים לחשבון החדש; יש לפתוח
מחדש עם מקור סמכותי מפורש.

לפני הפיכת Shared Checks V2 למסלול הפעיל נדרשים עדיין חוזים ובדיקות שלא קיימים
במימוש הנוכחי:

- commit/recovery אטומי של פעולת צ׳ק שנכתבת גם ל־journal של המסמך הראשי וגם
  ל־journal העצמאי של Shared Checks. קריסה בין שתי כתיבות נפרדות אינה קבילה.
- migration מ־V1 pending מאומת, first cloud bootstrap ו־owner handoff מפורשים;
  אין להעתיק מצב בין חשבונות לפי הנתונים שמוצגים כרגע במסך.
- חיבור ה־cursor/flight ל־RPC הקיים בשתי האפליקציות עם merge תלת־כיווני,
  lost ACK, conflict, אירועי בנק ו־mutation שמגיע בזמן RPC.
- שער CI שמוכיח שב־primary אין כתיבה רגילה למפתחות V1, ולאחריו בדיקות
  hard restart, offline, restore ושני מחשבים עם נתונים אמיתיים.

עד שכל אלה עוברים, ברירת המחדל של Storage V2 נשארת `off` וה־V1 writer אינו
מוסר. בדיקות ה־shadow מספקות ראיה לתאימות הפעולות; הן אינן מוכיחות cutover.
