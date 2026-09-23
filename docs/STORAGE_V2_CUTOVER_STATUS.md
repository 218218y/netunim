# Storage V2 — מצב מעבר ובדיקות קבלה

עודכן ב־23 בספטמבר 2026.

ברירת המחדל של שתי האפליקציות עדיין אינה V2-only. אין למחוק את מפתחות V1 או את קוראי ה־migration בשלב זה. הסרתם תתבצע בגרסת cleanup נפרדת, לאחר מעבר מוכח של שני המחשבים וללא pending ישן.

## מה כבר קיים בקוד

- Main Storage V2 שומר פעולות רגילות ב־journal עם checkpoint, emergency log, cursor ו־flight. ה־rebase מקבע באותה עסקת IndexedDB את ה־checkpoint הממוזג ואת cloud base החדש.
- Shared Checks V2 מחזיק namespace עצמאי של `checks` ו־`bankEvents`, כולל bootstrap אטומי למסמך ראשון, flight בלתי משתנה, merge, ACK/rebase ואירועי בנק. מתאמי Orders וקופה יודעים לנתב עריכת צ׳ק רגילה ל־Shared V2 בלבד כשהוא Primary.
- מעבר בעלות חשבון אינו מבצע migration שקט מהמודל המוצג. אתחול מסמך חדש דורש intent ומקור מפורשים.
- יש coordinator עמיד לפעולות נדירות שנוגעות בשני ה־journals. הוא רושם intent, חוסם עריכות מתחרות בעת ההחלה ויכול להשלים לאחר קריסה בין הפעלת Shared להפעלת Main. שחזור ענן קבוצתי בשתי האפליקציות מחובר אליו כאשר Shared Checks V2 הוא Primary; import ושחזור קובץ מקומי עדיין דורשים חוזה V2 מלא.
- recovery מבחין בין נתונים פגומים לתקלת IndexedDB זמנית. סמן cutover עמיד וספציפי ליישום ולחשבון קיים, ובדיקת startup חוסמת אי־התאמה בין IndexedDB ל־LocalStorage.
- לאחר סמן cutover, מסלולי הכתיבה הישנים של Shared Checks, צילום הדפדפן וה־outbox הראשי שנבדקו חוסמים כתיבת V1. השער עדיין אינו מכסה באופן מוכח את כל מסלולי האפליקציה.

## חסמי הפעלה

1. להשלים import ושחזור קובץ מקומי כפעולה מתואמת המשמרת גם cloud base וגם pending חדש, ולבדוק חידוש restore קבוצתי על שני המחשבים. אסור לשחזור לעדכן Main V2 ואז לכתוב בסיס Shared V1.
2. להשלים את מסלולי first-cloud והחלפת חשבון בשתי האפליקציות עם בחירה מפורשת בין טעינת החשבון להעלאת נתונים מקומיים.
3. להריץ שער zero-V1-write על כל תרחישי היישום, כולל startup, cloud ACK, אופליין, restore, import, logout ו־account switch. מפתחות preferences/session אינם חלק מהשער.
4. להריץ A→B ו־B→A בשני המחשבים עם גיבוי מוקדם, lost ACK, conflict, פעולות צ׳ק ואירוע בנק, ואז soak של גרסת cutover. רק לאחר מכן להסיר writers/readers ישנים ואת `checks` מ־Main schema בגרסת cleanup נפרדת.

הסמן אינו נקבע אוטומטית. עצם קיומם של API ובדיקות אינו אישור להפעיל V2-only על נתוני משתמש אמיתיים.
