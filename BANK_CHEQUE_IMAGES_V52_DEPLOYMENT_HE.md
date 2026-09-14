# פריסת תמונות שיקים לענן — Bank Bridge v52

השדרוג מוסיף שמירה זמנית ומוגבלת של תמונות חזית/גב של שיקים ב-Supabase Storage פרטי.
התמונה עצמה אינה נשמרת בתוך `bank_transactions`, מסמכי Kupa/Orders או גיבויי האפליקציה.
במסד נשמרים רק מפתחות SHA-256 קטנים בתוך פרטי השיק; קובץ התמונה נשמר ב-Storage ונמחק לאחר 60 יום.

המיגרציה הקנונית החדשה היא:
`supabase/migrations/20260914160000_bank_cheque_image_storage_v1.sql`

## 1. לפני פריסה

יש לשמור commit ולוודא שבדיקות GitHub של אותו commit עברו.
ב-PowerShell, מתיקיית המאגר הראשית:

```powershell
supabase --version
supabase migration list --linked --workdir .
supabase db push --linked --workdir . --dry-run
```

ב-dry-run יש לוודא שהמיגרציה `20260914160000_bank_cheque_image_storage_v1.sql` מופיעה כממתינה,
ושלא מופיעות במפתיע מיגרציות ישנות שכבר אמורות להיות בשרת.

## 2. החלת Supabase

לאחר dry-run תקין:

```powershell
supabase db push --linked --workdir .
supabase migration list --linked --workdir .
python tools/supabase_deploy_gate.py
```

המיגרציה יוצרת/מהדקת bucket בשם `bank-cheque-images`:
- Private.
- עד 5 MiB לקובץ.
- MIME של תמונות בלבד.
- RLS: משתמש מחובר יכול לקרוא, להעלות ולמחוק רק מתוך התיקייה שמתחילה ב-`auth.uid()` שלו.
- אין UPDATE policy; הקבצים immutable והעלאה חוזרת אינה דורסת קובץ קיים.

אין צורך ליצור ידנית bucket נוסף אם המיגרציה הצליחה, ואין להריץ את קובץ ה-upgrade גם ב-SQL Editor וגם דרך CLI.

## 3. Image Transformations

אין צורך להפעיל **Enable image transformation / Optimize and resize images on the fly**.
v52 מציג את קובץ התמונה המקורי מה-bucket הפרטי ואינו מבקש resize/transform.
אפשר להשאיר את האפשרות כבויה; הפעלתה אינה נדרשת לפיצ'ר הזה.

## 4. התקנת Bank Bridge v52

לאחר החלפת הקבצים במחשב שמבצע סנכרון בנק:

```powershell
.\netunim-kupa\bank-bridge\install_bank_bridge.bat
```

בדוק שה-health/status מדווח Bridge v52 לפני רענון הבנק.

## 5. פריסת שני האתרים

העלאת האתר נדרשת גם ל-Kupa וגם ל-Orders, כי שניהם מציגים את אותה תמונת שיק ושניהם משתמשים ב-Storage הפרטי.
השתמש בתהליך הפריסה הרגיל של המאגר, לדוגמה:

```powershell
.\deploy_all_fast.bat --preflight-only
.\deploy_all_fast.bat
```

## 6. בדיקה אחרי הפריסה

1. פתח את אחד האתרים והתחבר לענן כרגיל.
2. בצע רענון בנק חדש. רק שיקים שהפועלים מחזיר בחלון הסנכרון הנוכחי יכולים להיקלט בפעם הראשונה.
3. פתח פירוט של תנועת שיק מה-30 יום האחרונים. כאשר הבנק סיפק סריקה, אמורים להופיע כפתורי `חזית` ו/או `גב`.
4. לחיצה על הכפתור טוענת את התמונה רק אז; רשימת התנועות עצמה אינה מורידה את כל התמונות.
5. ב-Supabase Dashboard > Storage אמור להופיע bucket פרטי `bank-cheque-images` עם תיקייה לפי מזהה המשתמש וקבצים ששמם כולל תאריך ומפתח אטום.
6. אין לצפות ל-60 יום תמונות מיד ביום הראשון: הסנכרון הרגיל מביא כ-30 יום. עם הזמן נשמר חלון מתגלגל עד 60 יום.
7. לאחר שעוברות 60 יום, סנכרון בנק מאוחר יותר מוחק את קובץ התמונה דרך Storage API. תנועת הבנק ופרטי השיק עצמם נשארים בארכיון.

## 7. התנהגות כשל

כשל בהורדת תמונה מהפועלים, בהעלאה ל-Storage או בניקוי תמונה ישנה אינו מבטל את סנכרון היתרה/התנועות.
הסנכרון הפיננסי נשמר, והתקלה מדווחת כאזהרת תמונות בלבד.
