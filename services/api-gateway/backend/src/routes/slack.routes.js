const express = require('express');

const {
  authTest,
  conversationsInfo,
  conversationsList,
  conversationsHistory,
  conversationsReplies,
  usersList
} = require('../connectors/slack/slackClient');

const router = express.Router();

function asInt(value, fallback) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : fallback;
}

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

router.get('/auth/test', async (_req, res, next) => {
  try {
    const data = await authTest();
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/list', async (req, res, next) => {
  try {
    const limit = asInt(req.query.limit, 100);
    const types = req.query.types ? String(req.query.types) : 'public_channel,private_channel';
    const data = await conversationsList({ types, limit });

    const channels = Array.isArray(data?.channels) ? data.channels : [];
    const summary = {
      channelCount: channels.length,
      sample: channels.slice(0, 10).map((c) => ({
        id: c?.id,
        name: c?.name,
        is_member: c?.is_member,
        is_private: c?.is_private,
        num_members: c?.num_members
      }))
    };

    res.json({ ok: true, data: { summary } });
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:channelId/info', async (req, res, next) => {
  try {
    const channel = req.params.channelId;
    const data = await conversationsInfo(channel);

    // Return a safe subset of channel info.
    const c = data?.channel;
    res.json({
      ok: true,
      data: {
        id: c?.id,
        name: c?.name,
        is_channel: c?.is_channel,
        is_group: c?.is_group,
        is_im: c?.is_im,
        is_private: c?.is_private,
        is_member: c?.is_member,
        is_archived: c?.is_archived,
        created: c?.created,
        num_members: c?.num_members,
        topic: c?.topic?.value,
        purpose: c?.purpose?.value
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:channelId/history', async (req, res, next) => {
  try {
    const channel = req.params.channelId;
    const limit = asInt(req.query.limit, 25);
    const oldest = req.query.oldest ? String(req.query.oldest) : undefined;
    const latest = req.query.latest ? String(req.query.latest) : undefined;

    const data = await conversationsHistory(channel, { limit, oldest, latest });
    const messages = Array.isArray(data?.messages) ? data.messages : [];

    res.json({
      ok: true,
      data: {
        channel,
        messageCount: messages.length,
        hasMore: Boolean(data?.has_more),
        messages: messages.map(messageSummary)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:channelId/replies', async (req, res, next) => {
  try {
    const channel = req.params.channelId;
    const ts = req.query.ts ? String(req.query.ts) : null;
    if (!ts) {
      res.status(400).json({ ok: false, error: { message: 'Missing required query param: ts', code: 'BAD_REQUEST' } });
      return;
    }

    const limit = asInt(req.query.limit, 25);
    const data = await conversationsReplies(channel, ts, { limit });
    const messages = Array.isArray(data?.messages) ? data.messages : [];

    res.json({
      ok: true,
      data: {
        channel,
        thread_ts: ts,
        messageCount: messages.length,
        messages: messages.map(messageSummary)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/users/list', async (req, res, next) => {
  try {
    const limit = asInt(req.query.limit, 200);
    const data = await usersList({ limit });

    const members = Array.isArray(data?.members) ? data.members : [];
    const bots = members.filter((m) => Boolean(m?.is_bot)).length;
    const deleted = members.filter((m) => Boolean(m?.deleted)).length;
    const restricted = members.filter((m) => Boolean(m?.is_restricted) || Boolean(m?.is_ultra_restricted)).length;

    res.json({
      ok: true,
      data: {
        totalReturned: members.length,
        counts: { bots, deleted, restricted },
        sampleUserIds: members.slice(0, 20).map((m) => m?.id).filter(Boolean)
      }
    });
  } catch (err) {
    next(err);
  }
});

router.get('/probe', async (_req, res, next) => {
  // Uses SLACK_GENERAL_CHANNEL_ID / SLACK_RANDOM_CHANNEL_ID if present.
  try {
    const general = process.env.SLACK_GENERAL_CHANNEL_ID;
    const random = process.env.SLACK_RANDOM_CHANNEL_ID;

    const auth = await authTest();

    const channelsToProbe = [general, random].filter((v) => v && String(v).trim() !== '');

    const channels = [];
    for (const channelId of channelsToProbe) {
      // eslint-disable-next-line no-await-in-loop
      const info = await conversationsInfo(channelId);
      // eslint-disable-next-line no-await-in-loop
      const history = await conversationsHistory(channelId, { limit: 25 });

      const msgs = Array.isArray(history?.messages) ? history.messages : [];

      channels.push({
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
          messages: msgs.map(messageSummary)
        }
      });
    }

    res.json({
      ok: true,
      data: {
        fetchedAt: new Date().toISOString(),
        auth: {
          team: auth?.team,
          team_id: auth?.team_id,
          user: auth?.user,
          user_id: auth?.user_id,
          bot_id: auth?.bot_id
        },
        probedChannels: channels
      }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
