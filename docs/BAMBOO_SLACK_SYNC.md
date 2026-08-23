# HR Intelligence — Data Pipeline
## BambooHR → Synthetic Slack → Database

---

## What This Does

```
BambooHR Trial API
    ↓  (real employee data OR demo fallback)
step1_fetch_bamboohr.py
    ↓  data/bamboohr_employees_clean.json
step2_generate_slack.py
    ↓  data/slack_users.json
    ↓  data/slack_channels.json
    ↓  data/slack_messages.json
step3_seed_database.py
    ↓  data/hr_intelligence.db  ← your unified database
step4_verify.py
    ↓  consistency checks + spot check output
```

Every BambooHR employee gets:
- A matching Slack user (same email = the bridge)
- 90 days of synthetic message history
- Sentiment signals consistent with their risk profile
- Stored in a unified SQLite database ready for your API

---

## Setup

```bash
pip install requests python-dateutil
```

---

## Run Order

```bash
# 1. Fetch from BambooHR
#    Set your credentials first:
export BAMBOOHR_COMPANY=cudept
export BAMBOOHR_API_KEY=your_key_here
export BAMBOOHR_API_BASE=https://api.bamboohr.com/api/gateway.php
python step1_fetch_bamboohr.py

# Or place the same keys in integrations/bamboo-slack-sync/.env
# (step1 also auto-loads backend/.env if present)

# 2. Generate synthetic Slack data
python step2_generate_slack.py

# 3. Seed the database
python step3_seed_database.py

# 4. Verify everything is consistent
python step4_verify.py
```

---

## No API Key Yet?

Just run the scripts — step1 has a demo fallback with 8
realistic employees that mirrors BambooHR's trial data.
The rest of the pipeline works identically.

---

## Database Tables

| Table               | Source      | Records         |
|---------------------|-------------|-----------------|
| employees           | BambooHR    | 1 per employee  |
| slack_users         | Synthetic   | 1 per employee  |
| slack_channels      | Synthetic   | ~12-15 channels |
| slack_messages      | Synthetic   | ~40-65 per user |
| meeting_transcripts | Synthetic   | (step 5)        |
| engagement_surveys  | Synthetic   | (step 5)        |
| risk_scores         | Computed    | (step 5)        |

## Key Bridge

```
employees.work_email == slack_users.email
employees.bamboohr_id == slack_users.bamboohr_id
```

Both fields link every Slack record back to its BambooHR source.
