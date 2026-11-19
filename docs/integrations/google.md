# Google Calendar and Drive

Orders uses two Edge functions, [google-calendar-oauth](../../netunim-orders/supabase/functions/google-calendar-oauth) and [google-drive-oauth](../../netunim-orders/supabase/functions/google-drive-oauth). Calendar is the authoritative source for calendar records. Drive provides read-only search and opening of Drive documents, with the local Windows path documented under [Document search and preview](document-search.md).

## Set up an environment

1. Bring the target database through the [Supabase release flow](../operations/supabase.md) so its OAuth tables, intent RPCs and security policies match the Edge code.
2. Enable the corresponding APIs in Google Cloud and configure OAuth web clients. Register the exact callbacks `https://<project-ref>.supabase.co/functions/v1/google-calendar-oauth/callback` and `https://<project-ref>.supabase.co/functions/v1/google-drive-oauth/callback` for the services the client owns.
3. Set `GOOGLE_CALENDAR_CLIENT_ID` and `GOOGLE_CALENDAR_CLIENT_SECRET`, and optionally separate `GOOGLE_DRIVE_CLIENT_ID` and `GOOGLE_DRIVE_CLIENT_SECRET`. Drive can fall back to Calendar's credentials when it uses the same registered client. Register staging clients separately from Production.
4. Configure the server-side vault with `GOOGLE_OAUTH_TOKEN_KEYS` and `GOOGLE_OAUTH_TOKEN_ACTIVE_KEY`. Keep old keys available for existing ciphertext during managed rotation. The credential audience binds ciphertext to the Supabase URL, so a move to a different project needs a reviewed credential migration or reconnection. Set `GOOGLE_OAUTH_ALLOWED_ORIGINS` when the intended site is outside the defaults.
5. Deploy the corresponding functions with the reviewed Edge settings. Sign in with application MFA, then connect each provider from the Orders settings. Confirm the consent and test Calendar list/read/write or Drive search/open, as applicable.

Calendar requires `calendar.events` and `calendar.calendarlist.readonly`. Drive requires `drive.readonly`. Callback and refresh validate the actual scopes. Scope changes can require new consent. Renewed access tokens stay in memory and refresh credentials stay server-side.

Drive uses `files.get` with `alt=media` for direct preview of uploaded files and
`files.export` for supported Google Workspace documents. When a preview cannot
be opened, check the file's Drive access and the granted scope before reconnecting.

The start, disconnect and token operations fence by captured user and grant generation. The callback uses a stored one-time intent. A late browser callback or refresh cannot replace a newer login or republish a disconnected integration. Use application Settings to reconnect after revoked consent. Keep project-wide provider revocation distinct from disconnecting a single feature.
