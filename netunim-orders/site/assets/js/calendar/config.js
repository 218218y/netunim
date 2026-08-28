// Google Calendar browser OAuth configuration.
// The OAuth client ID is public by design. Never place a client secret in the site.
export const googleCalendarConfig=Object.freeze({
  clientId:'113139579639-jo09d2gts6kujig6rcaeid3bu40ojjqm.apps.googleusercontent.com',
  scope:'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  pollIntervalMs:60_000,
});
