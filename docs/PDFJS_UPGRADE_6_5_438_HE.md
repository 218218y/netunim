# שדרוג PDF.js מ־6.4.299 ל־6.5.438

## מה שודרג

- החבילה הרשמית `pdfjs-dist@6.5.438`, עם מזהה בנייה `0a4153349`, ננעלה במנגנון הקיים של `tools/pdfjs-runtime.py` על פי SHA-512 של npm. אין שינוי במסלול ההפעלה או עקיפה של בקרת השלמות.
- עדכון תואם של `build/pdf.mjs`, ה־Worker, רכיבי הצגת PDF והקבצים התומכים בשני האתרים; במקביל עודכן רכיב ה־Windows Document Bridge מתוך ה־legacy build של **אותה חבילת npm**.
- `pdfjs-runtime-config.js` הסנכרוני, מניפסטי הקבצים וחותמות ה־Service Worker עודכנו; בדיקות קורפוס ה־PDF קובעות כעת את גרסת הבסיס החדשה.
- בדיקת חילוץ החשבונית נבדקת מול גרסת הנעילה הפעילה ובודקת בנפרד אי־התאמה בגרסה ובמזהה הבנייה.

## מדוע לא להעתיק ישירות את ה־ZIP של Mozilla

ה־ZIP הכללי מכיל `build/pdf.mjs` ו־`web/viewer.mjs`, אך אינו מכיל את `web/pdf_viewer.mjs` ואת קובצי `legacy/build/` הנחוצים לשימוש המותאם ול־Document Bridge. החבילה ב־npm מספקת את כולם. גם קבצים בעלי אותה גרסה ומזהה בנייה יכולים לכלול מזהה אירועים פנימי שונה בין תוצרי בנייה; לכן אסור לשלב באופן ידני `pdf.mjs` מה־ZIP עם `pdf_viewer.mjs` מחבילת npm אחרת. החבילה המותקנת נבדקת כמקשה אחת.

## הפעלה ואימות

1. חלצו את חבילת התיקון לתיקיית האב שמכילה את `netunim/`, ואפשרו דריסה של הקבצים בעלי אותו נתיב. החבילה כוללת רק קבצים שהשתנו או נוספו; לא נדרש למחוק תיקיות.
2. מתוך `netunim/` הריצו `npm run pdfjs:check` ואת בדיקות Git הרגילות. אל תריצו התקנה לא־מאומתת מה־ZIP הכללי.
3. בנו ופרסמו את *שני* האתרים באמצעות תהליך השחרור הרגיל מתוך עותק Git אמיתי. גם אם PDF.js משותף, לכל אתר יש מניפסט ו־Service Worker משלו.
4. כשמעדכנים את Windows Document Bridge, השתמשו במתקין שלו מתוך הקוד החדש ובדקו אבחון תקינות PDF.js. פרסום האתרים לבדו אינו מעדכן רכיב Windows שכבר מותקן במחשב.
5. בדקו בדפדפן אמיתי: PDF רגיל וגדול, חיפוש והדגשה, PDF עם שדות עבריים, מסמך סרוק/תמונה, מסמך עם ICC/WASM, חילוץ חשבונית ופיצול עמודים. בצעו גם פתיחה לאחר רענון ועם Service Worker ישן לאחר עדכון.
6. אם נטפרי מחזיר 401/403/418/451 על קובץ PDF.js, בקשו פתיחה מפורשת מהספק למקור ולנתיב המדויקים; אל תשמרו תשובת חסימה במטמון ואל תחליפו Worker בגרסה אחרת.

## בדיקת CDN מול נטפרי — אופציה עתידית, לא חלק מהתיקון

Mozilla מציינת שימוש ב־jsDelivr, unpkg ו־cdnjs. ניתן לבדוק באופן ידני את הקבצים *בדיוק באותה גרסה*:

- `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.mjs`
- `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs`
- `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/web/pdf_viewer.mjs`
- `https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/wasm/qcms_bg.wasm`
- `https://unpkg.com/pdfjs-dist@6.5.438/build/pdf.mjs`
- `https://unpkg.com/pdfjs-dist@6.5.438/build/pdf.worker.min.mjs`

פתיחה מוצלחת של URL אינה מאשרת לבדה שכל הבקשות יעברו בנטפרי או שיעבדו CORS, Content Security Policy, Workers, קובצי CMap/גופנים/WASM, מצב Offline ו־Service Worker. כדי לעבור ל־CDN צריך להתאים במודע את מסלולי ה־imports, הרכיבים התומכים, מדיניות האבטחה ואימות הגרסה, ולוודא שכל המשאבים מאותו Build ושאין תלות חדשה בזמן פתיחה. עד שתאומת זמינות מלאה אצל המשתמשים וביצועים בשטח, הבחירה הבטוחה היא להישאר עם קובצי vendor המקומיים, עם טעינה עצלה ומטמון מאומת.

מקורות: https://github.com/mozilla/pdf.js/releases/tag/v6.5.438 ; https://mozilla.github.io/pdf.js/getting_started/ ; https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions
