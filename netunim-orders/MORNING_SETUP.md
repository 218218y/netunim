# Morning / חשבונית ירוקה — הגדרה ופריסה

החיבור משתמש ב-**Edge Function אחת בלבד** בשם `morning-documents`.

`MORNING_CLIENT_ID`, `MORNING_CLIENT_SECRET` ו-`MORNING_ENV` **אינם שלוש פונקציות**. אלה משתני סביבה שהפונקציה היחידה קוראת בזמן ריצה:

| משתנה | משמעות | חובה |
|---|---|---|
| `MORNING_CLIENT_ID` | מזהה ה-API Key / OAuth Client ID של Morning | כן |
| `MORNING_CLIENT_SECRET` | הסיסמה הסודית / OAuth Client Secret של Morning | כן |
| `MORNING_ENV` | סביבת Morning: `production` או `sandbox` | לא; ברירת המחדל היא `production` |

ה-PWA לעולם אינו מקבל את ה-Client Secret. גם את ה-Client ID אין צורך לשים בקבצי האתר. שניהם נשמרים בצד השרת ב-Supabase.

> חשוב: ל-Sandbox ול-Production יש credentials נפרדים. שינוי `MORNING_ENV` ל-`sandbox` אינו הופך מפתחות Production למפתחות Sandbox ולהפך.

## 1. עדכון מסד הנתונים

ב-Supabase Dashboard פתח **SQL Editor**, הדבק והריץ את:

`netunim-orders/supabase/morning_documents.sql`

הקובץ בטוח להרצה חוזרת. אם הטבלה כבר קיימת, הוא מוסיף במידת הצורך את שדות המטא-דאטה החדשים, כולל `allocation_number` ו-`allocation_checked_at`.

הטבלה `morning_document_operations` היא ledger קטן בלבד לצורכי idempotency, מניעת כפילויות וקישור למסמך. PDF ותוכן המסמך המלא נשארים ב-Morning.

## 2. הגדרת משתני Morning ב-Supabase

### דרך ה-Dashboard

בפרויקט Supabase פתח את אזור **Edge Function Secrets** והוסף:

```text
MORNING_CLIENT_ID=<מזהה ה-API-Key שלך>
MORNING_CLIENT_SECRET=<הסיסמה הסודית של ה-API-Key>
MORNING_ENV=production
```

ב-Production אפשר גם לא להגדיר `MORNING_ENV`; הקוד משתמש ב-`production` כברירת מחדל. מומלץ בכל זאת להגדיר אותו במפורש כדי שהסביבה תהיה ברורה.

### דרך Supabase CLI

מתיקיית `netunim-orders`:

```bash
supabase login
supabase projects list
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set MORNING_CLIENT_ID="YOUR_CLIENT_ID" MORNING_CLIENT_SECRET="YOUR_CLIENT_SECRET" MORNING_ENV="production"
supabase secrets list
```

שינוי Secrets ב-Supabase נכנס לתוקף עבור Edge Functions בלי צורך בפריסה מחדש של הקוד. לעומת זאת, לאחר שינוי `index.ts` כן צריך לפרוס את הפונקציה מחדש.

## 3. פריסת Edge Function

עדיין מתוך `netunim-orders`:

```bash
supabase functions deploy morning-documents --use-api
```

אפשר גם בלי `--use-api`:

```bash
supabase functions deploy morning-documents
```

זו הפונקציה היחידה שנוספה עבור Morning:

`netunim-orders/supabase/functions/morning-documents/index.ts`

הפונקציה דורשת משתמש מחובר ל-Supabase ומבצעת גם אימות משתמש פנימי לפני כל פעולה. אין endpoint אנונימי שמאפשר להפיק מסמך.

## 4. מספרי הקצאה — חשבוניות ישראל

האתר **לא פונה ישירות לרשות המסים** לקבלת מספר הקצאה. Morning מטפלת בבקשת ההקצאה כחלק ממערכת החשבוניות שלה כאשר:

- קיימת ב-Morning הרשאה פעילה לחיבור לרשות המסים.
- מדובר בסוג מסמך מתאים, כגון חשבונית מס / חשבונית מס-קבלה.
- מולאו פרטי הלקוח הנדרשים, ובפרט מספר העוסק / ח.פ. כאשר מדובר בלקוח עסקי.
- המסמך עומד בתנאי מודל חשבוניות ישראל.

נכון ל-1 ביוני 2026, התקרה הרלוונטית לפי רשות המסים היא עסקה שסכומה **מעל 5,000 ₪ לפני מע"מ**, בכפוף לשאר התנאים שבדין.

לאחר הפקה, ה-Edge Function קוראת שוב את המסמך הרשמי מ-Morning ושומרת רק את `allocationNumber` אם התקבל. במסך החוב יוצג מספר ההקצאה לצד המסמך. אם המספר נוסף ב-Morning מאוחר יותר או התבקש שם ידנית, הכפתור **„בדוק שוב”** מרענן אותו מהמסמך הרשמי.

אם חשבונית שדורשת הקצאה מוצגת ללא מספר:

1. בדוק שב-Morning החיבור לרשות המסים פעיל.
2. בדוק שמספר העוסק / ח.פ. של הלקוח הוזן במסמך.
3. אם Morning לא קיבלה את המספר אוטומטית, ניתן לבקש אותו מתוך Morning ולאחר מכן ללחוץ באתר „בדוק שוב”.

אין להוסיף לקוד API Key נוסף של רשות המסים לצורך הזרימה הזו.

## 5. בדיקה בטוחה לפני Production

אם יש לך credentials של Morning Sandbox, הגדר את **מפתחות ה-Sandbox** ואת:

```text
MORNING_ENV=sandbox
```

לאחר מכן:

1. פתח `לקוחות > חובות`.
2. לחץ על אייקון המסמך בשורת החוב.
3. ודא שבשורת החיבור מופיע `Morning Sandbox`.
4. בחר סוג מסמך וודא שכל הפרטים נכונים.
5. לחץ **„תצוגה מקדימה”**. Preview אינו מפיק מסמך רשמי.
6. רק לאחר בדיקה לחץ **„הפק מסמך רשמי”** ואשר.

לפני מעבר ל-Production החלף לזוג credentials של Production והגדר `MORNING_ENV=production`.

## 6. מה נשמר באתר ומה נשאר ב-Morning

באתר נשמרים רק פרטי קישור קטנים: מזהה פעולה, מזהה/מספר מסמך, סוג, סכום, תאריך, URL אם קיים, מספר הקצאה אם התקבל ומצב reconciliation.

לא נשמרים אצלך PDF-ים של החשבוניות ולא ארכיון מלא של Morning. המסמך הרשמי ומקור האמת נשארים ב-Morning.

## 7. התנהגות במקרי תקלה

- אין retry אוטומטי ל-POST שמפיק מסמך.
- כל ניסיון מקבל `operation_id` ונרשם ב-DB לפני הפנייה ל-Morning.
- ניתוק או 5xx לאחר השליחה מסומן `needs_reconciliation`; הפקה חדשה לאותו חוב נחסמת עד בירור.
- reconciliation מחפש מועמדים ואז קורא את המסמך המלא מ-Morning לפני שיוך.
- אם Morning כבר יצרה מסמך אבל קריאת ה-read-back או שמירת המטא-דאטה ב-Supabase נכשלה, הצלחת ההפקה אינה נהפכת לכישלון ואינה גורמת ל-POST נוסף.
- `MORNING_ENV` מקבל רק `production` או `sandbox`; ערך שגוי חוסם הפקה במקום ליפול בשקט ל-Production.
