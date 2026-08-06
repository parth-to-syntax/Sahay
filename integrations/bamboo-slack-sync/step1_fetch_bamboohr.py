"""
STEP 1 — Fetch Employees from BambooHR Trial API
-------------------------------------------------
Run this first. It pulls all sample employees that BambooHR
auto-generated in your trial account and saves them locally.

Usage:
    python step1_fetch_bamboohr.py

Output:
    data/bamboohr_employees_raw.json   ← raw API response
    data/bamboohr_employees_clean.json ← normalized for our DB
"""

import requests
import json
import os
from datetime import datetime, date
from dateutil.relativedelta import relativedelta


def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
load_env_file(os.path.join(SCRIPT_DIR, ".env"))
load_env_file(os.path.join(SCRIPT_DIR, "..", "..", "services", "api-gateway", "backend", ".env"))

# ──────────────────────────────────────────────
# CONFIG — values come from env with sane defaults
# ──────────────────────────────────────────────
BAMBOOHR_SUBDOMAIN = os.environ.get("BAMBOOHR_SUBDOMAIN") or os.environ.get("BAMBOOHR_COMPANY") or "cudept"
BAMBOOHR_API_KEY = os.environ.get("BAMBOOHR_API_KEY", "")
BAMBOOHR_API_BASE = os.environ.get("BAMBOOHR_API_BASE", "https://api.bamboohr.com/api/gateway.php")

BASE_URL = f"{BAMBOOHR_API_BASE}/{BAMBOOHR_SUBDOMAIN}/v1"

HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json"
}

AUTH = (BAMBOOHR_API_KEY, "x")   # BambooHR: API key as username, "x" as password

# All fields we want per employee (BambooHR field names)
EMPLOYEE_FIELDS = ",".join([
    "id", "firstName", "lastName", "displayName",
    "jobTitle", "department", "division", "location",
    "workEmail", "workPhone", "mobilePhone",
    "gender", "dateOfBirth", "maritalStatus",
    "hireDate", "employmentHistoryStatus",
    "supervisor", "supervisorId",
    "payRate", "payType", "payPeriod", "currency",
    "employeeNumber", "status",
    "linkedin", "twitterFeed",
    "photoUploaded"
])


# ──────────────────────────────────────────────
# FETCHERS
# ──────────────────────────────────────────────

def fetch_directory():
    """Get all employees from the directory endpoint."""
    print("📡 Fetching employee directory from BambooHR...")
    if not BAMBOOHR_API_KEY:
        print("⚠️  BAMBOOHR_API_KEY not set. Falling back to demo data.")
        return []
    url = f"{BASE_URL}/employees/directory"
    try:
        resp = requests.get(url, auth=AUTH, headers=HEADERS, timeout=10)
        if resp.status_code != 200:
            print(f"❌ Failed: {resp.status_code} — {resp.text}")
            return []
        employees = resp.json().get("employees", [])
        print(f"✅ Found {len(employees)} employees in directory")
        return employees
    except Exception as e:
        print(f"⚠️  Cannot reach BambooHR API ({type(e).__name__}). Using demo fallback.")
        return []


def fetch_employee_details(employee_id):
    """Get full details for a single employee."""
    url = f"{BASE_URL}/employees/{employee_id}"
    params = {"fields": EMPLOYEE_FIELDS}
    resp = requests.get(url, auth=AUTH, headers=HEADERS, params=params)
    
    if resp.status_code == 200:
        return resp.json()
    else:
        print(f"  ⚠️  Could not fetch details for employee {employee_id}: {resp.status_code}")
        return {}


def fetch_time_off(employee_id):
    """Get time-off balance for an employee."""
    url = f"{BASE_URL}/employees/{employee_id}/timeOff/calculator"
    today = date.today().isoformat()
    params = {"end": today}
    resp = requests.get(url, auth=AUTH, headers=HEADERS, params=params)
    
    if resp.status_code == 200:
        return resp.json()
    return []


def fetch_all_employees_with_details():
    """
    Full pipeline:
    1. Get directory (all employee IDs)
    2. For each employee, fetch full details + time off
    3. Return enriched list
    """
    directory = fetch_directory()
    if not directory:
        print("⚠️  No employees found. Check your API key and subdomain.")
        return []
    
    enriched = []
    for i, emp in enumerate(directory, 1):
        emp_id = emp.get("id")
        name   = emp.get("displayName", f"Employee {emp_id}")
        print(f"  [{i}/{len(directory)}] Fetching details for {name}...")
        
        details  = fetch_employee_details(emp_id)
        time_off = fetch_time_off(emp_id)
        
        # Merge directory + details
        merged = {**emp, **details}
        merged["timeOff"] = time_off
        enriched.append(merged)
    
    return enriched


# ──────────────────────────────────────────────
# NORMALIZER — map BambooHR fields → our DB schema
# ──────────────────────────────────────────────

def calculate_tenure(hire_date_str):
    """Calculate years and months since hire date."""
    if not hire_date_str:
        return {"years": 0, "months": 0, "label": "Unknown"}
    try:
        hire_date = datetime.strptime(hire_date_str, "%Y-%m-%d").date()
        today     = date.today()
        delta     = relativedelta(today, hire_date)
        label     = f"{delta.years}y {delta.months}m" if delta.years > 0 else f"{delta.months}m"
        return {"years": delta.years, "months": delta.months, "label": label}
    except Exception:
        return {"years": 0, "months": 0, "label": "Unknown"}


def normalize_employee(raw):
    """Convert BambooHR raw response → clean unified employee record."""
    tenure = calculate_tenure(raw.get("hireDate"))
    
    # Generate initials for avatar
    first = raw.get("firstName", "?")
    last  = raw.get("lastName", "?")
    initials = f"{first[0]}{last[0]}".upper()
    
    return {
        # ── Identity ──
        "bamboohr_id":    str(raw.get("id", "")),
        "employee_number": raw.get("employeeNumber", ""),
        "first_name":     raw.get("firstName", ""),
        "last_name":      raw.get("lastName", ""),
        "display_name":   raw.get("displayName", f"{first} {last}"),
        "initials":       initials,
        "work_email":     raw.get("workEmail", ""),
        "work_phone":     raw.get("workPhone", ""),
        "mobile_phone":   raw.get("mobilePhone", ""),
        "gender":         raw.get("gender", ""),
        "date_of_birth":  raw.get("dateOfBirth", ""),
        "marital_status": raw.get("maritalStatus", ""),
        
        # ── Employment ──
        "job_title":       raw.get("jobTitle", ""),
        "department":      raw.get("department", ""),
        "division":        raw.get("division", ""),
        "location":        raw.get("location", ""),
        "status":          raw.get("status", "Active"),
        "employment_type": raw.get("employmentHistoryStatus", "Full-Time"),
        
        # ── Dates ──
        "hire_date":      raw.get("hireDate", ""),
        "tenure_years":   tenure["years"],
        "tenure_months":  tenure["months"],
        "tenure_label":   tenure["label"],
        
        # ── Hierarchy ──
        "supervisor_name": raw.get("supervisor", ""),
        "supervisor_id":   str(raw.get("supervisorId", "")),
        
        # ── Compensation ──
        "pay_rate":   raw.get("payRate", ""),
        "pay_type":   raw.get("payType", ""),
        "pay_period": raw.get("payPeriod", ""),
        "currency":   raw.get("currency", "USD"),
        
        # ── Time Off ──
        "time_off": raw.get("timeOff", []),
        
        # ── Source Metadata ──
        "data_source":  "bamboohr",
        "fetched_at":   datetime.now().isoformat(),
        "photo_url":    raw.get("photoUrl", ""),
        "has_photo":    raw.get("photoUploaded", False),
    }


def normalize_all(raw_employees):
    """Normalize all raw BambooHR employees."""
    print(f"\n🔄 Normalizing {len(raw_employees)} employee records...")
    normalized = []
    for raw in raw_employees:
        try:
            clean = normalize_employee(raw)
            normalized.append(clean)
            print(f"  ✓ {clean['display_name']} — {clean['job_title']} ({clean['department']})")
        except Exception as e:
            print(f"  ⚠️  Error normalizing employee {raw.get('id')}: {e}")
    return normalized


# ──────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────

def main():
    os.makedirs("data", exist_ok=True)
    
    print("=" * 55)
    print("  STEP 1 — BambooHR Employee Fetch")
    print("=" * 55)
    
    # 1. Fetch from BambooHR
    raw_employees = fetch_all_employees_with_details()
    
    if not raw_employees:
        print("\n⚠️  No data fetched. Using DEMO fallback data instead.")
        raw_employees = get_demo_fallback()
    
    # 2. Save raw response (useful for debugging)
    with open("data/bamboohr_employees_raw.json", "w") as f:
        json.dump(raw_employees, f, indent=2)
    print(f"\n💾 Raw data saved → data/bamboohr_employees_raw.json")
    
    # 3. Normalize
    clean_employees = normalize_all(raw_employees)
    
    # 4. Save clean data
    with open("data/bamboohr_employees_clean.json", "w") as f:
        json.dump(clean_employees, f, indent=2)
    print(f"💾 Clean data saved → data/bamboohr_employees_clean.json")
    
    # 5. Summary
    print(f"\n{'='*55}")
    print(f"✅ STEP 1 COMPLETE")
    print(f"   {len(clean_employees)} employees fetched and normalized")
    depts = list(set(e["department"] for e in clean_employees if e["department"]))
    print(f"   Departments: {', '.join(depts)}")
    print(f"\n→ Next: Run python step2_generate_slack.py")
    print(f"{'='*55}")
    
    return clean_employees


def get_demo_fallback():
    """
    Fallback demo data matching BambooHR's trial sample
    employees (Olivia Sterling, Dorothy Chou, etc.)
    Use this if API key isn't set up yet.
    """
    return [
        {
            "id": "1", "firstName": "Olivia", "lastName": "Sterling",
            "displayName": "Olivia Sterling", "jobTitle": "HR Manager",
            "department": "Human Resources", "division": "Corporate",
            "location": "New York", "workEmail": "olivia.sterling@cudept.com",
            "gender": "Female", "hireDate": "2019-03-15",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "James Whitfield", "supervisorId": "10",
            "payRate": "85000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP001"
        },
        {
            "id": "2", "firstName": "Dorothy", "lastName": "Chou",
            "displayName": "Dorothy Chou", "jobTitle": "Software Engineer",
            "department": "Engineering", "division": "Technology",
            "location": "San Francisco", "workEmail": "dorothy.chou@cudept.com",
            "gender": "Female", "hireDate": "2021-06-01",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "Olivia Sterling", "supervisorId": "1",
            "payRate": "120000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP002"
        },
        {
            "id": "3", "firstName": "Marcus", "lastName": "Reed",
            "displayName": "Marcus Reed", "jobTitle": "Product Manager",
            "department": "Product", "division": "Technology",
            "location": "Austin", "workEmail": "marcus.reed@cudept.com",
            "gender": "Male", "hireDate": "2020-09-14",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "Olivia Sterling", "supervisorId": "1",
            "payRate": "110000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP003"
        },
        {
            "id": "4", "firstName": "Priya", "lastName": "Nair",
            "displayName": "Priya Nair", "jobTitle": "Data Scientist",
            "department": "Analytics", "division": "Technology",
            "location": "Chicago", "workEmail": "priya.nair@cudept.com",
            "gender": "Female", "hireDate": "2022-01-10",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "Marcus Reed", "supervisorId": "3",
            "payRate": "115000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP004"
        },
        {
            "id": "5", "firstName": "James", "lastName": "Whitfield",
            "displayName": "James Whitfield", "jobTitle": "Chief HR Officer",
            "department": "Human Resources", "division": "Executive",
            "location": "New York", "workEmail": "james.whitfield@cudept.com",
            "gender": "Male", "hireDate": "2017-07-01",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "", "supervisorId": "",
            "payRate": "180000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP010"
        },
        {
            "id": "6", "firstName": "Aisha", "lastName": "Patel",
            "displayName": "Aisha Patel", "jobTitle": "Sales Director",
            "department": "Sales", "division": "Revenue",
            "location": "Dallas", "workEmail": "aisha.patel@cudept.com",
            "gender": "Female", "hireDate": "2021-03-22",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "James Whitfield", "supervisorId": "10",
            "payRate": "130000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP006"
        },
        {
            "id": "7", "firstName": "Ryan", "lastName": "Kowalski",
            "displayName": "Ryan Kowalski", "jobTitle": "DevOps Engineer",
            "department": "Engineering", "division": "Technology",
            "location": "Remote", "workEmail": "ryan.kowalski@cudept.com",
            "gender": "Male", "hireDate": "2023-02-01",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "Dorothy Chou", "supervisorId": "2",
            "payRate": "105000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP007"
        },
        {
            "id": "8", "firstName": "Sofia", "lastName": "Mendez",
            "displayName": "Sofia Mendez", "jobTitle": "UX Designer",
            "department": "Design", "division": "Technology",
            "location": "Miami", "workEmail": "sofia.mendez@cudept.com",
            "gender": "Female", "hireDate": "2022-08-15",
            "status": "Active", "employmentHistoryStatus": "Full-Time",
            "supervisor": "Marcus Reed", "supervisorId": "3",
            "payRate": "95000", "payType": "Salary", "currency": "USD",
            "employeeNumber": "EMP008"
        },
    ]


if __name__ == "__main__":
    main()
