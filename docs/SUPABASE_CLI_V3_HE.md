# Supabase CLI 3 — אימות ופריסה בטוחה לפרויקט netunim

עודכן: 2026-11-15. יש להריץ את הפקודות **מתיקיית השורש `netunim`** (התיקייה שבתוכה `supabase/migrations` ו־`verify.bat`).

## מה השתנה ב־CLI 3

* `--linked` / `--project-ref` בשימושי מסד הנתונים הוחלפו ב־`--remote` או `--remote=<project-ref>`; הדגלים הישנים מדפיסים אזהרות התיישנות.
* ללא `--remote`, הפקודות `db push`, `migration list` ו־`db query` פונות כברירת מחדל למסד המקומי. בפרויקט זה נוקבים במזהה השרת המיועד כדי שלא נסתמך על קישור ישן.
* שינוי בשרת דורש אישור. רק לאחר אימות תכנית הפריסה מוסיפים `--yes` כדי לאפשר הרצה ללא שאלה אינטראקטיבית. אין להוסיף `--yes` לבדיקה.
* בדיקת ה־postflight משתמשת ב־`db query --read-only` ובשאילתת `WITH ... SELECT` אחת. **אסור** לשלוח ל־CLI v3 את העטיפה הישנה `BEGIN READ ONLY; ... ROLLBACK;` יחד עם `--read-only`, מפני שהבודק של ה־CLI דוחה משפטים שמתחילים ב־`BEGIN`. במסלול `psql` יש עדיין עסקת קריאה בלבד מפורשת.

## לפני כל שינוי SQL בייצור

```powershell
# ממוקם בתיקיית השורש netunim
supabase --version
supabase migration list --workdir . --remote=bupoidcurcxuypfrjqio
supabase db push --dry-run --workdir . --remote=bupoidcurcxuypfrjqio
.\verify.bat --no-pause
```

יש לעצור אם הפלט כולל מיגרציה בלתי צפויה (ובייחוד גרסאות ישנות שאמורות להיות בשרת), אם יעד ה־CLI אינו הפרויקט הנכון, או אם אחת מבדיקות `verify.bat` נכשלת. רצוי לשמור את דו"ח הבדיקות שנמצא ב־`.work/verification/` ולקרוא את `results.json` והלוג של קבוצת הבדיקות שנכשלה. `verify.bat` אינו זקוק להפעלת `db push` מחדש כדי לבדוק קוד.

### רק אם יש מיגרציות חדשות שאושרו ועדיין ממתינות

```powershell
supabase db push --workdir . --remote=bupoidcurcxuypfrjqio --yes
supabase migration list --workdir . --remote=bupoidcurcxuypfrjqio
supabase db push --dry-run --workdir . --remote=bupoidcurcxuypfrjqio
python tools/supabase_deploy_gate.py
```

אם ה־dry-run ריק כי המיגרציות כבר נפרסו, **אין להריץ שוב `db push`**. יש לבדוק את השרת ישירות:

```powershell
supabase migration list --workdir . --remote=bupoidcurcxuypfrjqio
python tools/supabase_deploy_gate.py
```

`supabase_deploy_gate.py` אינו מבצע מיגרציות או עדכון קבצים. הוא דורש זהות פרויקט נכונה, היסטוריית מיגרציות ו־SQL זהים לקוד, מבנה סכימה תואם ומצב משימות `pg_cron` תקין. כאשר הקבלה השמורה ישנה, הוא גוזר בסביבת PostgreSQL מקומית זמנית את מצב הסכימה הצפוי — בלי לכתוב לייצור. הכנת המצב הזמני דורשת את כלי PostgreSQL של הפרויקט.

## מה אומרים כישלונות נפוצים

* `HostedMutationConsentRequiredError` — ניסיון לשנות שרת ללא `--yes`, או `db query` מרוחק ללא `--read-only`. **לא** מתקנים כשל בקריאת קטלוג על ידי הוספת `--yes`; מפעילים מצב קריאה בלבד.
* `target: local stack` — פקודה בלי `--remote` או נתיב שגוי; לעצור ולא לבצע פריסה.
* `repository database contract differs from the last authenticated Production receipt` — כשל של **שער הקבלה הישן / offline**; אחרי מיגרציות חדשות ייתכן שהוא צפוי גם כשהשרת מעודכן. אין לעשות `migration repair` בגללו; משתמשים בשער החי `python tools/supabase_deploy_gate.py` שמצליב מול השרת.
* `live Supabase catalog read failed` — שגיאת תקשורת/הרשאות/CLI בקריאה; היא **אינה** הוכחה שהמיגרציות נכשלו. יש לבדוק `supabase db query --help`, הזדהות (`supabase login`), ורשת.
* `unexplained application schema drift` או `server SQL differs` — חסם אמיתי לשחרור. צריך את דו"ח השוני/המיגרציות לפני תיקון כלשהו. לא מנרמלים או מתקנים את ההיסטוריה כדי לעקוף אותו.

## איסורים ובקרת סיכונים

לא להריץ `supabase db reset --remote`, `supabase migration repair`, `--include-seed`, או מיגרציות היסטוריות מחדש מול ייצור. גם כשמעדכנים את סביבת ה־CLI אין סיבה לבצע שינוי נתונים. השער החי לא מתקן drift אוטומטית; הוא נכשל כדי למנוע פרסום לא בטוח.

מסמכים רשמיים: https://supabase.com/docs/guides/local-development/cli/migrating-to-v3 וכן https://supabase.com/docs/reference/cli/introduction .
