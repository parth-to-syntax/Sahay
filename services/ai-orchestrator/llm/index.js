import fs from 'fs/promises';
import { testConnection, getAllChannelData } from './slackService.js';

const main = async () => {
  console.log("Starting Slack HR Intelligence Data Extraction...\n");

  // 1. Test Connection
  const auth = await testConnection();
  if (!auth.ok) {
    console.error("\n❌ STOPPING: Slack Authentication Failed!");
    console.error("👉 Check your SLACK_BOT_TOKEN in the .env file.");
    return;
  }

  console.log("\nFetching workspace data (members and messages)...");
  
  // 2. Extract Data
  const data = await getAllChannelData();
  
  if (!data) {
    console.error("Failed to retrieve channel data.");
    return;
  }

  // Calculate Most Active Member
  let mostActiveMember = "None";
  let maxCount = 0;
  
  if (data.summary && data.summary.messagesByMember) {
    Object.entries(data.summary.messagesByMember).forEach(([name, count]) => {
      if (count > maxCount) {
        maxCount = count;
        mostActiveMember = name;
      }
    });
  }

  // 3. Print Readable Summary
  console.log("\n==================================");
  console.log(`Workspace: ${auth.workspace}`);
  console.log(`Members found: ${data.members.length}`);
  console.log(`Messages from #general: ${data.general.length}`);
  console.log(`Messages from #random: ${data.random.length}`);
  console.log(`Most active member: ${mostActiveMember} (${maxCount} messages)`);
  console.log("==================================\n");

  // 4. Save to JSON File
  await fs.writeFile('slack_data.json', JSON.stringify(data, null, 2), 'utf-8');
  console.log("✅ Data saved to slack_data.json");
};

main();

/* ============================================================================
   TROUBLESHOOTING GUIDE

   - "not_in_channel" error: 
     SOLUTION: You missed Step 5! The bot is not in the channel. 
     Go to the channel in Slack, type `/invite @HR Intelligence Bot` and hit Enter.

   - "missing_scope" error:
     SOLUTION: You are trying to use an API feature but didn't grant the bot permission.
     Go back to api.slack.com > your app > OAuth & Permissions. Double check you added
     all scopes from Step 2. If you add scopes after installing the app, Slack will prompt 
     you to "Reinstall to Workspace". Click that button!

   - "invalid_auth" error:
     SOLUTION: Your SLACK_BOT_TOKEN is wrong. Ensure it starts with "xoxb-", that 
     there are no extra spaces in your .env file, and that the dotenv package is 
     successfully loading it.

   - "channel_not_found" error:
     SOLUTION: The channel ID in your .env is incorrect. Double check the browser URL 
     step. Note that channel IDs are case-sensitive and begin with 'C'. Ensure the 
     channel hasn't been deleted or achieved.
   ============================================================================ */
