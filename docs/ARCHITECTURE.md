# Architecture — CXO HR Intelligence Dashboard

This is a reference architecture for a **single-org** deployment that is designed to evolve into multi-tenant later.

## 1) Component overview
### Data plane
- **Connectors/Ingestion**
  - BambooHR connector (pull employees/org profile snapshots)
  - Spreadsheet ingestion (CSV/Sheets)
  - Zoom connector (meetings/recordings/transcripts)
  - Slack connector (messages + events)
  - Google Calendar connector (events/attendees)
  - Email connector (Gmail/Outlook)
- **Processing pipeline**
  - (Optional/conditional) **Speech-to-text** (audio → transcript)
  - Normalization → chunking → extraction → embeddings
  - Writes immutable `memory_events` with citations
- **Storage**
  - Operational DB (MongoDB) (employees, official profile, events, action items, permissions, audit)
  - Object store (raw docs, optional)
  - Vector store (embeddings for chunks/events)

### Serving plane
- **Profile API**
  - Gets official + contextual profile
  - Enforces permission filters
- **Assistant API (RAG)**
  - Permission-safe retrieval
  - Answer synthesis with citations
- **Meeting Assist service (streaming)**
  - Consumes live transcript chunks
  - Runs low-latency extraction + retrieval
  - Produces suggestion feed

## 2) Architecture diagram (Mermaid)
```mermaid
flowchart LR
  subgraph Sources["Sources"]
    Slack["Slack API/Events"]
    Zoom["Zoom API (meetings/recordings/transcripts)"]
    Cal["Google Calendar API"]
    HRMS["BambooHR API"]
    Email["Email APIs (Gmail/Outlook)"]
    Sheet["Spreadsheets (CSV/Sheets)"]
  end

  subgraph Ingest["Ingestion & Processing"]
    Conn["Connectors"]
    Auth["Auth + Token Store\n(OAuth2/API keys; encrypted)"]
    STT["Speech-to-text\n(audio -> transcript)"]
    Norm["Normalize + Chunk"]
    Extract["Extract events (NLP)"]
    Embed["Embed chunks/events"]
  end

  subgraph Storage["Storage"]
    DB["MongoDB\n(employees, profile, events, actions, perms, audit)"]
    Obj["Object Store\n(raw docs optional)"]
    Vec["Vector Store\n(permission metadata)"]
  end

  subgraph Serving["Serving"]
    ProfileAPI["Profile API"]
    AssistAPI["Assistant (RAG) API"]
    MeetAssist["Meeting Assist (streaming)"]
  end

  subgraph UI["UI"]
    Dash["Dashboard (employee select)"]
    ProfileUI["Employee profile + prep brief"]
    ChatUI["Conversational assistant"]
    MeetUI["In-meeting assistance panel"]
  end

  Slack --> Conn
  Zoom --> Conn
  Cal --> Conn
  HRMS --> Conn
  Email --> Conn
  Sheet --> Conn

  Conn --> Auth

  Auth --> STT
  Auth --> Norm
  STT --> Norm

  Norm --> Extract --> DB
  Norm --> Obj
  Norm --> Embed --> Vec
  Extract --> Vec

  DB --> ProfileAPI --> ProfileUI
  DB --> AssistAPI --> ChatUI
  Vec --> AssistAPI

  Zoom --> MeetAssist
  MeetAssist --> Extract
  MeetAssist --> AssistAPI
  MeetAssist --> MeetUI

  Dash --> ProfileAPI
  Dash --> AssistAPI
```

## 3) Key design decisions
- **RAG with citations**: the assistant must only use retrieved sources.
- **Event sourcing for memory**: store extracted insights as immutable `memory_events` with confidence + citations.
- **Permission enforcement**: apply at query time (DB filters) and retrieval time (vector metadata filters or index partitioning).
- **Retention controls**: live transcript chunks can be short-lived; events persist.

## 4) In-meeting assistance (latency strategy)
- Process transcript in small chunks (e.g., 5–15 seconds of text).
- Use a lightweight extractor model for event detection; defer heavy summarization.
- Prefetch employee context embeddings at meeting start.
- Produce suggestions in batches, capped (3–7) to reduce overload.

STT-specific notes:
- If live audio is used, run STT in streaming mode and emit timestamped transcript chunks.
- If Zoom provides transcripts, prefer those to reduce latency/cost.
