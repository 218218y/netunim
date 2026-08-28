// Google Calendar browser OAuth configuration.
// The OAuth client ID is public by design. Never place a client secret in the site.
export const googleCalendarConfig=Object.freeze({
  clientId:'17502892712-mdkjtg3tgfh5bbbjio4lo9tbsadg95mc.apps.googleusercontent.com',
  scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  pollIntervalMs:60_000,
});
