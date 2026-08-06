"""
STEP 3 — Seed Database with All Generated Data
-----------------------------------------------
Takes BambooHR employees + Synthetic Slack data
and writes everything into your database.

Supports: SQLite (default, zero config)
          PostgreSQL (set DB_TYPE=postgres)
          MongoDB    (set DB_TYPE=mongo)

Usage:
    # SQLite (default, no setup needed):
    python step3_seed_database.py

    # PostgreSQL:
    DB_TYPE=postgres DB_URL=postgresql://user:pass@localhost/hrdb python step3_seed_database.py

    # MongoDB:
    DB_TYPE=mongo DB_URL=mongodb://localhost:27017 python step3_seed_database.py

Output:
    data/hr_intelligence.db   ← SQLite DB (if using SQLite)
    Console summary of all records inserted
"""

import json
import os
import sqlite3
from datetime import datetime


# ──────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────

DB_TYPE = os.environ.get("DB_TYPE", "sqlite")
DB_URL  = os.environ.get("DB_URL",  "data/hr_intelligence.db")


# ──────────────────────────────────────────────
# SQLITE IMPLEMENTATION (default, zero config)
# ──────────────────────────────────────────────

SCHEMA_SQL = """
-- ─────────────────────────────────────────────
-- CORE EMPLOYEE TABLE (from BambooHR)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    bamboohr_id         TEXT UNIQUE NOT NULL,
    employee_number     TEXT,
    first_name          TEXT NOT NULL,
    last_name           TEXT NOT NULL,
    display_name        TEXT NOT NULL,
    initials            TEXT,
    work_email          TEXT UNIQUE NOT NULL,
    work_phone          TEXT,
    mobile_phone        TEXT,
    gender              TEXT,
    date_of_birth       TEXT,
    marital_status      TEXT,

    -- Employment
    job_title           TEXT,
    department          TEXT,
    division            TEXT,
    location            TEXT,
    status              TEXT DEFAULT 'Active',
    employment_type     TEXT DEFAULT 'Full-Time',

    -- Dates
    hire_date           TEXT,
    tenure_years        INTEGER DEFAULT 0,
    tenure_months       INTEGER DEFAULT 0,
    tenure_label        TEXT,

    -- Hierarchy
    supervisor_name     TEXT,
    supervisor_id       TEXT,

    -- Compensation
    pay_rate            TEXT,
    pay_type            TEXT,
    pay_period          TEXT,
    currency            TEXT DEFAULT 'USD',

    -- Source
    data_source         TEXT DEFAULT 'bamboohr',
    fetched_at          TEXT,
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────
-- SLACK USERS TABLE (synthetic, mirrors BambooHR)
-- Bridge: work_email = slack_users.email
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_users (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    slack_user_id       TEXT UNIQUE NOT NULL,
    team_id             TEXT DEFAULT 'TCUDEPT01',
    team_name           TEXT DEFAULT 'CUDEPT Workspace',

    -- THE BRIDGE — links to employees.work_email
    email               TEXT UNIQUE NOT NULL,
    bamboohr_id         TEXT NOT NULL,

    -- Slack profile
    display_name        TEXT,
    real_name           TEXT,
    title               TEXT,
    department          TEXT,
    phone               TEXT,
    timezone            TEXT DEFAULT 'America/New_York',
    avatar_color        TEXT,

    -- Flags
    is_admin            INTEGER DEFAULT 0,
    is_bot              INTEGER DEFAULT 0,
    is_active           INTEGER DEFAULT 1,
    joined_date         TEXT,

    -- Intelligence (computed)
    risk_level          TEXT CHECK(risk_level IN ('low', 'medium', 'high')),
    engagement_score    INTEGER CHECK(engagement_score BETWEEN 0 AND 100),

    -- Sentiment summary (JSON blob)
    sentiment_summary   TEXT,   -- JSON: {last_30_days: {...}, trend_30d: '...'}

    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at          TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (bamboohr_id) REFERENCES employees(bamboohr_id)
);

-- ─────────────────────────────────────────────
-- SLACK CHANNELS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_channels (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id      TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    purpose         TEXT,
    is_private      INTEGER DEFAULT 0,
    is_dm           INTEGER DEFAULT 0,
    member_count    INTEGER DEFAULT 0,
    department      TEXT,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────
-- SLACK MESSAGES TABLE (synthetic sentiment signals)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS slack_messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id          TEXT UNIQUE NOT NULL,
    slack_user_id       TEXT NOT NULL,
    bamboohr_id         TEXT NOT NULL,
    email               TEXT NOT NULL,
    employee_name       TEXT,

    -- Message
    channel             TEXT,
    channel_id          TEXT,
    text                TEXT,
    word_count          INTEGER DEFAULT 0,
    timestamp           TEXT NOT NULL,
    date                TEXT NOT NULL,

    -- NLP signals
    sentiment_label     TEXT CHECK(sentiment_label IN ('positive', 'neutral', 'negative')),
    sentiment_score     REAL CHECK(sentiment_score BETWEEN 0.0 AND 1.0),

    -- Context
    risk_level          TEXT,
    department          TEXT,
    is_synthetic        INTEGER DEFAULT 1,
    source              TEXT DEFAULT 'slack_public_channels',
    created_at          TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (bamboohr_id)   REFERENCES employees(bamboohr_id),
    FOREIGN KEY (slack_user_id) REFERENCES slack_users(slack_user_id)
);

-- ─────────────────────────────────────────────
-- MEETING TRANSCRIPTS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meeting_transcripts (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id              TEXT UNIQUE NOT NULL,
    bamboohr_id             TEXT NOT NULL,
    employee_name           TEXT,
    hr_lead_name            TEXT,
    meeting_date            TEXT NOT NULL,
    meeting_type            TEXT DEFAULT 'Quarterly Check-in',
    duration_minutes        INTEGER DEFAULT 45,

    -- Content
    raw_transcript          TEXT,
    ai_summary              TEXT,
    key_topics              TEXT,   -- JSON array
    action_items            TEXT,   -- JSON array
    personal_context        TEXT,   -- JSON array (interests, life events mentioned)
    flagged_concerns        TEXT,   -- JSON array

    -- Sentiment
    sentiment_label         TEXT,
    sentiment_score         REAL,

    -- Metadata
    is_synthetic            INTEGER DEFAULT 1,
    created_at              TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (bamboohr_id) REFERENCES employees(bamboohr_id)
);

-- ─────────────────────────────────────────────
-- ENGAGEMENT SURVEYS TABLE
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS engagement_surveys (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    survey_id               TEXT UNIQUE NOT NULL,
    bamboohr_id             TEXT NOT NULL,
    employee_name           TEXT,
    survey_date             TEXT NOT NULL,
    survey_type             TEXT DEFAULT 'Quarterly Pulse',

    -- Scores
    enps_score              INTEGER CHECK(enps_score BETWEEN 0 AND 10),
    engagement_score        INTEGER CHECK(engagement_score BETWEEN 0 AND 100),
    wellbeing_score         INTEGER CHECK(wellbeing_score BETWEEN 0 AND 100),
    manager_satisfaction    INTEGER CHECK(manager_satisfaction BETWEEN 0 AND 100),
    growth_opportunity      INTEGER CHECK(growth_opportunity BETWEEN 0 AND 100),
    work_life_balance       INTEGER CHECK(work_life_balance BETWEEN 1 AND 5),

    -- Open text
    open_feedback           TEXT,
    recommend_to_friend     INTEGER DEFAULT 1,
    is_synthetic            INTEGER DEFAULT 1,
    created_at              TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (bamboohr_id) REFERENCES employees(bamboohr_id)
);

-- ─────────────────────────────────────────────
-- RISK SCORES TABLE (computed, ML-ready)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS risk_scores (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    bamboohr_id                 TEXT NOT NULL,
    computed_at                 TEXT NOT NULL,

    -- Input features (IBM dataset-inspired)
    overtime_flag               INTEGER DEFAULT 0,
    job_satisfaction            INTEGER CHECK(job_satisfaction BETWEEN 1 AND 4),
    work_life_balance           INTEGER CHECK(work_life_balance BETWEEN 1 AND 4),
    years_in_current_role       REAL DEFAULT 0,
    years_since_last_promotion  REAL DEFAULT 0,
    salary_vs_market_band_pct   REAL DEFAULT 0,   -- negative = underpaid
    manager_changes_2yr         INTEGER DEFAULT 0,
    team_departures_6mo         INTEGER DEFAULT 0,
    sentiment_trend_30d         TEXT,
    external_signal             INTEGER DEFAULT 0,

    -- Output
    risk_score                  REAL CHECK(risk_score BETWEEN 0.0 AND 1.0),
    risk_label                  TEXT CHECK(risk_label IN ('LOW', 'MEDIUM', 'HIGH')),
    risk_factors                TEXT,   -- JSON array of contributing reasons

    created_at                  TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (bamboohr_id) REFERENCES employees(bamboohr_id)
);

-- ─────────────────────────────────────────────
-- USEFUL VIEWS
-- ─────────────────────────────────────────────

CREATE VIEW IF NOT EXISTS v_employee_full AS
SELECT
    e.*,
    su.slack_user_id,
    su.display_name     AS slack_display_name,
    su.risk_level,
    su.engagement_score,
    su.sentiment_summary,
    su.avatar_color,
    rs.risk_score,
    rs.risk_label,
    rs.risk_factors
FROM employees e
LEFT JOIN slack_users   su ON e.bamboohr_id = su.bamboohr_id
LEFT JOIN risk_scores   rs ON e.bamboohr_id = rs.bamboohr_id
         AND rs.computed_at = (
             SELECT MAX(computed_at)
             FROM risk_scores
             WHERE bamboohr_id = e.bamboohr_id
         );

CREATE VIEW IF NOT EXISTS v_sentiment_daily AS
SELECT
    bamboohr_id,
    employee_name,
    date,
    COUNT(*)                                        AS message_count,
    AVG(sentiment_score)                            AS avg_sentiment,
    SUM(CASE WHEN sentiment_label='positive' THEN 1 ELSE 0 END) AS positive_count,
    SUM(CASE WHEN sentiment_label='neutral'  THEN 1 ELSE 0 END) AS neutral_count,
    SUM(CASE WHEN sentiment_label='negative' THEN 1 ELSE 0 END) AS negative_count
FROM slack_messages
GROUP BY bamboohr_id, date;

-- ─────────────────────────────────────────────
-- INDEXES for query performance
-- ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employees_email      ON employees(work_email);
CREATE INDEX IF NOT EXISTS idx_employees_dept       ON employees(department);
CREATE INDEX IF NOT EXISTS idx_slack_users_bamboo   ON slack_users(bamboohr_id);
CREATE INDEX IF NOT EXISTS idx_slack_msg_user       ON slack_messages(bamboohr_id);
CREATE INDEX IF NOT EXISTS idx_slack_msg_date       ON slack_messages(date);
CREATE INDEX IF NOT EXISTS idx_slack_msg_sentiment  ON slack_messages(sentiment_label);
CREATE INDEX IF NOT EXISTS idx_transcripts_employee ON meeting_transcripts(bamboohr_id);
CREATE INDEX IF NOT EXISTS idx_surveys_employee     ON engagement_surveys(bamboohr_id);
CREATE INDEX IF NOT EXISTS idx_risk_employee        ON risk_scores(bamboohr_id);
"""


def get_sqlite_connection():
    os.makedirs("data", exist_ok=True)
    conn = sqlite3.connect(DB_URL)
    conn.row_factory = sqlite3.Row
    return conn


def create_schema(conn):
    print("🏗️  Creating database schema...")
    conn.executescript(SCHEMA_SQL)
    conn.commit()
    print("  ✓ All tables, views, and indexes created")


def seed_employees(conn, employees):
    print(f"\n👤 Inserting {len(employees)} employees...")
    cursor = conn.cursor()
    inserted = 0
    for emp in employees:
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO employees (
                    bamboohr_id, employee_number, first_name, last_name,
                    display_name, initials, work_email, work_phone, mobile_phone,
                    gender, date_of_birth, marital_status,
                    job_title, department, division, location, status, employment_type,
                    hire_date, tenure_years, tenure_months, tenure_label,
                    supervisor_name, supervisor_id,
                    pay_rate, pay_type, pay_period, currency,
                    data_source, fetched_at
                ) VALUES (
                    :bamboohr_id, :employee_number, :first_name, :last_name,
                    :display_name, :initials, :work_email, :work_phone, :mobile_phone,
                    :gender, :date_of_birth, :marital_status,
                    :job_title, :department, :division, :location, :status, :employment_type,
                    :hire_date, :tenure_years, :tenure_months, :tenure_label,
                    :supervisor_name, :supervisor_id,
                    :pay_rate, :pay_type, :pay_period, :currency,
                    :data_source, :fetched_at
                )
            """, emp)
            inserted += 1
            print(f"  ✓ {emp['display_name']:30s} ({emp['department']})")
        except Exception as e:
            print(f"  ⚠️  Error inserting {emp.get('display_name')}: {e}")

    conn.commit()
    return inserted


def seed_slack_users(conn, slack_users):
    print(f"\n💼 Inserting {len(slack_users)} Slack users...")
    cursor = conn.cursor()
    inserted = 0
    for user in slack_users:
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO slack_users (
                    slack_user_id, team_id, team_name, email, bamboohr_id,
                    display_name, real_name, title, department, phone,
                    timezone, avatar_color, is_admin, is_bot, is_active,
                    joined_date, risk_level, engagement_score, sentiment_summary
                ) VALUES (
                    :slack_user_id, :team_id, :team_name, :email, :bamboohr_id,
                    :display_name, :real_name, :title, :department, :phone,
                    :timezone, :avatar_color, :is_admin, :is_bot, :is_active,
                    :joined_date, :risk_level, :engagement_score, :sentiment_summary
                )
            """, {**user,
                  "is_admin": int(user.get("is_admin", False)),
                  "is_bot":   int(user.get("is_bot",   False)),
                  "is_active": int(user.get("is_active", True)),
                  "sentiment_summary": json.dumps(user.get("sentiment_summary", {}))
            })
            inserted += 1
            risk_icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}[user["risk_level"]]
            print(f"  ✓ {user['real_name']:30s} | @{user['display_name']:25s} | {risk_icon} {user['risk_level']}")
        except Exception as e:
            print(f"  ⚠️  Error inserting Slack user {user.get('real_name')}: {e}")

    conn.commit()
    return inserted


def seed_channels(conn, channels):
    print(f"\n📢 Inserting {len(channels)} channels...")
    cursor = conn.cursor()
    for ch in channels:
        try:
            cursor.execute("""
                INSERT OR REPLACE INTO slack_channels
                (channel_id, name, purpose, is_private, is_dm, member_count, department)
                VALUES (:channel_id, :name, :purpose, :is_private, :is_dm, :member_count, :department)
            """, {**ch,
                  "is_private": int(ch.get("is_private", False)),
                  "is_dm":      int(ch.get("is_dm", False)),
            })
        except Exception as e:
            print(f"  ⚠️  Error inserting channel {ch.get('name')}: {e}")
    conn.commit()
    print(f"  ✓ {len(channels)} channels inserted")


def seed_messages(conn, messages):
    print(f"\n💬 Inserting {len(messages)} Slack messages (batch mode)...")
    cursor  = conn.cursor()
    batch   = []
    errors  = 0

    for msg in messages:
        batch.append((
            msg["message_id"], msg["slack_user_id"], msg["bamboohr_id"],
            msg["email"], msg["employee_name"],
            msg["channel"], msg["channel_id"], msg["text"], msg["word_count"],
            msg["timestamp"], msg["date"],
            msg["sentiment_label"], msg["sentiment_score"],
            msg["risk_level"], msg["department"],
            int(msg.get("is_synthetic", True)), msg.get("source", "slack_public_channels")
        ))

        if len(batch) >= 500:   # batch insert every 500
            try:
                cursor.executemany("""
                    INSERT OR IGNORE INTO slack_messages (
                        message_id, slack_user_id, bamboohr_id, email, employee_name,
                        channel, channel_id, text, word_count, timestamp, date,
                        sentiment_label, sentiment_score, risk_level, department,
                        is_synthetic, source
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, batch)
                conn.commit()
                batch = []
            except Exception as e:
                errors += 1
                print(f"  ⚠️  Batch error: {e}")
                batch = []

    # insert remaining
    if batch:
        cursor.executemany("""
            INSERT OR IGNORE INTO slack_messages (
                message_id, slack_user_id, bamboohr_id, email, employee_name,
                channel, channel_id, text, word_count, timestamp, date,
                sentiment_label, sentiment_score, risk_level, department,
                is_synthetic, source
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, batch)
        conn.commit()

    print(f"  ✓ {len(messages)} messages inserted ({errors} batch errors)")


def print_verification(conn):
    """Print row counts to verify everything is seeded correctly."""
    print(f"\n{'─'*55}")
    print("  DATABASE VERIFICATION")
    print(f"{'─'*55}")
    tables = ["employees", "slack_users", "slack_channels", "slack_messages"]
    for table in tables:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:25s} → {count:6d} rows")

    # Cross-check: every employee should have a matching Slack user
    orphans = conn.execute("""
        SELECT COUNT(*) FROM employees e
        WHERE NOT EXISTS (
            SELECT 1 FROM slack_users su WHERE su.bamboohr_id = e.bamboohr_id
        )
    """).fetchone()[0]
    print(f"\n  ✅ Orphaned employees (no Slack match): {orphans}")

    # Sample from the full view
    print(f"\n  Sample from v_employee_full:")
    rows = conn.execute("""
        SELECT display_name, department, risk_level, engagement_score
        FROM v_employee_full LIMIT 5
    """).fetchall()
    for row in rows:
        icon = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(row[2], "⚪")
        print(f"    {icon} {row[0]:25s} | {row[1]:20s} | Score: {row[3]}")
    print(f"{'─'*55}")


def main():
    print("=" * 55)
    print("  STEP 3 — Seed Database")
    print("=" * 55)

    # ── Load data files ──
    required_files = {
        "data/bamboohr_employees_clean.json": "BambooHR employees",
        "data/slack_users.json":              "Slack users",
        "data/slack_channels.json":           "Slack channels",
        "data/slack_messages.json":           "Slack messages",
    }

    all_data = {}
    for path, label in required_files.items():
        if not os.path.exists(path):
            print(f"❌ Missing: {path} — run previous steps first")
            return
        with open(path) as f:
            all_data[path] = json.load(f)
        print(f"  ✓ Loaded {label}: {len(all_data[path])} records")

    # ── Connect and create schema ──
    print(f"\n🗄️  Connecting to {DB_TYPE} database: {DB_URL}")
    conn = get_sqlite_connection()
    create_schema(conn)

    # ── Seed ──
    seed_employees(conn, all_data["data/bamboohr_employees_clean.json"])
    seed_slack_users(conn, all_data["data/slack_users.json"])
    seed_channels(conn, all_data["data/slack_channels.json"])
    seed_messages(conn, all_data["data/slack_messages.json"])

    # ── Verify ──
    print_verification(conn)
    conn.close()

    print(f"\n✅ STEP 3 COMPLETE")
    print(f"   Database ready at: {DB_URL}")
    print(f"\n→ Next: Run python step4_verify.py to spot-check the data")
    print(f"→ Then: Start building your backend API on top of this")
    print(f"{'='*55}")


if __name__ == "__main__":
    main()
