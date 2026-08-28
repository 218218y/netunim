// Google Calendar uses a server-side OAuth authorization-code flow.
// The Google client secret and refresh tokens must never be placed in this public file.
export const googleCalendarConfig=Object.freeze({
  backendPath:'/functions/v1/google-calendar-oauth',
  pollIntervalMs:60_000,
});
