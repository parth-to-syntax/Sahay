## Scripts

- `node services/api-gateway/backend/scripts/probeBamboohr.js`
  - Fetches BambooHR `meta/fields` and `employees/directory` and prints a **non-PII** summary.

- `node services/api-gateway/backend/scripts/exportSlackUsersForBambooManualCreate.js`
  - Exports Slack users that are **missing in BambooHR** (matched by email).
  - By default emails are masked; set `EXPORT_PII=true` to include real emails for manual entry.
  - Optional: set `FORMAT=csv` to export a CSV.
