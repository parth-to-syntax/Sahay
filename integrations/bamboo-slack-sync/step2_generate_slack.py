"""
STEP 2 — Generate Synthetic Slack Data from BambooHR Employees
---------------------------------------------------------------
Reads bamboohr_employees_clean.json and creates:
  - One Slack user per BambooHR employee (same email = bridge)
  - 90 days of Slack message history per employee
  - Sentiment consistent with assigned risk profile
  - Channels matching their department

Usage:
    python step2_generate_slack.py

Input:
    data/bamboohr_employees_clean.json

Output:
    data/slack_users.json
    data/slack_messages.json
    data/slack_channels.json
"""

import json
import random
import string
import os
from datetime import datetime, timedelta, date


# ──────────────────────────────────────────────
# RISK ASSIGNMENT
# Rules based on BambooHR data patterns
# ──────────────────────────────────────────────

def assign_risk_profile(employee):
    """
    Derive risk level from BambooHR data.
    In a real system this would be an ML model.
    For synthetic data we use deterministic rules.
    """
    tenure_years  = employee.get("tenure_years", 0)
    tenure_months = employee.get("tenure_months", 0)
    job_title     = employee.get("job_title", "").lower()
    department    = employee.get("department", "").lower()

    total_months = tenure_years * 12 + tenure_months

    # Director/Executive level → watch carefully
    is_senior = any(w in job_title for w in ["director", "chief", "vp", "head", "lead"])
    # New joiners (< 12 months) → higher risk
    is_new = total_months < 12
    # Long tenure (> 48 months) → stable
    is_veteran = total_months > 48
    # Sales → naturally higher attrition
    is_sales = "sales" in department

    if is_new and is_sales:
        return "high"
    elif is_senior and total_months < 30:
        return "medium"
    elif is_new:
        return "medium"
    elif is_veteran:
        return "low"
    elif is_sales:
        return "medium"
    else:
        return "low"


def assign_engagement_score(risk_level):
    """Generate a realistic engagement score based on risk."""
    ranges = {
        "low":    (75, 95),
        "medium": (50, 74),
        "high":   (20, 49),
    }
    lo, hi = ranges[risk_level]
    return random.randint(lo, hi)


# ──────────────────────────────────────────────
# SLACK USER GENERATOR
# ──────────────────────────────────────────────

def make_slack_id(prefix="U"):
    """Generate a realistic-looking Slack user ID."""
    return prefix + "".join(random.choices(string.ascii_uppercase + string.digits, k=9))


AVATAR_COLORS = [
    "#7C3AED", "#0891B2", "#059669", "#DC2626",
    "#D97706", "#2563EB", "#DB2777", "#0D9488",
]


def create_slack_user(bamboohr_employee, index):
    """
    Create a synthetic Slack user that mirrors a BambooHR employee.
    The email address is the bridge between both systems.
    """
    first = bamboohr_employee["first_name"].lower()
    last  = bamboohr_employee["last_name"].lower()
    email = bamboohr_employee["work_email"]

    # If email is empty, generate one
    if not email:
        email = f"{first}.{last}@cudept.com"

    risk_level       = assign_risk_profile(bamboohr_employee)
    engagement_score = assign_engagement_score(risk_level)

    return {
        # ── Slack identity ──
        "slack_user_id":  make_slack_id("U"),
        "team_id":        "TCUDEPT01",
        "team_name":      "CUDEPT Workspace",

        # ── THE BRIDGE — must match BambooHR exactly ──
        "email":          email,
        "bamboohr_id":    bamboohr_employee["bamboohr_id"],
        "employee_number": bamboohr_employee["employee_number"],

        # ── Slack profile ──
        "real_name":      bamboohr_employee["display_name"],
        "display_name":   f"{first}.{last}",
        "first_name":     bamboohr_employee["first_name"],
        "last_name":      bamboohr_employee["last_name"],
        "initials":       bamboohr_employee["initials"],
        "title":          bamboohr_employee["job_title"],
        "department":     bamboohr_employee["department"],
        "phone":          bamboohr_employee.get("work_phone", ""),

        # ── Slack metadata ──
        "is_admin":       bamboohr_employee["job_title"].lower() in
                          ["chief hr officer", "chro", "ceo", "cto", "coo"],
        "is_bot":         False,
        "is_active":      bamboohr_employee["status"] == "Active",
        "timezone":       "America/New_York",
        "joined_date":    bamboohr_employee["hire_date"],

        # ── Intelligence layer (computed) ──
        "risk_level":        risk_level,
        "engagement_score":  engagement_score,
        "avatar_color":      AVATAR_COLORS[index % len(AVATAR_COLORS)],

        # ── Timestamps ──
        "created_at":  datetime.now().isoformat(),
        "updated_at":  datetime.now().isoformat(),
    }


# ──────────────────────────────────────────────
# CHANNEL GENERATOR
# ──────────────────────────────────────────────

BASE_CHANNELS = [
    {"name": "general",         "purpose": "Company-wide announcements and conversations"},
    {"name": "random",          "purpose": "Non-work banter and fun"},
    {"name": "watercooler",     "purpose": "Casual chats"},
    {"name": "leadership-team", "purpose": "Leadership discussions"},
    {"name": "hr-updates",      "purpose": "HR announcements and policy updates"},
]

DEPT_CHANNEL_MAP = {
    "Engineering":      ["engineering", "tech-talk", "code-reviews", "deployments"],
    "Product":          ["product", "roadmap", "feature-ideas"],
    "Analytics":        ["data-team", "analytics", "insights"],
    "Sales":            ["sales", "wins", "pipeline-review"],
    "Human Resources":  ["hr-team", "people-ops"],
    "Design":           ["design", "ux-research", "design-critique"],
    "Finance":          ["finance", "budget-planning"],
    "Marketing":        ["marketing", "campaigns", "growth"],
}


def create_channels(employees):
    """Generate all Slack channels based on departments present."""
    channels = []
    channel_id_map = {}

    # Add base channels
    for ch in BASE_CHANNELS:
        ch_id = make_slack_id("C")
        channels.append({
            "channel_id":   ch_id,
            "name":         ch["name"],
            "purpose":      ch["purpose"],
            "is_private":   False,
            "is_dm":        False,
            "member_count": len(employees),
            "department":   None,
            "created_at":   "2019-01-01T00:00:00",
        })
        channel_id_map[ch["name"]] = ch_id

    # Add department channels
    departments = set(e["department"] for e in employees if e["department"])
    for dept in departments:
        dept_channels = DEPT_CHANNEL_MAP.get(dept, [dept.lower().replace(" ", "-")])
        for ch_name in dept_channels:
            ch_id = make_slack_id("C")
            dept_members = [e for e in employees if e["department"] == dept]
            channels.append({
                "channel_id":   ch_id,
                "name":         ch_name,
                "purpose":      f"Channel for {dept} team",
                "is_private":   False,
                "is_dm":        False,
                "member_count": len(dept_members),
                "department":   dept,
                "created_at":   "2019-01-01T00:00:00",
            })
            channel_id_map[ch_name] = ch_id

    return channels, channel_id_map


def get_channels_for_employee(employee, channel_id_map):
    """Return list of channel names this employee would post in."""
    dept        = employee.get("department", "")
    dept_chs    = DEPT_CHANNEL_MAP.get(dept, [])
    base        = ["general", "random", "watercooler"]
    all_chs     = base + dept_chs

    # Senior people also post in leadership
    job_title = employee.get("job_title", "").lower()
    if any(w in job_title for w in ["chief", "director", "vp", "head"]):
        all_chs.append("leadership-team")

    # HR people post in hr-updates
    if dept == "Human Resources":
        all_chs.append("hr-updates")

    # Filter to only channels that exist
    return [ch for ch in all_chs if ch in channel_id_map]


# ──────────────────────────────────────────────
# MESSAGE TEMPLATES (by sentiment + department)
# ──────────────────────────────────────────────

MESSAGES = {
    "positive": {
        "Engineering": [
            "Just merged the PR — the new auth flow is clean ✅",
            "Great sprint review today, team is shipping fast 🚀",
            "Fixed that nasty memory leak, performance up 40%",
            "Really enjoying the new architecture decisions",
            "Code review done — excellent work from everyone this week",
            "Deployment went smooth, zero downtime 🎉",
            "The new CI pipeline is saving us so much time",
        ],
        "Product": [
            "User interviews this week were incredibly insightful",
            "Roadmap is shaping up really well for Q3",
            "The feature we shipped is getting great feedback!",
            "Alignment session with eng went really well today",
            "Customer NPS jumped 12 points after the last release 📈",
            "Really proud of how the team executed this sprint",
        ],
        "Analytics": [
            "The new dashboard is live — early feedback is great",
            "Model accuracy improved to 94% — huge win 🎯",
            "Data pipeline running 3x faster after yesterday's optimization",
            "Stakeholders loved the insights deck this morning",
            "Found a really interesting pattern in the retention data",
        ],
        "Sales": [
            "Closed the Henderson account today! 🎉 Big one",
            "Pipeline looks strong heading into Q4",
            "Great call with the enterprise prospect — very warm",
            "Hit 108% of target this month, let's keep going!",
            "New demo flow is landing really well with prospects",
        ],
        "Human Resources": [
            "Onboarding session this morning went really smoothly",
            "Engagement survey results just came in — trending up!",
            "Really positive response to the new flex-time policy",
            "Had a great check-in session with the engineering team",
            "Culture initiatives are getting great traction 🌟",
        ],
        "Design": [
            "User testing session was super productive today",
            "The new design system is coming together beautifully",
            "Component library is saving the team hours every week",
            "Client loved the mockups we presented! Moving forward",
            "Just wrapped up the rebrand assets — feeling really good about it",
        ],
        "default": [
            "Really productive week, feeling great about our progress",
            "Great team collaboration this sprint!",
            "Just finished a really satisfying piece of work",
            "Loving the direction we're heading in",
            "Shoutout to the team — crushing it lately 🙌",
        ],
    },
    "neutral": {
        "Engineering": [
            "PR is up for review when anyone has a moment",
            "Pushing the hotfix to staging for testing",
            "Updated the API docs with the new endpoints",
            "Standup notes are in Confluence",
            "Taking a half day Friday, coverage is sorted",
            "Running the weekly performance checks now",
        ],
        "Product": [
            "Sprint planning notes shared in the doc",
            "Stakeholder sync moved to Thursday",
            "Updated the roadmap with the latest priorities",
            "Requirements doc is ready for review",
            "Scheduling user interviews for next week",
        ],
        "Analytics": [
            "Weekly report is in the shared drive",
            "Running the monthly data refresh now",
            "Updated the dashboard with last week's numbers",
            "Data sync completed successfully",
            "Scheduling the model retraining for tonight",
        ],
        "Sales": [
            "Pipeline updated in Salesforce",
            "Call notes from today's demos are in the CRM",
            "Following up with the prospects from last week",
            "Scheduling QBR prep for next Tuesday",
            "Updated the deck with the new case studies",
        ],
        "Human Resources": [
            "Policy docs updated in the handbook",
            "Interview slots sent out for the open roles",
            "Payroll processing running on schedule",
            "Benefits enrollment reminder sent to all",
            "Org chart updated with the new hires",
        ],
        "default": [
            "Notes from today's meeting are in the doc",
            "Taking PTO next Monday, all covered",
            "Deadline moved to end of week",
            "Weekly sync notes shared",
            "Blocked on external dependency, following up",
        ],
    },
    "negative": {
        "Engineering": [
            "Third production issue this week, something is wrong upstream 😩",
            "Been stuck on this for 4 hours, not sure what's going on",
            "The technical debt is really starting to slow us down",
            "Requirements keep changing mid-sprint, hard to deliver quality",
            "Really frustrated with the deployment process right now",
            "Not enough time to do this properly, always rushing",
        ],
        "Product": [
            "Stakeholders keep shifting priorities — hard to build anything",
            "Feeling really disconnected from the actual users lately",
            "Another sprint where we couldn't ship what we planned",
            "The approval process is killing our velocity",
            "Roadmap changes again — team morale is suffering",
        ],
        "Analytics": [
            "Data quality issues are blocking the entire team right now",
            "Spent all week cleaning data instead of actual analysis",
            "Stakeholders don't seem to understand what we actually do here",
            "The tooling we have is really not fit for purpose anymore",
            "Feeling like insights are going nowhere, what's the point",
        ],
        "Sales": [
            "Quota increased again but no additional support, not sure how to feel",
            "Lost another deal to a competitor on pricing, frustrating",
            "Been a really tough month, not much going right",
            "Feeling pretty burnt out honestly, need a break",
            "The territory restructure is making things really difficult",
        ],
        "Human Resources": [
            "Three open roles unfilled for months, team is stretched",
            "Getting a lot of escalations this week, bandwidth is low",
            "The new system rollout is creating more problems than it solves",
            "Employees keep raising the same issues, leadership isn't listening",
        ],
        "default": [
            "Not the best week honestly, feeling stretched thin",
            "Bandwidth is really low, struggling to keep up",
            "Not sure if I have capacity for another project",
            "Feeling a bit lost on the direction we're going",
            "Really long few weeks, looking forward to some time off",
        ],
    },
}


def pick_message(sentiment, department):
    """Pick a random message for sentiment + department."""
    dept_messages = MESSAGES[sentiment].get(department, MESSAGES[sentiment]["default"])
    return random.choice(dept_messages)


# ──────────────────────────────────────────────
# MESSAGE GENERATOR
# ──────────────────────────────────────────────

SENTIMENT_DISTRIBUTION = {
    "low":    {"positive": 0.65, "neutral": 0.30, "negative": 0.05},
    "medium": {"positive": 0.40, "neutral": 0.35, "negative": 0.25},
    "high":   {"positive": 0.15, "neutral": 0.30, "negative": 0.55},
}

SENTIMENT_SCORES = {
    "positive": (0.65, 0.97),
    "neutral":  (0.38, 0.64),
    "negative": (0.03, 0.37),
}


def pick_sentiment(risk_level):
    """Pick a sentiment label based on risk distribution."""
    dist = SENTIMENT_DISTRIBUTION[risk_level]
    rand = random.random()
    if rand < dist["positive"]:
        return "positive"
    elif rand < dist["positive"] + dist["neutral"]:
        return "neutral"
    else:
        return "negative"


def generate_messages_for_user(slack_user, channel_id_map, days=90):
    """
    Generate 90 days of Slack message history for one employee.
    Sentiment distribution is tied to their risk level.
    """
    messages       = []
    risk_level     = slack_user["risk_level"]
    department     = slack_user["department"]
    available_chs  = get_channels_for_employee(slack_user, channel_id_map)

    if not available_chs:
        available_chs = ["general"]

    today = date.today()

    for day_offset in range(days):
        msg_date = today - timedelta(days=day_offset)

        # Skip weekends — people rarely message on weekends
        if msg_date.weekday() >= 5:
            continue

        # ~65% chance of posting on any given workday
        if random.random() > 0.65:
            continue

        # Some days people post 2-3 messages
        num_messages = random.choices([1, 2, 3], weights=[0.65, 0.25, 0.10])[0]

        for _ in range(num_messages):
            sentiment_label = pick_sentiment(risk_level)
            score_lo, score_hi = SENTIMENT_SCORES[sentiment_label]
            sentiment_score = round(random.uniform(score_lo, score_hi), 4)

            text    = pick_message(sentiment_label, department)
            channel = random.choice(available_chs)

            # Random posting time during work hours (9am–6pm)
            post_hour   = random.randint(9, 17)
            post_minute = random.randint(0, 59)
            post_second = random.randint(0, 59)
            post_dt     = datetime(
                msg_date.year, msg_date.month, msg_date.day,
                post_hour, post_minute, post_second
            )

            messages.append({
                # ── Identifiers ──
                "message_id":      f"MSG-{make_slack_id('')}",
                "slack_user_id":   slack_user["slack_user_id"],
                "bamboohr_id":     slack_user["bamboohr_id"],
                "email":           slack_user["email"],
                "employee_name":   slack_user["real_name"],

                # ── Message ──
                "channel":         channel,
                "channel_id":      channel_id_map.get(channel, "CUNKNOWN"),
                "text":            text,
                "word_count":      len(text.split()),
                "timestamp":       post_dt.isoformat(),
                "date":            msg_date.isoformat(),

                # ── NLP Signals (pre-computed) ──
                "sentiment_label": sentiment_label,
                "sentiment_score": sentiment_score,
                "risk_level":      risk_level,
                "department":      department,

                # ── Metadata ──
                "is_synthetic":   True,
                "source":         "slack_public_channels",
                "created_at":     datetime.now().isoformat(),
            })

    return messages


# ──────────────────────────────────────────────
# AGGREGATES (for the dashboard)
# ──────────────────────────────────────────────

def compute_sentiment_summary(messages, bamboohr_id):
    """Compute per-employee sentiment summary for last 30/60/90 days."""
    employee_msgs = [m for m in messages if m["bamboohr_id"] == bamboohr_id]
    if not employee_msgs:
        return {}

    today    = date.today()
    windows  = {"last_30_days": 30, "last_60_days": 60, "last_90_days": 90}
    summary  = {}

    for window_name, days in windows.items():
        cutoff  = today - timedelta(days=days)
        windowed = [
            m for m in employee_msgs
            if datetime.fromisoformat(m["date"]).date() >= cutoff
        ]
        if not windowed:
            continue

        scores  = [m["sentiment_score"] for m in windowed]
        labels  = [m["sentiment_label"] for m in windowed]

        summary[window_name] = {
            "message_count":      len(windowed),
            "avg_sentiment_score": round(sum(scores) / len(scores), 4),
            "positive_pct":       round(labels.count("positive") / len(labels) * 100, 1),
            "neutral_pct":        round(labels.count("neutral")  / len(labels) * 100, 1),
            "negative_pct":       round(labels.count("negative") / len(labels) * 100, 1),
            "dominant_sentiment": max(["positive", "neutral", "negative"],
                                      key=lambda s: labels.count(s)),
        }

    # Trend: compare last 30 days to previous 30 days
    last30  = summary.get("last_30_days", {}).get("avg_sentiment_score", 0.5)
    prev30_msgs = [
        m for m in employee_msgs
        if timedelta(days=60) >= (today - datetime.fromisoformat(m["date"]).date()) >= timedelta(days=30)
    ]
    if prev30_msgs:
        prev_avg = sum(m["sentiment_score"] for m in prev30_msgs) / len(prev30_msgs)
        diff     = last30 - prev_avg
        trend    = "improving" if diff > 0.05 else "declining" if diff < -0.05 else "stable"
    else:
        trend = "stable"

    summary["trend_30d"] = trend
    return summary


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────

def main():
    os.makedirs("data", exist_ok=True)

    print("=" * 55)
    print("  STEP 2 — Generate Synthetic Slack Data")
    print("=" * 55)

    # ── Load BambooHR employees ──
    input_path = "data/bamboohr_employees_clean.json"
    if not os.path.exists(input_path):
        print(f"❌ {input_path} not found. Run step1_fetch_bamboohr.py first.")
        return

    with open(input_path) as f:
        bamboohr_employees = json.load(f)

    print(f"\n📂 Loaded {len(bamboohr_employees)} employees from BambooHR\n")

    # ── Create Slack users ──
    print("👥 Creating Slack user profiles...")
    slack_users = []
    for i, emp in enumerate(bamboohr_employees):
        user = create_slack_user(emp, i)
        slack_users.append(user)
        print(f"  ✓ {user['real_name']:25s} | {user['email']:35s} | Risk: {user['risk_level']:6s} | Score: {user['engagement_score']}")

    # ── Create channels ──
    print(f"\n📢 Creating Slack channels...")
    channels, channel_id_map = create_channels(slack_users)
    print(f"  ✓ {len(channels)} channels created")

    # ── Generate messages ──
    print(f"\n💬 Generating 90 days of message history...")
    all_messages = []
    for user in slack_users:
        msgs = generate_messages_for_user(user, channel_id_map, days=90)
        all_messages.extend(msgs)
        print(f"  ✓ {user['real_name']:25s} → {len(msgs):3d} messages | Risk: {user['risk_level']}")

    # ── Compute sentiment summaries ──
    print(f"\n📊 Computing sentiment summaries...")
    for user in slack_users:
        user["sentiment_summary"] = compute_sentiment_summary(all_messages, user["bamboohr_id"])

    # ── Save everything ──
    print(f"\n💾 Saving to data/...")

    with open("data/slack_users.json", "w") as f:
        json.dump(slack_users, f, indent=2)
    print(f"  ✓ slack_users.json        ({len(slack_users)} users)")

    with open("data/slack_channels.json", "w") as f:
        json.dump(channels, f, indent=2)
    print(f"  ✓ slack_channels.json     ({len(channels)} channels)")

    with open("data/slack_messages.json", "w") as f:
        json.dump(all_messages, f, indent=2)
    print(f"  ✓ slack_messages.json     ({len(all_messages)} messages)")

    # ── Summary ──
    by_risk = {"high": 0, "medium": 0, "low": 0}
    for u in slack_users:
        by_risk[u["risk_level"]] += 1

    total_pos = sum(1 for m in all_messages if m["sentiment_label"] == "positive")
    total_neg = sum(1 for m in all_messages if m["sentiment_label"] == "negative")
    total_neu = sum(1 for m in all_messages if m["sentiment_label"] == "neutral")

    print(f"\n{'='*55}")
    print(f"✅ STEP 2 COMPLETE")
    print(f"\n   Employees synced: {len(slack_users)}")
    print(f"   Risk breakdown:   🔴 High={by_risk['high']}  🟡 Medium={by_risk['medium']}  🟢 Low={by_risk['low']}")
    print(f"   Total messages:   {len(all_messages)}")
    print(f"   Positive:         {total_pos} ({round(total_pos/len(all_messages)*100)}%)")
    print(f"   Neutral:          {total_neu} ({round(total_neu/len(all_messages)*100)}%)")
    print(f"   Negative:         {total_neg} ({round(total_neg/len(all_messages)*100)}%)")
    print(f"\n→ Next: Run python step3_seed_database.py")
    print(f"{'='*55}")


if __name__ == "__main__":
    main()
