import { WebClient } from '@slack/web-api';
import * as dotenv from 'dotenv';

dotenv.config();

// Initialize the Slack Web Client
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export const testConnection = async () => {
  try {
    const response = await slack.auth.test();
    console.log(`[testConnection] Success: Connected to workspace "${response.team}" with bot user ID "${response.bot_id}".`);
    return {
      ok: true,
      workspace: response.team,
      botId: response.bot_id
    };
  } catch (error) {
    console.error(`[testConnection] Error:`, error.message);
    return { ok: false, workspace: null, botId: null };
  }
};

export const getAllMembers = async () => {
  try {
    const response = await slack.users.list();
    if (!response.members) return [];

    return response.members
      .filter(user => !user.is_bot && !user.deleted && user.id !== 'USLACKBOT')
      .map(user => ({
        userId: user.id,
        name: user.name,
        realName: user.profile.real_name || user.name,
        displayName: user.profile.display_name || user.name,
        email: user.profile.email || null,
        profileImage: user.profile.image_192 || null
      }));
  } catch (error) {
    console.error(`[getAllMembers] Error:`, error.message);
    return [];
  }
};

export const getChannelMessages = async (channelId, daysBack = 30) => {
  try {
    if (!channelId) throw new Error("Channel ID is missing");

    let allMessages = [];
    let hasMore = true;
    let cursor = undefined;
    
    // Calculate timestamp for 'daysBack'
    const oldest = (Date.now() / 1000) - (daysBack * 24 * 60 * 60);

    while (hasMore) {
      const response = await slack.conversations.history({
        channel: channelId,
        oldest: oldest.toString(),
        cursor: cursor,
        limit: 100
      });

      if (response.messages) {
        // Filter out bot messages and events (like "user joined channel")
        const userMessages = response.messages.filter(msg => 
          !msg.bot_id && !msg.subtype
        );

        const formatted = userMessages.map(msg => ({
          userId: msg.user,
          text: msg.text,
          timestamp: msg.ts,
          threadTs: msg.thread_ts || null,
          reactions: msg.reactions ? msg.reactions.map(r => ({ name: r.name, count: r.count })) : []
        }));

        allMessages = allMessages.concat(formatted);
      }

      // Handle pagination
      if (response.response_metadata && response.response_metadata.next_cursor) {
        cursor = response.response_metadata.next_cursor;
      } else {
        hasMore = false;
      }
    }

    return allMessages;
  } catch (error) {
    console.error(`[getChannelMessages] Error for channel ${channelId}:`, error.message);
    return [];
  }
};

export const postMessageToChannel = async (channelId, text) => {
  try {
    const response = await slack.chat.postMessage({
      channel: channelId,
      text: text
    });
    return response.ok;
  } catch (error) {
    console.error(`[postMessageToChannel] Error:`, error.message);
    return false;
  }
};

export const getAllChannelData = async () => {
  try {
    const generalId = process.env.SLACK_GENERAL_CHANNEL_ID;
    const randomId = process.env.SLACK_RANDOM_CHANNEL_ID;

    // Fetch in parallel for speed
    const [generalMessages, randomMessages, members] = await Promise.all([
      generalId ? getChannelMessages(generalId) : Promise.resolve([]),
      randomId ? getChannelMessages(randomId) : Promise.resolve([]),
      getAllMembers()
    ]);

    // Helper to enrich messages
    const enrichMessages = (messages) => {
      return messages.map(msg => {
        const member = members.find(m => m.userId === msg.userId);
        return {
          ...msg,
          realName: member ? member.realName : "Unknown User"
        };
      });
    };

    const enrichedGeneral = enrichMessages(generalMessages);
    const enrichedRandom = enrichMessages(randomMessages);
    const allEnrichedMessages = [...enrichedGeneral, ...enrichedRandom];

    // Compute Summary analytics
    const totalMessages = allEnrichedMessages.length;
    const messagesByMember = {};
    
    allEnrichedMessages.forEach(msg => {
      messagesByMember[msg.realName] = (messagesByMember[msg.realName] || 0) + 1;
    });

    const mostActiveChannel = enrichedGeneral.length >= enrichedRandom.length ? '#general' : '#random';

    return {
      general: enrichedGeneral,
      random: enrichedRandom,
      members: members,
      summary: {
        totalMessages,
        messagesByMember,
        mostActiveChannel,
        fetchedAt: new Date().toISOString()
      }
    };
  } catch (error) {
    console.error(`[getAllChannelData] Error:`, error.message);
    return null;
  }
};
