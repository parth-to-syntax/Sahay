# IntelliHR — Schema (Storage Contract)

This is the single **source-of-truth** schema doc for the MVP.

It defines:
- **What we fetch** from each upstream system (endpoints + key fields)
- **What we store** in MongoDB (collections + key fields + indexes)
- **How we map** upstream payloads → our generic `documents` model

---

## 0) Global conventions

### 0.1 Scoping
- Every stored record includes `orgId`.

For MVP, `orgId` is resolved as:
- request header `x-org-id`, else
- query `?orgId=...`, else
- `DEFAULT_ORG_ID` env var, else
- `demo`

### 0.2 Document identity
We store ingested artifacts in `documents` with:
- `documentType` (what it is)
- `sourceSystem` (where it came from)
- `externalId` (upstream stable id when available)

Recommended `externalId` conventions:
- Slack message: `<team_id>:<channel_id>:<ts>`
- Google Calendar event: `google_calendar:<calendarId>:<event.id>`
- BambooHR snapshot: `bamboohr:employees:directory:<snapshotAtISO>`
- BambooHR employee profile: `bamboohr:employee:<employeeId>:<snapshotAtISO>`
- Slack users snapshot: `slack:users:list:<snapshotAtISO>`

### 0.3 PII & probes
- Probe endpoints should return **safe summaries** (no message bodies, minimal email exposure).
- Storage can keep `documents.raw` as full upstream JSON (MVP-friendly), while retrieval respects permissions.

---

## 1) BambooHR (read-only)

### 1.1 Endpoints used
- `GET /v1/employees/directory`
- `GET /v1/meta/fields`
- `GET /v1/employees/{id}` (optional `fields` query)

### 1.2 `GET /v1/employees/directory` key fields
Observed shape:
- top-level: `fields[]`, `employees[]`
- `employees[]` (observed):
  - `id`
  - `displayName`, `firstName`, `lastName`, `preferredName`
  - `jobTitle`, `department`, `location`, `division`
  - `workEmail`, `workPhone`, `mobilePhone`, `workPhoneExtension`
  - `supervisor` (manager **name string**, not id)
  - `photoUploaded`, `photoUrl`

Storage mapping:
- Create/update `employees` records (canonical employee list)
- Create/update `external_identities` with `sourceSystem=bamboohr`, `externalUserId=<employee.id>`
- Store the raw directory response as a `documents` record (`documentType=hrms_snapshot`, `sourceSystem=bamboohr`)

### 1.3 `GET /v1/meta/fields` key fields
Observed shape:
- array of field definitions
- sometimes includes `alias`

Storage mapping:
- Typically used as a read-time schema probe (`GET /api/bamboohr/meta/fields`, `/api/bamboohr/schema/compare`).
- If persisted, store as a `documents` record (`documentType=hrms_snapshot`, `sourceSystem=bamboohr`) via the generic ingest endpoint.

---

## 2) Slack (Slack Web API)

Important: probe routes return safe summaries; `documents.raw` can store full payloads.

### 2.1 `auth.test`
Used for connectivity + token identity.
- fields: `team`, `team_id`, `user`, `user_id`, `bot_id`

### 2.2 `users.list`
Key fields to store:
- `members[].id`
- flags: `deleted`, `is_bot`, `is_restricted`, `is_ultra_restricted`
- `members[].profile.email` (critical for HRMS join when present)
- display: `real_name`, `profile.display_name`

Storage mapping:
- For each Slack member (non-bot), create/update `external_identities`:
  - `sourceSystem=slack`
  - `externalUserId=<member.id>`
  - `email=<profile.email>` when present

Note: `external_identities.employeeId` is optional (unlinked Slack users can still be stored).

### 2.3 `conversations.list` / `conversations.info`
Used for channel discovery + metadata.

### 2.4 `conversations.history` / `conversations.replies`
Key fields per message:
- ids: `ts`, optional `thread_ts`
- actor: `user`, optional `bot_id`, `subtype`
- content: `text`, `blocks[]`, `files[]`
- thread engagement: `reply_count`, `reply_users_count`

Storage mapping (recommended):
- Not implemented as an ingest route yet (MVP roadmap).
- Store each message as a `documents` row:
  - `documentType=slack_message`
  - `sourceSystem=slack_api`
  - `externalId=<team_id>:<channel_id>:<ts>`
  - `content=<text>` (optional)
  - `metadata={ channel_id, thread_ts, subtype, reply_count, file_count, ... }`
  - `raw=<full Slack message payload>`
- Create `document_participants` entries for:
  - author (`message.user` → `external_identities(slack)` → employee)
  - optionally: mentioned users / thread participants later

---

## 3) Google Calendar (HR calendar first)

### 3.1 Endpoints used
- `calendarList.list`
- `events.list`

### 3.2 `events.list` key fields (expected)
We will store the upstream event object in `documents.raw`. Common fields include:
- ids: `id`, `status`, `eventType`, `created`, `updated`
- content: `summary`, `description`, `location`
- time: `start`, `end`
- people: `organizer`, `creator`, `attendees[]`
- conferencing: `hangoutLink`, `conferenceData.*`
- recurrence: `recurrence[]`, `recurringEventId`

Storage mapping (recommended):
- Store each event as a `documents` row:
  - `documentType=calendar_event`
  - `sourceSystem=google_calendar`
  - `externalId=google_calendar:<calendarId>:<event.id>`
  - `content=<summary>` (optional)
  - `metadata={ start, end, organizerEmail, attendeeCount, hasConference, ... }`
  - `raw=<full event payload>`
- Create `document_participants` by matching attendee emails to `employees.workEmail`.

Derived storage (MVP):
- Daily rollups in `calendar_metrics_daily` keyed by `(orgId, employeeId, day)`.

---

## 4) MongoDB (Mongoose) — collections implemented

### 4.1 Environment
- `MONGODB_URI` (preferred) or `MONGO_URI` (supported alias)
  - example: `mongodb://localhost:27017/intellihr`
- `DEFAULT_ORG_ID` (optional; defaults to `demo`)

Behavior:
- If `MONGODB_URI` is not set, the server still starts (DB disabled).
- Health endpoint: `GET /api/db/health`

### 4.2 Collections

#### `organizations`
- `orgId` (unique), `name`, `createdAt`

#### `employees`
- `orgId`
- `employeeId` (unique within org)
- `workEmail` (unique within org when present)
- `fullName`, `status`
- optional: `bamboohrEmployeeId`

Indexes:
- unique `(orgId, employeeId)`
- unique partial `(orgId, workEmail)`

#### `external_identities`
- `orgId`, optional `employeeId`
- `sourceSystem`: `slack | bamboohr | google_calendar`
- `externalUserId`
- optional: `email`, `displayName`
- optional match: `matchMethod`, `matchConfidence`

Indexes:
- unique `(orgId, sourceSystem, externalUserId)`

#### `documents`
- `orgId`
- `documentType`: `hrms_snapshot | hrms_profile | slack_message | slack_user_snapshot | slack_channel_snapshot | email_message | calendar_event | calendar_snapshot | transcript | meeting_notes | survey_response | spreadsheet | zoom_recording_audio`
- `sourceSystem`
- optional: `externalId`
- optional: `sourceUri`
- optional: `contentHash`
- `ingestedAt`, `sensitivity`
- `content`, `metadata`, `raw`

Indexes:
- unique sparse `(orgId, sourceSystem, externalId)`
- `(orgId, documentType, ingestedAt desc)`
- `(orgId, contentHash)`

#### `document_participants`
- `orgId`
- `documentId` (ObjectId)
- `employeeId` (string)
- `matchMethod`, `matchConfidence`

Indexes:
- unique `(orgId, documentId, employeeId)`

#### `memory_events`
- `orgId`, `employeeId`
- `eventType`, `eventTime`
- `summary`, `payload`
- optional provenance: `sourceDocumentId` (ObjectId), `sourceChunkId` (string), `sourceExcerpt` (string)
- scoring: `confidence` (0..1)
- `sensitivity`: `standard | sensitive`

Indexes:
- `(orgId, employeeId, eventTime desc)`

#### Time-series HRMS domain snapshots (preferred)
All HRMS domain snapshots follow the pattern:
- keys: `orgId`, `employeeId`, `asOf`, `sourceSystem`
- refs: optional `sourceDocumentId`
- body: normalized fields + `data` (full raw object)
- `createdAt`

Collections:
- `hrms_identity_snapshots`
- `hrms_employment_snapshots`
- `hrms_compensation_snapshots`
- `hrms_performance_snapshots`
- `hrms_attendance_leave_snapshots`
- `hrms_tenure_mobility_snapshots`
- `hrms_offboarding_snapshots`

Indexes (each collection):
- `(orgId, employeeId, asOf desc)`
- unique `(orgId, employeeId, asOf, sourceSystem)`

#### `document_chunks`
Used for transcript/email chunking + embedding pointers.
- keys: `orgId`, `documentId`, `chunkIndex`
- body: `text`, optional `employeeId`, optional `tokenCount`
- optional timing (`startMs`, `endMs`), optional `embeddingVectorId`
- `sensitivity`: `standard | sensitive`

Index:
- unique `(orgId, documentId, chunkIndex)`

#### `calendar_metrics_daily`
Daily rollups (UTC day) computed from ingested Google Calendar events.
- unique `(orgId, employeeId, day)`
- fields: `meetingCount`, `meetingMinutes`, `afterHoursMeetingCount`, `backToBackCount`, `declinedCount`
- timestamps: `createdAt`, `updatedAt`

#### `survey_responses`
Survey / feedback artifacts (raw + normalized fields).
- `orgId`, optional `employeeId`
- `respondedAt`, `surveyType`, optional `category`
- optional: `score`, `comment`
- optional: `sourceSystem`, `sourceDocumentId`, `raw`

#### `audit_logs`
Write-once security/audit trail (who did what, when).
- `orgId`
- optional: `actor`
- `action`
- optional: `targetType`, `targetId`
- optional: `metadata`
- `createdAt`

#### `ingestion_cursors`
Tracks per-org ingestion checkpoints ("last successful run") so reruns can be incremental.
- key: `(orgId, sourceSystem, jobName, scope)`
- fields: `lastRunAt`, `lastSuccessAt`, optional `lastErrorAt`, `lastErrorCode`, `lastErrorMessage`
- optional: `lastCursor` (for cursor-based APIs), `lastHash` (content hash), `lastStats`

---

## 5) Ingestion endpoints (backend)

These endpoints write into MongoDB (unlike the probe routes).

- POST `/api/ingest/bamboohr/directory?snapshotAt=YYYY-MM-DD&incremental=true` (optional; defaults to now / true)
  - Stores a directory snapshot `documents` row and upserts:
    - `employees`
    - `external_identities (bamboohr)`
    - `hrms_identity_snapshots`
    - `hrms_employment_snapshots`
  - When `incremental=true`, skips seeding employees whose directory payload is unchanged since last run.
  - Updates `ingestion_cursors` for `(sourceSystem=bamboohr, jobName=directory)`.

- POST `/api/ingest/bamboohr/employees/:id?fields=...&snapshotAt=YYYY-MM-DD` (optional; defaults to now)
  - Stores an HRMS profile document and upserts (as available):
    - `hrms_identity_snapshots`, `hrms_employment_snapshots`
    - `hrms_tenure_mobility_snapshots`, `hrms_offboarding_snapshots`
    - `hrms_compensation_snapshots`, `hrms_performance_snapshots`, `hrms_attendance_leave_snapshots` (raw `data` fallback)

- POST `/api/ingest/slack/users?snapshotAt=YYYY-MM-DD&incremental=true` (optional; defaults to now / true)
  - Stores a Slack users snapshot document and upserts `external_identities (slack)` (linked when email matches an employee).
  - When `incremental=true`, only writes identity rows that changed (prevents churn on `updatedAt`).
  - Updates `ingestion_cursors` for `(sourceSystem=slack, jobName=users)`.

- POST `/api/ingest/slack/channels?snapshotAt=YYYY-MM-DD&incremental=true&types=public_channel,private_channel&limit=200`
  - Stores a Slack channels snapshot document (`documentType=slack_channel_snapshot`).
  - Updates `ingestion_cursors` for `(sourceSystem=slack, jobName=channels)`.

- POST `/api/ingest/slack/channels/:channelId/messages?incremental=true&daysBack=7&includeReplies=false`
  - Ingests Slack messages from a specific channel into `documents` (`documentType=slack_message`).
  - **Timestamp incremental:** uses `ingestion_cursors.lastCursor` as a Slack `ts` watermark per `(sourceSystem=slack, jobName=channel_messages, scope=:channelId)`.
    - First run defaults `oldest = now - daysBack` unless you pass `oldest=...`.
  - Links message authors to employees via `external_identities (slack)` when possible, writing `document_participants`.

- POST `/api/ingest/calendar/events?calendarId=primary&pastDays=14&futureDays=7`
  - Stores each event in `documents` and upserts:
    - `document_participants`
    - `calendar_metrics_daily`
  - Requires Google OAuth tokens to exist (complete OAuth first via `/api/calendar/google/oauth/start`).

- POST `/api/ingest/documents`
  - Generic ingestion for transcripts/emails/notes with optional `document_chunks`.

- PUT `/api/ingest/external-identities/link`
  - Manually link an external identity to a canonical employee.

- GET `/api/ingest/cursors?sourceSystem=...&jobName=...&scope=...&limit=...`
  - Returns the current `ingestion_cursors` rows for the org (optionally filtered), including `lastRunAt`, `lastSuccessAt`, error info, and last-run stats.

- GET `/api/memory/events?employeeId=...`
- POST `/api/memory/events`

---

## 6) Implementation locations (backend)

- Mongo connector: `backend/src/db/mongo.js`
- Models: `backend/src/db/models/*`
- DB health route: `backend/src/routes/db.routes.js`

- Slack probe routes: `backend/src/routes/slack.routes.js`
- BambooHR routes: `backend/src/routes/bamboohr.routes.js`
- Calendar routes: `backend/src/routes/googleCalendar.routes.js`
- Ingestion routes: `backend/src/routes/ingest.routes.js`
- Memory routes: `backend/src/routes/memory.routes.js`

- Org + snapshot helpers: `backend/src/shared/org.js`
- Token store (Google): `backend/src/shared/googleTokenStore.js`
