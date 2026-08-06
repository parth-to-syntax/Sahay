const { WebClient } = require('@slack/web-api');
const { HttpError } = require('../../shared/errors');

function getSlackToken() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token || String(token).trim() === '') {
    throw new HttpError(500, 'Missing SLACK_BOT_TOKEN', 'SLACK_MISSING_TOKEN');
  }
  return token;
}

function createClient() {
  const token = getSlackToken();
  return new WebClient(token, {
    // Keep timeouts conservative; Slack Web API is usually quick.
    timeout: 20000
  });
}

function mapSlackError(err) {
  // Slack SDK errors usually look like: err.data.error, err.code, err.statusCode
  const status = err?.statusCode || err?.data?.response_metadata?.status || 502;
  const slackCode = err?.data?.error || err?.code;
  const message = slackCode ? `Slack request failed (${slackCode})` : 'Slack request failed';
  throw new HttpError(status, message, slackCode || 'SLACK_ERROR');
}

async function authTest() {
  const client = createClient();
  try {
    return await client.auth.test();
  } catch (err) {
    mapSlackError(err);
  }
}

async function conversationsInfo(channel) {
  const client = createClient();
  try {
    return await client.conversations.info({ channel });
  } catch (err) {
    mapSlackError(err);
  }
}

async function conversationsList({ types, limit, cursor } = {}) {
  const client = createClient();
  try {
    return await client.conversations.list({
      types,
      limit,
      cursor
    });
  } catch (err) {
    mapSlackError(err);
  }
}

async function conversationsHistory(channel, { limit, cursor, inclusive, oldest, latest } = {}) {
  const client = createClient();
  try {
    return await client.conversations.history({
      channel,
      limit,
      cursor,
      inclusive,
      oldest,
      latest
    });
  } catch (err) {
    mapSlackError(err);
  }
}

async function conversationsReplies(channel, thread_ts, { limit, cursor, inclusive, oldest, latest } = {}) {
  const client = createClient();
  try {
    return await client.conversations.replies({
      channel,
      ts: thread_ts,
      limit,
      cursor,
      inclusive,
      oldest,
      latest
    });
  } catch (err) {
    mapSlackError(err);
  }
}

async function usersList({ limit, cursor } = {}) {
  const client = createClient();
  try {
    return await client.users.list({ limit, cursor });
  } catch (err) {
    mapSlackError(err);
  }
}

module.exports = {
  authTest,
  conversationsInfo,
  conversationsList,
  conversationsHistory,
  conversationsReplies,
  usersList
};
