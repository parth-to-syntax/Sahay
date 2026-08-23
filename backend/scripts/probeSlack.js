// Probe Slack API capabilities (shape/counts only; no message text).
// Usage:
//   node scripts/probeSlack.js
//
// Requires:
//   SLACK_BOT_TOKEN
// Optional:
//   SLACK_GENERAL_CHANNEL_ID
//   SLACK_RANDOM_CHANNEL_ID

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  authTest,
  conversationsInfo,
  conversationsHistory,
  usersList
} = require('../src/connectors/slack/slackClient');

function messageSummary(m) {
  const text = typeof m?.text === 'string' ? m.text : '';
  return {
    ts: m?.ts,
    user: m?.user,
    bot_id: m?.bot_id,
    subtype: m?.subtype,
    thread_ts: m?.thread_ts,
    reply_count: m?.reply_count,
    reply_users_count: m?.reply_users_count,
    hasBlocks: Array.isArray(m?.blocks) && m.blocks.length > 0,
    hasFiles: Array.isArray(m?.files) && m.files.length > 0,
    fileCount: Array.isArray(m?.files) ? m.files.length : 0,
    textLen: text.length
  };
}

(async () => {
  try {
    const auth = await authTest();

    const general = process.env.SLACK_GENERAL_CHANNEL_ID;
    const random = process.env.SLACK_RANDOM_CHANNEL_ID;
    const channelsToProbe = [general, random].filter((v) => v && String(v).trim() !== '');

    const channelReports = [];
    for (const channelId of channelsToProbe) {
      // eslint-disable-next-line no-await-in-loop
      const info = await conversationsInfo(channelId);
      // eslint-disable-next-line no-await-in-loop
      const history = await conversationsHistory(channelId, { limit: 25 });

      const msgs = Array.isArray(history?.messages) ? history.messages : [];

      channelReports.push({
        channelId,
        info: {
          id: info?.channel?.id,
          name: info?.channel?.name,
          is_private: info?.channel?.is_private,
          is_member: info?.channel?.is_member,
          num_members: info?.channel?.num_members
        },
        history: {
          messageCount: msgs.length,
          hasMore: Boolean(history?.has_more),
          sample: msgs.map(messageSummary)
        }
      });
    }

    const users = await usersList({ limit: 200 });
    const members = Array.isArray(users?.members) ? users.members : [];

    const report = {
      fetchedAt: new Date().toISOString(),
      auth: {
        team: auth?.team,
        team_id: auth?.team_id,
        user: auth?.user,
        user_id: auth?.user_id,
        bot_id: auth?.bot_id
      },
      users: {
        totalReturned: members.length,
        counts: {
          bots: members.filter((m) => Boolean(m?.is_bot)).length,
          deleted: members.filter((m) => Boolean(m?.deleted)).length,
          restricted: members.filter((m) => Boolean(m?.is_restricted) || Boolean(m?.is_ultra_restricted)).length
        },
        sampleUserIds: members.slice(0, 20).map((m) => m?.id).filter(Boolean)
      },
      channels: channelReports
    };

    console.log(JSON.stringify({ ok: true, data: report }, null, 2));
  } catch (err) {
    console.error(err?.message || err);
    process.exit(1);
  }
})();
