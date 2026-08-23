# IntelliHR

An AI-assisted HR intelligence platform that turns employee context from HRMS records, Slack, meetings, and calendar systems into useful preparation for better conversations.

## What it does

- Provides a unified employee directory and profile view.
- Surfaces health, sentiment, engagement, and retention-risk signals.
- Generates meeting briefs with changes, open loops, and conversation prompts.
- Combines meeting transcripts with HR and communication context.
- Supports BambooHR, Slack, Google Calendar, and Fireflies ingestion paths.
- Includes a synthetic-data pipeline for local demonstrations.

## Repository layout

```text
frontend/                           React + Vite dashboard
backend/                            Express API, MongoDB models, integrations
llm/                                Groq analysis, scoring, queues, storage
integrations/bamboo-slack-sync/     BambooHR and synthetic Slack pipeline
scripts/                            Cross-service seed helpers
docs/                               Architecture, schema, product, and interview docs
```

See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) for service responsibilities and data flow. See [docs/README_DOCS.md](docs/README_DOCS.md) for the documentation guide.

## Prerequisites

- Node.js 20+
- npm 10+
- MongoDB for persistence and seeded demo data
- Redis for queue-backed AI processing when enabled
- Python 3.10+ for the optional BambooHR-to-synthetic-Slack pipeline
- A Groq API key for live LLM analysis; mock/demo flows can run without it

## Install

```bash
cd backend && npm install
cd ../llm && npm install
cd ../frontend && npm install
```

## Run locally

Start each service in a separate terminal:

```bash
# Terminal 1 — AI orchestrator
cd llm
npm run start:server

# Terminal 2 — API gateway
cd backend
npm run dev

# Terminal 3 — frontend
cd frontend
npm run dev
```

The Vite dashboard normally runs at `http://localhost:5173`. The API gateway defaults to port `4000`, and the AI orchestrator defaults to port `8080`. Set `VITE_BACKEND_BASE_URL` to the API gateway URL and configure service environment files locally.

## Demo data

Initialize and seed MongoDB through the API gateway:

```bash
cd backend
npm run db:init
npm run db:seed-demo
```

Run the optional synthetic pipeline:

```bash
cd integrations/bamboo-slack-sync
pip install requests python-dateutil
python step1_fetch_bamboohr.py
python step2_generate_slack.py
python step3_seed_database.py
python step4_verify.py
```

The pipeline has a demo fallback when BambooHR credentials are unavailable. Never commit real exports, API keys, employee records, or local database files.

## Useful commands

```bash
# Frontend quality checks
cd frontend && npm run lint && npm run build

# Next Gen / LLM analysis flows
cd llm
npm run analyze:health
npm run analyze:retention
npm run analyze:brief
npm run simulate:ai-flow

# Full backend seed flow
cd backend && npm run seed:all
```

## API overview

The API gateway exposes health, database, BambooHR, Slack, synchronization, calendar, ingestion, memory, and intelligence routes. Key dashboard endpoints include:

```text
GET  /health
GET  /api/intelligence/dashboard
GET  /api/intelligence/employees
GET  /api/intelligence/employees/:email/profile
GET  /api/intelligence/meetings
POST /api/intelligence/chat/query
POST /api/intelligence/briefs/upcoming
POST /api/intelligence/pipeline/run
```

The complete route contract is in [`public-openapi.yaml`](public-openapi.yaml).

## Product principles

Intelligence is derived context, not a replacement for source records. Analysis should be explainable, permission-aware, and traceable to underlying HR, communication, or meeting evidence. The MVP is designed for one organization while retaining organization scoping in the data model.

## Current status

IntelliHR is an actively developed prototype. Integrations requiring third-party credentials are optional locally, while seeded and synthetic-data paths make the core dashboard and analysis flows demonstrable.
