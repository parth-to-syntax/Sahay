# Project Interview Guide — CUDEPT Breach / IntelliHR

## Read this first: what is actually built

This repository is an HR-intelligence **prototype**, not a finished enterprise platform. Its stated product is a CXO/CHRO dashboard that combines BambooHR employee data, Slack activity, meetings/transcripts, and Google Calendar into employee profiles, meeting briefs, chat answers, sentiment/retention signals, and alerts.

The implementation has three independently runnable applications:

| Component | Location | What it does today |
|---|---|---|
| Web client | `hero-app/` | React dashboard, employee/profile, chat, meeting summary, and insights screens. |
| Integration/API gateway | `backend/` | Express/Mongoose API for BambooHR, Slack, Google Calendar OAuth, Fireflies ingestion, Mongo persistence, and proxying requests to the AI service. |
| AI orchestrator | `llm/` | Express service that normalizes source data, queues analysis, calls Groq or heuristic fallbacks, persists profiles/history/chat, and serves dashboard/chat APIs. |

The PRD and architecture files describe a larger desired system: permission-safe RAG with citations, vector retrieval, email/Zoom/spreadsheet connectors, STT, and real-time meeting assistance. Those are useful **roadmap architecture**, but are not all present in the checked-in code. In an interview, lead with the working demo and say explicitly which parts are designed/planned.

---

## 1. Project overview

### The problem

Senior HR leaders prepare for many employee conversations but their context is fragmented: HRMS data is in BambooHR, discussions are in Slack, calendars indicate meeting load, and transcripts hold commitments and concerns. Searching each system manually is slow and causes important context to be missed.

IntelliHR centralizes that context around an employee. It gives an HR leader a dashboard, a profile with analysis/history, upcoming-meeting briefs, meeting transcripts, and a chat interface. The intended outcome is better prepared, evidence-aware conversations rather than automated decisions about employees.

### Why it was built

The product requirements emphasize “institutional memory at scale”: retain useful work context when a CHRO/HRBP has not personally attended every conversation. The technical motivation is to demonstrate an end-to-end data product: integrate SaaS APIs, normalize incompatible records, run AI-assisted analysis with deterministic guardrails, persist time-series history, and present it in a polished web UI.

### Real-world example

Before a 1:1 with an employee, an HRBP opens the profile. The system combines the BambooHR role/department with recent Slack and meeting context, computes a current health/risk summary, shows prior meeting summaries, and asks the AI service for a brief. The HRBP can then ask chat, for example, “What topics should I follow up on?” The intended future version returns evidence citations and respects the viewer’s permissions.

### A confident one-sentence pitch

“I built a full-stack HR intelligence prototype that ingests people and collaboration data, normalizes it into an employee-centric profile, uses queued AI analysis plus deterministic scoring to surface trends and meeting briefs, and exposes the results through a React dashboard.”

---

## 2. Architecture and data flow

### Actual architecture

The system deliberately splits external-integration work from AI orchestration.

* The browser speaks only to the Express backend (normally port 4000). `hero-app/src/lib/api.js` adds an optional `x-org-id` header.
* The backend owns connector credentials and integration-facing endpoints. It uses Mongoose models for an organization-scoped Mongo model and proxies `/api/intelligence/*` to the LLM service (normally port 8080).
* The LLM service owns pipeline orchestration and the demo-oriented profile/chat data model. It can use MongoDB and Redis/BullMQ, but deliberately falls back to in-memory storage/cache and inline queues if they are unavailable.
* MongoDB is the primary durable store. Redis is optional for queues, Groq request dispatch, and caching. Groq provides JSON-constrained LLM analyses; safe heuristic fallbacks keep demos operational when a key/provider is unavailable.

```text
  BambooHR        Slack          Google Calendar       Fireflies
     |              |                 |                   |
     +--------------+-----------------+-------------------+
                            external HTTPS APIs
                                     |
                                     v
                 +--------------------------------------+
                 | Express integration gateway :4000    |
                 | connectors, OAuth, ingestion, Mongo  |
                 +--------------+-----------------------+
                                | /api/intelligence proxy
                                v
                 +--------------------------------------+
                 | AI orchestrator :8080                |
                 | fetch -> normalize -> queue ->       |
                 | Groq/fallback analysis -> scoring    |
                 +---------+----------------+-----------+
                           |                |
                    MongoDB (profiles,      Redis/BullMQ
                    documents, meetings,    (optional queue,
                    histories, chat)        rate limits/cache)
                           ^
                           |
                 +---------+----------------------------+
                 | React/Vite SPA                        |
                 | dashboard, employees, chat, insights  |
                 +--------------------------------------+
```

### Request-to-response flow: employee dashboard/profile

1. React loads a route such as `/employees` and calls the gateway’s intelligence endpoints.
2. The gateway forwards the request to the AI service and enforces an upstream timeout (up to 120 seconds). It also enriches/merges some meeting data with Mongo/Google Calendar data.
3. The AI service reads cached or persisted `employee_profiles`, `employees`, meetings, and histories from Mongo (or its in-process fallback).
4. The frontend adapter (`hero-app/src/lib/api.js`) reshapes inconsistent upstream fields into UI-friendly fields such as `risk`, `score`, and `lastMeeting`.
5. React pages render cards/charts/tables using Recharts and motion-based transitions.

### Pipeline flow: refresh/analysis

1. A caller posts `/api/intelligence/pipeline/run` with an employee email.
2. The gateway forwards to `POST /pipeline/run` on the AI service.
3. `pipelineQueue.js` fetches source deltas in parallel, normalizes HRMS/Slack/transcript text with `unifiedSchema.js`, and saves raw snapshots.
4. The analysis stage calls Groq for sentiment, retention risk, summaries, and briefs. JSON-shaped results are validated/sanitized; failures use rule-based fallbacks.
5. `scoringEngine.js` blends extracted risk with deterministic formulae, smoothing sentiment with the previous profile and calculating health/confidence/deltas.
6. A versioned profile, alerts, sentiment/risk history, and meeting record are written to Mongo (or memory). Dashboard/profile cache entries are warmed.
7. The UI polls/reads the resulting profile through the same gateway.

### Design rationale

Splitting integration and AI services keeps credential-heavy connector code separate from expensive, asynchronous analysis. It also makes it possible to scale workers separately from request-serving APIs. The tradeoff is operational complexity: two Node services, duplicated/overlapping Mongo schemas, and no contract package shared between them.

---

## 3. Technology stack: role, rationale, alternatives

| Technology | Role and why it fits | Plausible alternative / tradeoff |
|---|---|---|
| React 19 + React DOM | Component-based SPA for data-heavy HR views; ecosystem and browser rendering are strong fits. | Vue/Svelte reduce some boilerplate; Angular offers stronger conventions but is heavier for a prototype. |
| Vite | Fast local dev server and production build for the React client. | CRA is older/slower; Next.js would add SSR/API conventions that are not needed here. |
| React Router | Client-side route mapping for landing, dashboard, profiles, chat, etc. | Next.js file routing or a single-page state switch; Router is simple and explicit. |
| Tailwind CSS | Rapid responsive styling via utility classes. | CSS Modules gives tighter component scoping; Material UI gives ready-made controls but a more opinionated visual language. |
| Recharts | Declarative React charts for sentiment/history/department visuals. | Chart.js/D3; D3 is more flexible but requires more low-level work. |
| Motion | Route and UI transitions; improves prototype polish. | CSS transitions are lighter but less expressive. |
| Node.js + Express | Both APIs use JavaScript, which reduces context switching and makes JSON HTTP endpoints quick to build. | NestJS provides structure/DI; Fastify improves performance/schema support; Express was fastest for the MVP. |
| Mongoose | Schema validation, indexes, and model API for the integration backend’s Mongo collections. | Native MongoDB driver is lighter; Prisma generally favors relational workflows. |
| Native MongoDB driver | Used in `llm/` for direct collection operations and flexible prototype schemas. | Mongoose would provide consistency, but it would require refactoring existing analysis documents. |
| MongoDB | Fits semi-structured upstream SaaS documents, raw JSON snapshots, evolving AI output, and denormalized employee profiles. | PostgreSQL is stronger for relational integrity/reporting; Mongo minimizes transformation friction during ingestion. |
| Redis + BullMQ | Optional durable queues, worker concurrency, debouncing, and provider rate limiting. | RabbitMQ/SQS/Temporal; Redis/BullMQ is straightforward in Node but needs Redis operations. |
| Groq SDK | Calls a hosted LLM for low-latency JSON analyses and summaries. | OpenAI/Anthropic/self-hosted models; this project chose Groq but abstracts dispatch and has no-key fallbacks. |
| Zod | Runtime validation of orchestrator request bodies. Important because external HTTP JSON is untrusted. | Joi/Yup/JSON Schema; Zod is concise and TypeScript-friendly, although this project is JavaScript. |
| Axios | Connector HTTP client with timeouts/error mapping for BambooHR/Fireflies. | Native `fetch` is already used elsewhere and would reduce dependencies; Axios’s interceptable error structure is convenient. |
| `@slack/web-api` | Official Slack API client for users, channels, history, and replies. | Handwritten REST calls increase pagination/auth mistakes. |
| Google APIs | OAuth2 client and Calendar access. | Direct REST/OAuth implementation creates unnecessary protocol/security work. |
| Helmet, CORS, Morgan | Baseline security headers, controlled browser origins, and development request logs. | Production needs structured logging and a stricter CORS/auth strategy. |

**Interview nuance:** JavaScript is a practical choice for speed, but TypeScript would be a credible improvement because API/data contracts cross three applications and AI output is inherently variable.

---

## 4. Code walkthrough

### Repository map

```text
hero-app/                 React/Vite presentation layer
backend/                  Express gateway, connectors, Mongoose persistence
  src/routes/             HTTP endpoints grouped by integration/capability
  src/connectors/         BambooHR, Slack, Google, Fireflies API clients
  src/db/models/          organization-scoped Mongo schemas + indexes
  src/features/           Bamboo/Slack identity and schema comparison logic
llm/                      AI analysis/orchestration service
  server/app.js           AI service HTTP entry point
  server/queues/          pipeline workers and orchestration
  server/services/        normalization, ingestion, analysis, cache, storage
  mock_data/              local demo source data
scripts/                  cross-service seeding/probing utilities
*.md / public-openapi.yaml Product/design notes and API contract artifacts
mongodb_dump/             example database dump; do not treat as application code
```

### Entry points

* `hero-app/src/main.jsx`: mounts React under `StrictMode`; `App.jsx` configures all routes/layouts.
* `backend/src/server.js`: loads environment configuration, attempts non-blocking Mongo connection, configures Helmet/CORS/JSON/Morgan, mounts `/api`, and listens on `PORT` (default 4000).
* `llm/server/app.js`: registers analysis/profile/chat endpoints, initializes storage/cache/queue machinery later in the file, and listens on default 8080.

### Important backend modules

* `backend/src/routes/index.js` is the gateway’s route composition root.
* `intelligence.routes.js` is an anti-corruption/proxy layer: it calls the LLM service, handles timeout/upstream failure translation, and merges calendar/meeting data. This protects the frontend from knowing internal service topology.
* `ingest.routes.js` contains the largest implementation surface: idempotent-ish ingestion for Slack channels/messages/users, BambooHR directory/employees, Calendar events, Fireflies transcripts, generic documents, and identity linking. It uses `ensureMongoConnected`, organization initialization, source hashes, upserts, and ingestion cursors.
* `connectors/*` hide HTTP/auth details. BambooHR maps Axios errors into `HttpError`; Fireflies uses GraphQL; Google owns OAuth client construction; Slack uses the official SDK.
* `shared/org.js` resolves organization scope as `x-org-id`, then query, environment default, then `demo`. This is a useful MVP tenant boundary but not authentication.
* `shared/googleTokenStore.js` reads/writes OAuth tokens to a local JSON file. It works locally but is deliberately not production-grade secret storage.

### Important AI-service modules

* `services/ingestion/fetchSources.js`: fetches mock/database/external source candidates and computes deltas from cursors.
* `services/normalization/unifiedSchema.js`: adapter layer that converts HRMS, Slack, and meeting formats into a unified employee/activity object plus `mergedContextText`. This is the key defense against vendor-specific field shape leaking into analysis.
* `queues/pipelineQueue.js`: orchestration. It supports BullMQ workers when Redis exists and inline processing otherwise, creates alerts, saves versioned output, and warms caches.
* `services/analysis/groqServices.js`: runs structured sentiment/risk/brief/chat operations and contains heuristic fallbacks. It clamps model scores and flags fallback use.
* `services/analysis/scoringEngine.js`: deterministic hybrid scoring. It uses sigmoid risk calibration, weighted health components, confidence penalties, and temporal deltas—making output less opaque than an LLM-only score.
* `services/analysis/groqDispatcher.js`: limits Groq calls to a configured RPM. It uses BullMQ/Redis when possible and a timestamp sliding-window limiter otherwise.
* `services/storage/stores.js`: persistence abstraction. It creates indexes and can use Mongo or in-memory arrays. This is convenient for demos but potentially hides missing infrastructure in production.
* `services/cache/cacheService.js`: cache-aside-style helper with Redis or a TTL Map fallback (profile TTL 1 hour, dashboard TTL 15 minutes).

### Important frontend modules

* `hero-app/src/lib/api.js` centralizes HTTP, error parsing, org header propagation, and defensive response adaptation. Its adapter functions are needed because the service payloads evolved.
* `pages/Dashboard.jsx`, `Employees.jsx`, and `EmployeeProfile.jsx` are primary data experiences.
* `pages/Chatbot.jsx`, `AiInsights.jsx`, `MeetingSummary.jsx` surface AI results.
* `components/*Chart.jsx` separate visualizations from page layout; `Navbar`, `Footer`, `MetricCard`, and alerts are reusable UI building blocks.

---

## 5. Database design

### Two schema layers—and how to explain them honestly

The gateway implements a relatively normalized, organization-scoped ingestion schema through Mongoose. The AI service uses its own denormalized analysis collections (`employee_profiles`, `alerts`, `sentiment_history`, `risk_history`, `chat_sessions`, etc.) through the native driver. Both can target MongoDB, but this dual model is a current integration debt.

### Gateway collections and relationships

| Collection | Purpose / relationship |
|---|---|
| `organizations` | Tenant root, keyed by `orgId`. |
| `employees` | Canonical employee identity within an org; unique `(orgId, employeeId)` and partial-unique work email. |
| `external_identities` | Maps Slack/Bamboo/Google external IDs to an employee; unique per org/source/external user ID. |
| `documents` | Raw/normalized ingested artifacts. Unique sparse `(orgId, sourceSystem, externalId)` enables idempotent imports. |
| `document_participants` | Many-to-many document ↔ employee mapping, with method/confidence. |
| `document_chunks` | Ordered text chunks for future retrieval; unique `(orgId, documentId, chunkIndex)`, optional vector pointer. |
| HRMS snapshot collections | Identity, employment, compensation, performance, leave, tenure/mobility, offboarding: immutable/as-of source snapshots by employee. |
| `meetings`, `meeting_transcript_turns` | Meeting metadata and ordered transcript turns. Unique meeting ID and unique ordered turns. |
| `memory_events` | Employee-level extracted facts (action, commitment, topic, concern, sentiment); indexed by employee/time. |
| `calendar_metrics_daily` | One daily aggregate per employee, enforced by unique `(orgId, employeeId, day)`. |
| `ingestion_cursors` | Stateful incremental ingestion checkpoint per org/source/job/scope. |
| `audit_logs`, `survey_responses` | Designed for traceability and HR feedback data. |

### Key indexes and why

* Tenant prefix (`orgId`) is present on nearly every gateway index, preventing cross-tenant scans as multi-tenancy arrives.
* `(orgId, employeeId, asOf: -1)` supports “latest official profile/history” lookup.
* sparse/partial unique indexes allow optional external IDs/emails without treating absent values as duplicates.
* `(orgId, employeeEmail, meetingAt: -1)` and transcript `(orgId, meetingId, turnIndex)` match common profile timeline and ordered-transcript reads.
* document source/external ID uniqueness gives ingestion retry safety.
* AI-side `employeeEmail + version/analyzedAt` indexes make latest-profile and time-series chart reads efficient; session/message composite indexes preserve chat order.

### Important query patterns

* Latest HRMS state: filter tenant + employee, sort `asOf desc`, limit 1.
* Employee timeline: filter tenant + employee, sort `eventTime desc`.
* Meeting history: filter email, sort `meetingAt desc`, limit/paginate.
* Idempotent ingestion: `updateOne(..., {upsert:true})` keyed by stable upstream ID/content hash.
* Chat history: filter session, sort message index ascending.

### Why MongoDB

External HRIS/Slack/Calendar payloads differ and evolve. Mongo lets the system preserve raw source JSON alongside normalized fields and flexible AI output. The cost is that relationships are enforced mostly in application code rather than database foreign keys. For audited workflows, validate references and use transactions where multi-collection consistency matters.

---

## 6. API guide

All gateway responses conventionally use `{ ok: true, data: ... }`; errors use `{ ok: false, error: { message, code } }`. The frontend sends JSON and may send `x-org-id`. The LLM service has a simpler `{ data }`/`{ error }` convention. **There is no application-user authentication middleware in this codebase.** Connector authentication is separate (API keys/OAuth tokens).

### Health and connector discovery

| Endpoint | Method | Input | Result / internal flow |
|---|---|---|---|
| `/health` | GET | — | Gateway liveness. |
| `/api/db/health` | GET | — | Tries/reports Mongoose connection state. |
| `/api/bamboohr/meta/fields` | GET | — | Fetches BambooHR field metadata. |
| `/api/bamboohr/employees/directory` | GET | — | Fetches BambooHR directory. |
| `/api/bamboohr/employees/:id?fields=a,b` | GET | path/query | Fetches selected employee fields. |
| `/api/bamboohr/schema/compare` | GET | — | Compares available Bamboo fields to desired schema. |
| `/api/bamboohr/schema/search?q=salary` | GET | `q` required | Keyword-filtered Bamboo field metadata. |
| `/api/slack/auth/test`, `/probe` | GET | — | Validates token / safe metadata probe. |
| `/api/slack/conversations/list` | GET | `limit`, `types` | Returns channel summary, not full content. |
| `/api/slack/conversations/:id/info` | GET | path | Safe channel details. |
| `/api/slack/conversations/:id/history` | GET | `limit`, `oldest`, `latest` | Safe message metadata; deliberately omits text. |
| `/api/slack/conversations/:id/replies` | GET | `ts` required, `limit` | Safe thread metadata. |
| `/api/slack/users/list` | GET | `limit` | Safe member counts/sample IDs. |

### Ingestion and identity APIs

These endpoints require MongoDB and scope writes through `x-org-id`/`orgId`. They turn upstream data into `documents`, employees, identities, snapshots, meetings, transcript turns, and cursors. Exact optional fields are implementation-specific; use `public-openapi.yaml` where maintained.

| Endpoint | Method | Main request format | Outcome |
|---|---|---|---|
| `/api/ingest/cursors` | GET | source/job query filters | Reads ingestion checkpoints. |
| `/api/ingest/slack/channels` | POST | channel identifiers/options | Stores channel snapshot documents. |
| `/api/ingest/slack/channels/:channelId/messages` | POST | date/limit options | Fetches/persists Slack messages and participant links. |
| `/api/ingest/slack/users` | POST | limit/options | Imports Slack identities and resolves email matches. |
| `/api/ingest/bamboohr/directory` | POST | snapshot options | Upserts canonical employees and HRMS snapshots. |
| `/api/ingest/bamboohr/employees/:id` | POST | requested fields/as-of | Ingests a detailed Bamboo employee snapshot. |
| `/api/ingest/calendar/events` | POST | calendar/time range | Stores calendar documents, participant associations, daily metrics. |
| `/api/ingest/fireflies/transcripts` | POST | `limit`, `skip`, `fromDate`, `toDate` | Calls Fireflies GraphQL, upserts meeting and ordered transcript turns. |
| `/api/ingest/documents` | POST | generic document JSON | Stores an arbitrary normalized document/chunks. |
| `/api/ingest/external-identities/link` | PUT | `{ employeeId, sourceSystem, externalUserId, ... }` | Manual/explicit canonical identity linking. |
| `/api/memory/events` | GET/POST | query filters / event body | Reads or creates `MemoryEvent` records. |

### Google Calendar OAuth APIs

* `GET /api/calendar/google/oauth/start`: redirects to Google consent; the connector needs configured client ID/secret/redirect URI.
* `GET /api/calendar/google/oauth/callback?code=...`: exchanges code and writes tokens to `.google_tokens.json` (or `GOOGLE_TOKEN_PATH`).
* `GET /api/calendar/google/status` and `/config`: connection/config diagnostics.
* `GET /api/calendar/google/probe?calendarId=primary&pastDays=90&futureDays=30&maxResults=25`: reads Calendar API and returns masked, schema-oriented samples.

### Sync APIs

* `GET /api/sync/bamboohr-slack/compare?includeEmails=true`: compares identity sets.
* `GET /api/sync/slack-to-bamboohr/plan?limit=200`: dry-run creation plan.
* `POST /api/sync/slack-to-bamboohr/apply?confirm=true&maxCreates=20`: may create BambooHR employees. The explicit confirmation and cap are useful safeguards, but real production access should require RBAC and approval logging.

### Intelligence APIs (the frontend’s main contract)

The gateway forwards most of these to the LLM service, so it is intentionally a façade. Main endpoints are:

| Gateway endpoint | Method / representative body | Internal flow / response concept |
|---|---|---|
| `/api/intelligence/dashboard` | GET | Retrieves dashboard summary/cache from orchestrator. |
| `/api/intelligence/employees` | GET | Lists enriched employee identities and analysis summaries. |
| `/api/intelligence/employees/:email/profile` | GET | Latest versioned profile for an email. |
| `/api/intelligence/employees/:email/history?limit=30` | GET | Sentiment/risk time series, with gateway Mongo fallback/enrichment. |
| `/api/intelligence/meetings?limit=...` | GET | Merges persisted Fireflies and Calendar-shaped meetings. |
| `/api/intelligence/meetings/:id/transcript` | GET | Ordered transcript output. |
| `/api/intelligence/meetings/refresh-google` | POST | Authenticated Calendar data is read/persisted/refreshed. |
| `/api/intelligence/briefs/upcoming` | POST `{ employeeEmail, meetingAt?, participantEmails? }` | Enqueues/reads analysis then returns meeting brief and prior-meeting insight. |
| `/api/intelligence/chat/query` | POST `{ query, stream?, sessionId? }` | Validates query; orchestrator runs intent/chat service and persists session/messages. |
| `/api/intelligence/chat/sessions` | POST/GET | Creates or lists sessions. |
| `/api/intelligence/chat/sessions/:id` | PATCH/DELETE | Updates title/status or removes a session. |
| `/api/intelligence/chat/sessions/:id/history` | GET | Ordered stored conversation messages. |
| `/api/intelligence/pipeline/run` | POST `{ employeeEmail, reason?, meetingAt? }` | Enqueues/executes ingestion + analysis pipeline. |
| `/api/intelligence/pipeline/sync-bamboohr` | POST `{ reason?, runPipeline?, limit?, employeeEmails? }` | Syncs candidate identities and optionally triggers profiles. |

The direct AI-service equivalents omit `/api/intelligence` (for example `POST http://localhost:8080/chat/query`). It also exposes `POST /bootstrap/init`, `GET /ingestion/source-check`, and `POST /webhooks/slack`.

---

## 7. Engineering concepts worth explaining

### Patterns

* **Adapter / anti-corruption layer:** connector modules translate BambooHR, Slack, Fireflies, and Google APIs into app-owned shapes. `normalizeUnifiedSchema` is the clearest example.
* **Gateway/facade:** backend intelligence routes hide the separate AI service from the browser.
* **Repository-like persistence abstraction:** `stores.js` hides Mongo vs memory. Good for demo resilience; name the risk that it is not a formal interface and can mask production failures.
* **Pipeline/worker pattern:** ingestion and analysis stages are separated by BullMQ queues; inline fallback maintains local development.
* **Cache-aside:** profile/dashboard cache is explicitly warmed after writes and read by serving endpoints.
* **Snapshot/event-history design:** HRMS snapshots preserve as-of state; analysis profiles and histories are versioned rather than overwritten.

### OOP and modularity

The code is mostly functional CommonJS/ESM modules, not class-heavy OOP. Encapsulation appears through module boundaries: routes orchestrate HTTP, connectors own remote calls, models own persistence shape, and services own business logic. Do not claim inheritance/polymorphism is a core feature; it is not.

### Algorithms/data structures

* `Map` and `Set` deduplicate employees/meetings and assemble lookup indexes in linear time.
* Identity resolution is primarily deterministic email matching, recording match method/confidence. This is safer than fuzzy matching for HR data.
* Direct Groq limiting uses a timestamp queue/sliding window; BullMQ’s limiter provides distributed enforcement when Redis is available.
* Hybrid scoring uses a sigmoid/logit-style risk function, weighted health score, exponential-style sentiment smoothing (70% current/30% previous), and clamping. This makes score behavior explainable and bounded 0–100.

### Async/concurrency handling

The code uses `async/await`, `Promise.all` for independent API fetches, timeout/`AbortController` for LLM proxy calls, bounded provider rate limiting, and queue workers for expensive tasks. A nice interview point: parallelize independent connectors but rate-limit the shared LLM provider, otherwise latency improves at the cost of 429s.

### Error handling

Connector failures are mapped to meaningful `HttpError`s (timeouts vs HTTP vs network); Express has a centralized error response. Zod rejects malformed analysis requests. Model failure falls back to heuristic analysis and marks `fallbackUsed`, then generates an alert. This improves availability but must not silently present heuristic signals as authoritative.

### Security and privacy practices present

* Connector secrets are environment variables, not hard-coded.
* Helmet, restricted CORS configuration, request body size limits, and URL encoding are baseline defenses.
* Slack exploration endpoints return metadata rather than message text.
* Google probe masks emails; Bamboo errors redact email-like strings.
* Tenant/org ID is modeled and indexed.
* Some potentially destructive sync work requires `confirm=true` and a creation cap.

### Security gaps to volunteer

No user login/JWT/session authorization is enforced, `x-org-id` is caller-controlled, OAuth tokens are written unencrypted to a local JSON file, raw HR/transcript data can be stored, audit logging is modeled but not consistently invoked, and no rate limiting/CSRF policy/API gateway auth is evident. In an interview say these are priority production hardening tasks, not features already solved.

---

## 8. Difficult problems, solutions, and tradeoffs

### Heterogeneous-source normalization

**Challenge:** HRMS records, Slack messages, and transcripts have incompatible identifiers, schemas, and timestamps.

**Solution:** retain raw payloads for traceability, use canonical employee IDs/emails plus `ExternalIdentity`, record match confidence/method, normalize into a small unified analysis schema, and use source/external ID uniqueness for replay safety.

**Tradeoff:** email matching is explainable but fails for aliases, missing emails, mergers, and shared accounts. Fuzzy matching should be reviewable, thresholded, and never silently auto-link sensitive data.

### Reliable LLM output and provider failures

**Challenge:** LLMs can be unavailable, rate limited, inconsistent, or overconfident.

**Solution:** JSON-object prompting, result validation/clamping, Groq dispatcher rate limits, BullMQ when Redis is available, a local sliding-window limiter otherwise, and deterministic fallbacks with `fallbackUsed`/confidence penalties.

**Tradeoff:** fallbacks preserve availability but can be much less accurate. The UI should visibly label uncertainty and avoid personnel decisions from the output.

### Explainable employee signals

**Challenge:** a pure LLM “risk score” is difficult to defend in HR settings.

**Solution:** blend LLM-extracted signals with deterministic score components—risk tiers, engagement activity, HRMS data, previous sentiment, bounded weighted health—and retain historical profiles.

**Tradeoff:** current engagement proxy counts messages/turns and can encode role/team bias. It needs fairness evaluation and feature review before real decisions.

### Incremental, idempotent ingestion

**Challenge:** SaaS APIs paginate, retry, duplicate events, and can be expensive.

**Solution:** `IngestionCursor`, stable source IDs/content hashes, compound unique indexes, upserts, and source job/scope state.

**Tradeoff:** not every source’s incremental semantics are fully production-hardened; external API rate limits/backoff and dead-letter handling need strengthening.

### Working locally without infrastructure

**Challenge:** a hackathon/demo should run without Redis or even Mongo.

**Solution:** in-memory cache/store and inline queue fallbacks.

**Tradeoff:** data disappears on restart and multiple instances disagree. Disable fallback modes in production and fail fast on unavailable durable dependencies.

---

## 9. Interview question bank

### Basic

**Q: What did you build?**
**A:** A full-stack HR intelligence prototype that integrates HRMS/collaboration data and creates employee-centric dashboards, chat, briefs, historical signals, and alerts.

**Q: What is the main user value?**
**A:** Less manual context gathering before an employee conversation and more consistent follow-up on work-related themes and commitments.

**Q: What are the main components?**
**A:** React/Vite UI, Express integration gateway, separate Node AI orchestrator, MongoDB persistence, optional Redis/BullMQ, and Groq for structured AI analysis.

**Q: Why not call the LLM directly from React?**
**A:** Keys and raw sensitive context must stay server-side; server-side orchestration also supports validation, caching, queues, auditing, and fallback logic.

### Intermediate

**Q: How do you prevent duplicate ingestion?**
**A:** Store stable source identifiers/content hashes and use compound unique indexes plus upserts. Cursors track a source/job/scope checkpoint for incremental work.

**Q: Why do you keep raw data and normalized data?**
**A:** Raw data enables audit/debug/reprocessing when mappings change; normalized fields make serving/analysis fast and vendor-independent. Retention/encryption are required for production.

**Q: Explain hybrid scoring.**
**A:** The LLM extracts structured signals, but deterministic code calibrates risk with a sigmoid, smooths sentiment against the prior profile, combines sentiment/risk/engagement/HRMS components into health, and lowers confidence when fallback results were used.

**Q: How are async jobs handled?**
**A:** The pipeline can use BullMQ queues/workers backed by Redis, separating ingestion from analysis. For local demo resilience it falls back to inline execution.

**Q: How would you test it?**
**A:** Unit-test normalizers, scoring boundaries, identity matching, and connector error mapping; integration-test routes against mocked upstream APIs and ephemeral Mongo/Redis; end-to-end-test the browser against seeded data; add contract tests between gateway and AI service. This repository has no discovered automated test suite, so this is a material next step.

### Deep technical / design questions

**Q: Why MongoDB rather than PostgreSQL?**
**A:** Ingestion is schema-evolving and source payloads/AI outputs are semi-structured, so Mongo reduces transformation cost and preserves raw JSON. I would consider PostgreSQL for strong relational permissioning/reporting, or a hybrid architecture with object storage + warehouse.

**Q: Why queue work instead of processing an analysis request synchronously?**
**A:** Connector and LLM calls are slow/unreliable and can exceed HTTP timeouts. Queues provide retries, concurrency controls, isolation, and eventual completion. The API can return 202/job status for a production experience.

**Q: How would you make chat grounded?**
**A:** The PRD specifies permission-filtered vector retrieval and citations, but the current implementation does not have a vector store/retrieval enforcement layer. I would chunk documents, embed them, filter by tenant/user/sensitivity before retrieval, supply only retrieved excerpts to the LLM, require citation IDs, and validate citations before returning.

**Q: Why choose Groq over another provider?**
**A:** The abstraction supports a fast hosted model for prototype structured analysis. The important design is not provider lock-in: dispatcher, JSON validation, rate limiting, and fallback behavior make replacement feasible. For production I would benchmark quality, data agreements, cost, and regional/privacy requirements.

**Q: What would you change before using the score in HR decisions?**
**A:** I would not use it for automated employment decisions. I would add consent/purpose limits, evidence display, human review, bias/fairness testing, calibration against labeled data, access controls, appeals/correction flows, retention rules, and legal/privacy review.

### “Why X over Y?” rapid answers

* **Express over NestJS:** MVP speed and low ceremony; NestJS is attractive when the service grows and needs standardized dependency injection/modules.
* **Redis/BullMQ over only in-process promises:** distributed queueing/retries/rate limiting across instances. In-process is only local fallback.
* **Deterministic + LLM over LLM-only:** more stable, inspectable, and testable health/risk scores.
* **Email exact-match over fuzzy names:** a false match can leak sensitive employee data; precision beats recall first.
* **Gateway plus AI service rather than one monolith:** independent scaling and credential isolation; tradeoff is increased deployment/contract complexity.

---

## 10. Scaling discussion

### Current limitations/bottlenecks

1. In-memory fallback state is not shared/durable.
2. Groq calls dominate pipeline latency and are provider-rate-limited.
3. Gateway proxy timeout can hold HTTP connections while analysis runs.
4. Mongo raw documents/transcripts grow quickly; no lifecycle/object-store strategy is implemented.
5. One gateway/AI service has no documented horizontal deployment, observability stack, authentication, or robust retry/dead-letter policy.
6. The code contains two overlapping Mongo data models, which risks ambiguity as features grow.
7. Current cache invalidation is simple TTL/warm-on-write; multi-instance invalidation needs Redis/pub-sub or versioned keys.

### A 10×-user plan

* Put the React bundle behind a CDN; run stateless gateway replicas behind a load balancer.
* Move every expensive ingest/analysis request to a durable queue and return a job ID. Autoscale workers by queue depth and partition by tenant/source.
* Use Redis for shared cache, BullMQ, distributed rate limit, and debouncing—not memory fallback.
* Store raw transcript/audio in encrypted object storage with lifecycle rules; keep Mongo for metadata, curated chunks, profiles, and audit records.
* Add Mongo replica set, backups, monitoring, read replicas where appropriate, shard only after measuring (likely tenant key + time-aware strategy), and enforce pagination/field projections.
* Batch upstream connector calls, respect each provider’s pagination/rate limits, use exponential backoff with jitter, and maintain idempotency keys plus dead-letter queues.
* Introduce a vector DB/search index only when grounded retrieval is delivered; partition/filter on tenant, employee, sensitivity, and retention state.

### Caching strategy

Cache read-heavy dashboard and latest profile views with tenant/user/permission-aware keys. Invalidate/warm profiles after pipeline writes; dashboard cache may use short TTL or event-driven invalidation. Never cache a response without including authorization/sensitivity scope in its key. Cache embeddings and stable summaries, not raw high-risk content unnecessarily.

### Microservice direction

At larger scale, split intentionally—not prematurely—into: connector ingestion workers, identity-resolution service, document/chunk retrieval service, AI analysis workers, profile/query API, notification service, and audit/authorization service. Share explicit schemas/events (for example, versioned JSON Schema/Protobuf) to avoid the current implicit cross-service document contract.

---

## 11. Resume-ready explanations

### 30 seconds

“I built IntelliHR, a full-stack HR intelligence prototype. It aggregates BambooHR, Slack, Calendar, and transcript data into employee profiles and meeting context. I used React for the dashboard, Express services for integrations and APIs, MongoDB for source snapshots and analysis history, and a queued Groq pipeline with deterministic scoring and fallbacks to generate explainable signals and briefs.”

### 2 minutes

“The problem was that HR leaders lose time collecting context before employee conversations because the relevant facts are split across the HRMS, collaboration tools, calendars, and meeting records. I designed a React dashboard backed by an Express integration gateway and a separate AI orchestration service. The gateway owns BambooHR, Slack, Google OAuth/Calendar, and Fireflies connectors; it normalizes and persists data in Mongo using organization-scoped models, unique source IDs, ingestion cursors, and transcript ordering.

For analysis, the orchestrator fetches source deltas, normalizes them into an employee-centric context, queues work with BullMQ/Redis when available, and calls Groq for structured sentiment, retention, summaries, and meeting briefs. I did not rely on the LLM alone: deterministic logic smooths sentiment, calibrates risk, calculates a bounded health score, and lowers confidence if a fallback was used. The UI shows dashboards, profiles, histories, meetings, and chat. The biggest production gaps I would address are real RBAC, grounded retrieval with citations, encrypted token storage, tests, and stronger observability.”

### 5 minutes: deep explanation outline

1. Start with the HR context fragmentation problem and safety constraint: assist human preparation, never make automatic employment decisions.
2. Draw the three-tier architecture: React → gateway → orchestrator, with Mongo and optional Redis.
3. Explain connectors and identity: source-specific auth stays in backend; source IDs, raw docs, external identities, and email-exact matching connect records safely.
4. Walk through one pipeline request: enqueue, parallel fetch, normalize, LLM structured extraction, deterministic score, history/alerts/cache, then UI.
5. Explain reliability: provider RPM limiter, queue fallback, HTTP timeout, upserts/cursors, heuristic fallback marked in confidence.
6. Explain database/index choices: org prefix, latest snapshots, ordered transcripts, stable ingestion identity, historical profile versions.
7. Address hard tradeoffs: Mongo flexibility vs relational guarantees, microservice separation vs operational complexity, availability fallbacks vs accuracy, and privacy constraints.
8. Finish with the roadmap: auth/RBAC/ABAC, citation-backed RAG/vector retrieval, encryption/retention, real-time meeting pipeline, tests/metrics, and worker autoscaling.

---

## 12. Learning checklist before interviews

### Must revise

- JavaScript async/await, `Promise.all`, event-loop implications, fetch cancellation, and error propagation.
- HTTP semantics: idempotency, 202 vs 200, pagination, status code mapping, REST design, webhooks, OAuth2 authorization-code flow, API keys.
- MongoDB document modeling, compound/partial/sparse indexes, `upsert`, query plans, replica sets, sharding tradeoffs, and transactions.
- Redis caching patterns, TTL/invalidation, BullMQ queues/workers/retries/dead-letter queues, and distributed rate limiting.
- React hooks, route parameters, controlled loading/error states, list keys, component composition, and client API abstraction.
- LLM engineering: structured output validation, prompt injection, hallucinations, token/context limits, embeddings/RAG, evaluation, rate limits, and fallback design.
- Security: OWASP API risks, JWT/OIDC, RBAC vs ABAC, tenant isolation, encryption at rest/in transit, secret managers, audit trails, PII retention/deletion.
- System design: load balancers, CDN, horizontal scaling, background jobs, observability (logs/metrics/traces), SLOs, and backpressure.

### Be ready to defend or improve

- Why `x-org-id` is not real tenant security and how authenticated tenant context should be derived from a signed identity.
- Why local OAuth-token JSON storage and raw transcript persistence are unacceptable in production.
- How to avoid algorithmic bias: message count and sentiment language are weak, context-sensitive signals.
- Why “retention risk” needs careful wording, source evidence, human review, and potentially legal review.
- How you would reconcile the gateway’s Mongoose schema with the LLM service’s native-driver collections into a single documented domain contract.
- How you would add a test suite; no automated tests were found in the repository.
- Which roadmap items are aspirational: vector store/RAG citations, Zoom/email/spreadsheet production connectors, STT/live meeting streaming, consistent audit/RBAC, and production multi-tenancy.

## Final interview rule

Be precise: say “implemented” for the React UI, connectors, Mongo models, ingestion routes, queue/fallback orchestration, Groq-based analysis, and hybrid scoring. Say “designed/planned” for the PRD’s permission-safe cited RAG and live meeting-assist architecture. That distinction makes your explanation stronger, more credible, and easier to defend under follow-up questions.
