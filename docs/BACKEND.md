# IntelliHR Backend (BambooHR + Slack probes)

## Setup
1) Install deps:
- `cd backend`
- `npm install`

2) Configure env:
- Create `backend/.env` from your local environment configuration.

MongoDB (optional unless you use persistence endpoints like `/api/db/*`):
- `MONGODB_URI` (e.g. `mongodb://localhost:27017/intellihr`)
- `MONGO_URI` is also accepted as an alias

BambooHR (optional unless you use `/api/bamboohr/*`):
- `BAMBOOHR_COMPANY` (your BambooHR subdomain)
- `BAMBOOHR_API_KEY`

Slack (optional unless you use `/api/slack/*`):
- `SLACK_BOT_TOKEN`
- Optional convenience for `/api/slack/probe`:
	- `SLACK_GENERAL_CHANNEL_ID`
	- `SLACK_RANDOM_CHANNEL_ID`

3) Run:
- Dev: `npm run dev`
- Prod: `npm start`

4) LLM integration (for `/api/intelligence/*`):
- `LLM_BASE_URL` (default `http://localhost:8080`)
- `LLM_PROXY_TIMEOUT_MS` (default `30000`)

5) Frontend integration:
- `CORS_ORIGIN` (default `http://localhost:5173`, supports comma-separated list)

## Endpoints
- `GET /health`

### MongoDB
- `GET /api/db/health`

### BambooHR
- `GET /api/bamboohr/meta/fields`
- `GET /api/bamboohr/employees/directory`
- `GET /api/bamboohr/employees/:id?fields=firstName,lastName,workEmail`
- `GET /api/bamboohr/schema/compare`
- `GET /api/bamboohr/schema/search?q=salary`

### Slack (safe summaries; no message text)
- `GET /api/slack/auth/test`
- `GET /api/slack/probe`
- `GET /api/slack/conversations/list?limit=100&types=public_channel,private_channel`
- `GET /api/slack/conversations/:channelId/info`
- `GET /api/slack/conversations/:channelId/history?limit=25`
- `GET /api/slack/conversations/:channelId/replies?ts=<thread_ts>&limit=25`
- `GET /api/slack/users/list?limit=200`

### Sync (BambooHR ↔ Slack)
- `GET /api/sync/bamboohr-slack/compare`
- `GET /api/sync/slack-to-bamboohr/plan`
- `POST /api/sync/slack-to-bamboohr/apply?confirm=true&maxCreates=20`

### Intelligence (LLM proxy)
- `GET /api/intelligence/health`
- `GET /api/intelligence/dashboard`
- `GET /api/intelligence/employees`
- `GET /api/intelligence/employees/:email/profile`
- `GET /api/intelligence/meetings`
- `GET /api/intelligence/meetings/:id/transcript`
- `POST /api/intelligence/chat/query`
- `POST /api/intelligence/briefs/upcoming`
- `POST /api/intelligence/pipeline/run`

Notes:
- The server never logs your API key.
- The server never logs your Slack bot token.
- Rotate any API key that was pasted into chat logs.

## Capability discovery (quick)
- Run: `node backend/scripts/compareBamboohrSchema.js`
	- Compares your desired HRMS schema wishlist against BambooHR `meta/fields` + `employees/directory`.

Quick field discovery:
- Use `GET /api/bamboohr/schema/search?q=<keyword>` with keywords like `salary`, `bonus`, `time off`, `termination`, `performance`.

## Slack capability discovery (quick)
- Run: `node backend/scripts/probeSlack.js`
	- Outputs a JSON report with counts + message metadata only (no message text).

## Slack → BambooHR import (for demo)

This creates BambooHR employee records for Slack users that don't already exist in BambooHR (matched by email).

- Plan (no changes): `node backend/scripts/importSlackUsersToBamboohr.js`
- Apply (creates employees): set `CONFIRM_IMPORT=true` and run the same script.
