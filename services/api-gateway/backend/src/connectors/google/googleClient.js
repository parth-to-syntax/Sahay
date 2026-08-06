const { google } = require('googleapis');
const { HttpError } = require('../../shared/errors');

function getScopes() {
  const raw = process.env.GOOGLE_SCOPES;
  if (raw && String(raw).trim() !== '') {
    return String(raw)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ['https://www.googleapis.com/auth/calendar.readonly'];
}

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new HttpError(
      500,
      'Missing Google OAuth config. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.',
      'CONFIG_MISSING'
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

module.exports = {
  getScopes,
  getOAuth2Client
};
