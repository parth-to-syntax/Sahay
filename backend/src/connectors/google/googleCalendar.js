const { google } = require('googleapis');

function getCalendarApi(oauth2Client) {
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function listCalendars(oauth2Client, { maxResults = 50 } = {}) {
  const calendar = getCalendarApi(oauth2Client);
  const resp = await calendar.calendarList.list({ maxResults });
  return resp?.data;
}

async function listEvents(
  oauth2Client,
  {
    calendarId = 'primary',
    timeMin,
    timeMax,
    maxResults = 25,
    singleEvents = true,
    orderBy = 'startTime'
  } = {}
) {
  const calendar = getCalendarApi(oauth2Client);
  const resp = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    maxResults,
    singleEvents,
    orderBy,
    showDeleted: false,
    conferenceDataVersion: 1
  });
  return resp?.data;
}

module.exports = {
  listCalendars,
  listEvents
};
