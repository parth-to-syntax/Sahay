# CXO HR Intelligence Dashboard — Product Requirements Document (PRD)

## 1. Summary
Senior HR leaders (CHRO/HRBPs) need **institutional memory at scale**: a unified, permission-safe view of each employee’s official HR record plus contextual insights extracted from past interactions (meeting transcripts) and structured spreadsheets.

This product provides:
- A **unified employee profile** (official + contextual memory timeline)
- A **prep briefing** for check-ins (what changed, open loops, sensitive areas, conversation starters)
- A **conversational assistant** grounded in retrieved evidence
- **In-meeting assistance** that produces real-time, permission-safe prompts based on the live transcript

Scope: **single organization (one tenant) for MVP**, with data model and architecture designed so multi-tenant scaling is straightforward later.

## 2. Goals / Outcomes
### Primary goals
1) Reduce time to prepare for employee check-ins.
2) Improve relationship quality by enabling specific, informed, empathetic conversations.
3) Provide reliable institutional memory (no hallucinated “past conversations”).
4) Provide in-meeting prompts that are low-latency, safe, and evidence-backed.

### Success metrics (MVP)
- Prep time reduced by ≥50% (self-reported or time-on-task).
- CHRO satisfaction rating ≥4/5 for “briefing usefulness.”
- “Wrong or missing context” feedback rate <10% of sessions.
- Permission violations: 0.
- In-meeting prompt latency: p95 < 5 seconds from spoken line → suggestion.

## 3. Non-goals (explicit)
- Not an employee surveillance tool; do not do covert monitoring.
- No deterministic predictions like “this employee will resign.” Only evidence-based indicators.
- No medical/protected-class inference or mental health diagnosis.
- No automated performance evaluation.

## 4. Users & Personas
- **CHRO**: needs breadth + relationship memory; wants concise briefings and reliable recall.
- **Senior HRBP**: deeper involvement; wants themes, commitments, and sensitive context; often supports managers.
- **People Ops/Talent leader**: looks for aggregated themes and action follow-ups.

## 5. Data sources (mandatory per requirements)
All sources below are mandatory for the target solution. Implementation order may vary.

1) **BambooHR (HRMS)** (authoritative): employee roster, org structure, role, manager chain, tenure, location, etc.
2) **Spreadsheets** (structured): engagement trackers, project allocations, manual notes, check-in trackers.
3) **Zoom**: meetings, recordings, transcripts (when available).
4) **Slack**: messages and channels/DMs where relevant to employee context.
5) **Google Calendar**: meeting schedule, participants, meeting topics.
6) **Email (Gmail/Outlook)**: messages relevant to employee concerns and follow-ups.

Notes:
- **Speech-to-text (STT) is required** for meetings where transcripts are not available (recordings) and for live meeting assistance when only audio is available.
- For the MVP/demo, transcript ingestion can be either (a) exported transcript text, or (b) recording audio → STT → transcript.
- Email/Slack ingestion must be permission-scoped and privacy-minimizing.

## 6. Core concepts & product behavior
### 6.1 Unified Employee Profile
The system constructs a profile with two layers:
- **Official layer**: HRMS-backed fields (source-of-truth).
- **Contextual layer**: a **timeline of “memory events”** extracted from transcripts/spreadsheets with citations.

Every contextual insight must be:
- Time-stamped
- Linked to at least one source (document + excerpt)
- Labeled with confidence and sensitivity
- Permission-filtered

### 6.2 Conversation assistant (grounded)
Assistant answers should be:
- Retrieval-grounded (RAG): only use retrieved sources
- Structured where possible (bullets, timelines, action items)
- Citation-backed (document + excerpt)
- Safe and policy-aware (refuse disallowed requests)

### 6.3 In-meeting assistance (required)
During live meetings, the system:
- Captures or receives live transcript chunks (or live audio → STT → transcript chunks)
- Runs streaming extraction (topics, concerns, commitments)
- Retrieves relevant prior context
- Produces **real-time prompts** such as:
  - “Unresolved commitment: ‘Follow up on role clarity’ from Jan 12.”
  - “Last time they mentioned workload spikes around release weeks—ask about current bandwidth.”

Hard requirements:
- Low latency (target p95 < 5s)
- No “invented memory” (must be grounded)
- Permission safe: if the user cannot see a source, it must not be used

## 7. UX requirements (minimal, exactly the described UX)
The product UI should include only:
1) **Dashboard**: employee selection and quick overview.
2) **Employee profile**: unified profile + timeline + prep briefing.
3) **Conversational assistant**: chat panel for prep and recall.
4) **In-meeting assistance panel**: live suggestions during meetings.

No additional pages (e.g., admin portals) are required for MVP; configuration can be file/env driven.

### 7.1 Dashboard (employee selection)
- Search/select employee.
- Show last interaction date, open items count, and key changes since last check-in.

### 7.2 Employee profile
Must show:
- Official HRMS fields (role, manager, tenure, location)
- Contextual timeline (meeting + spreadsheet derived)
- “Open loops / commitments” list
- “Prep briefing” section:
  - What changed since last check-in
  - Key themes and concerns (with citations)
  - Suggested conversation starters (with rationale)
  - Sensitive areas (if the viewer has access)

### 7.3 Conversational assistant
- Ask natural questions (e.g., “What did we last discuss?”)
- Provide concise answers with evidence.
- Offer “generate conversation starters” with explicit linkage to prior topics.

### 7.4 In-meeting assistance
- Display live transcript snippet(s) being processed (optional)
- Display 3–7 suggestions at a time, with:
  - Short suggestion text
  - “Why?” link/expand showing the citation(s)

## 8. Functional requirements
### 8.1 Ingestion & normalization
- Import employees from BambooHR.
- Ingest spreadsheets via upload or scheduled fetch.
- Ingest Zoom meetings/recordings/transcripts.
- Ingest Slack messages via API and/or events.
- Ingest Google Calendar events.
- Ingest Email (Gmail/Outlook) via API.
- Normalize all inputs into a canonical document schema.

### 8.1.1 Authentication / authorization for integrations
Most external systems require OAuth 2.0 (Slack, Google, Gmail; Outlook via Microsoft identity platform). BambooHR commonly uses API keys.

Implementation note (time-dependent):
- If time permits: implement full OAuth flows (connect button → callback → token exchange → refresh) with encrypted token storage.
- If time is constrained for MVP/demo: allow pre-configured tokens/keys via environment variables for a single org while keeping the connector interfaces compatible with OAuth later.

### 8.2 Identity resolution
- Map documents to employee(s) via email/employee_id/attendee list matching.
- Provide deterministic matching rules first; use fuzzy matching only with explicit thresholds.

### 8.3 Extraction pipeline (NLP)
From transcripts/audio-derived transcripts, Slack/Email text, and optionally spreadsheet free-text columns, extract:
- **Action items**: owner, due date (if stated), description, status
- **Commitments** (promises): who promised what
- **Topics/themes**: from a controlled taxonomy + free tags
- **Concerns**: workload, growth, conflict, recognition, etc.
- **Sentiment trend**: weak signal; store as numeric score with source reference

### 8.3.1 Speech-to-text (STT)
- If a transcript is unavailable, generate one from audio using an STT component (e.g., Whisper or a managed STT service).
- Output of STT must be chunked and stored with timestamps so in-meeting assistance can align suggestions to the conversation.

### 8.4 Retrieval (RAG)
- Store embeddings for chunks and extracted memory events.
- Query pipeline must:
  1) apply permission filters
  2) retrieve top-k relevant chunks/events
  3) synthesize response with citations

### 8.5 Permissions & audit
- Role-based access (CHRO, HRBP, People Ops).
- Attribute-based checks for sensitive categories.
- Audit log for:
  - Profile views
  - Chat queries
  - Documents ingested
  - Suggestions shown in meeting mode

### 8.6 Safety / policy behavior
- Refuse requests that ask for protected-class inference or medical/mental health diagnoses.
- Avoid “resignation prediction”; allow “signals observed” with citations.
- Provide uncertainty language when evidence is weak.

## 9. Non-functional requirements
- Security: encryption at rest and in transit; secrets not stored in code.
- Privacy: data minimization; configurable retention (e.g., delete raw transcripts after processing).
- Privacy: email/Slack ingestion must support strict scoping and retention controls (e.g., only specific mailboxes/channels, time windows).
- Reliability: idempotent ingestion jobs; reprocessing supported.
- Observability: logs + metrics for pipeline latency and retrieval quality.
- Latency targets:
  - Prep query: < 3s typical
  - In-meeting suggestions: p95 < 5s

## 10. Evaluation plan (how to prove quality)
- Groundedness: % of assistant answers containing valid citations.
- Extraction accuracy on a labeled sample: action-item F1, commitment detection F1.
- Human review rubric for “helpfulness,” “specificity,” and “tone.”
- Safety red-team prompts to ensure refusals.

## 11. Risks & mitigations
- Hallucinations → enforce RAG-only responses + citations; restrict model instructions.
- Permission leakage → permission filters in retrieval + separate vector indexes per role/sensitivity.
- “Creepy” personalization → constrain to work-relevant context and explicit categories.
- Real-time latency → streaming pipeline; prefetch retrieval context; small models for extraction.

## 12. Open questions (for later)
- Which HRMS is used in the demo (Zoho/BambooHR/etc.)?
- Transcript source: Zoom/Teams/Meet export vs API?
- Required roles and sensitivity categories for the judging scenario?
