import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const dbName = process.env.MONGO_DB || "chro_intelligence";

if (!mongoUri) {
  throw new Error("Missing MONGO_URI in llm/.env");
}

const payloadPath = path.join(process.cwd(), "mock_data", "meeting_transcript.json");
const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
const meetings = Array.isArray(payload?.meetings) ? payload.meetings : [];

const client = new MongoClient(mongoUri);
await client.connect();

const db = client.db(dbName);
const collection = db.collection("meetings");
let updatedMeetings = 0;

for (const meeting of meetings) {
  const brief = meeting.meeting_brief || {};
  const transcript = Array.isArray(meeting.transcript) ? meeting.transcript : [];

  const doc = {
    meetingId: meeting.meetingId,
    employeeEmail: String(meeting.employeeEmail || "").toLowerCase(),
    title: brief.previous_meeting || "HR Check-in",
    meetingAt: brief.date || new Date().toISOString().slice(0, 10),
    participants: Array.isArray(brief.attendees)
      ? brief.attendees.map((item) => ({
          name: item?.name || "Unknown",
          role: item?.role || "Unknown",
        }))
      : [],
    summary: Array.isArray(brief.key_takeaways)
      ? brief.key_takeaways.join(" ")
      : String(brief.meeting_objective || ""),
    transcript,
    transcriptLines: transcript.map((line) =>
      `${line?.speaker || "Participant"}: ${line?.text || line?.message || ""}`
    ),
    updatedAt: new Date().toISOString(),
  };

  await collection.updateOne(
    { meetingId: doc.meetingId },
    {
      $set: doc,
      $setOnInsert: { createdAt: new Date().toISOString() },
    },
    { upsert: true }
  );

  // Also normalize any legacy same-date records for this employee.
  await collection.updateMany(
    {
      employeeEmail: doc.employeeEmail,
      meetingAt: doc.meetingAt,
    },
    {
      $set: {
        title: doc.title,
        participants: doc.participants,
        summary: doc.summary,
        transcript: doc.transcript,
        transcriptLines: doc.transcriptLines,
        updatedAt: doc.updatedAt,
      },
    }
  );

  updatedMeetings += 1;
}

await client.close();

console.log(JSON.stringify({ updatedMeetings, dbName }, null, 2));
