param(
  [string]$BaseUrl = "",
  [string]$OrgId = "demo",
  [string]$SnapshotAt = (Get-Date -Format "yyyy-MM-dd"),
  [int]$SleepMs = 200,
  [switch]$SeedDocumentsAndMemory = $true
)

$ErrorActionPreference = 'Stop'

function Resolve-BaseUrl([string]$baseUrl) {
  if ($baseUrl -and $baseUrl.Trim() -ne "") { return $baseUrl.Trim().TrimEnd('/') }

  $portsToTry = @(4002, 4000, 4001)
  foreach ($p in $portsToTry) {
    $candidate = "http://localhost:$p"
    try {
      $health = Invoke-RestMethod -Method Get -Uri "$candidate/health" -TimeoutSec 2
      if ($health -and $health.ok -eq $true) {
        # Also ensure ingest routes exist (avoid picking a different service on the same port)
        $c = Invoke-RestMethod -Method Get -Uri "$candidate/api/ingest/cursors" -Headers @{ 'x-org-id' = $OrgId } -TimeoutSec 2
        if ($c -and $c.ok -eq $true) { return $candidate }
      }
    } catch {
      # try next
    }
  }

  throw "Could not auto-detect backend. Pass -BaseUrl like 'http://localhost:4002'."
}

function Get-EmployeeIdsFromDirectoryResponse($dirResp) {
  $data = $dirResp
  if ($null -ne $dirResp.data) { $data = $dirResp.data }

  $employees = $null
  if ($null -ne $data.employees) { $employees = $data.employees }
  elseif ($data -is [System.Collections.IEnumerable]) { $employees = $data }
  elseif ($null -ne $dirResp.employees) { $employees = $dirResp.employees }

  if ($null -eq $employees) { return @() }

  $ids = @()
  foreach ($e in $employees) {
    $id = $null
    if ($null -ne $e.id) { $id = $e.id }
    elseif ($null -ne $e.employeeId) { $id = $e.employeeId }
    elseif ($null -ne $e.employee_id) { $id = $e.employee_id }

    if ($null -ne $id) {
      $s = "$id".Trim()
      if ($s -ne "") { $ids += $s }
    }
  }

  return $ids | Select-Object -Unique
}

$BaseUrl = Resolve-BaseUrl $BaseUrl
$headers = @{ 'x-org-id' = $OrgId }

Write-Host "[run_seed_all] baseUrl=$BaseUrl orgId=$OrgId snapshotAt=$SnapshotAt" 

# 1) Fetch directory IDs
$dir = Invoke-RestMethod -Method Get -Uri "$BaseUrl/api/bamboohr/employees/directory" -Headers $headers -TimeoutSec 60
$ids = Get-EmployeeIdsFromDirectoryResponse $dir

if (-not $ids -or $ids.Count -eq 0) {
  throw "No employee IDs found in directory response."
}

Write-Host "[run_seed_all] employees=$($ids.Count)" 

# 2) Ingest per-employee detail for ALL employees
$ok = 0
$fail = 0
$errors = @()

for ($i = 0; $i -lt $ids.Count; $i++) {
  $id = $ids[$i]
  $pct = [Math]::Floor((($i + 1) * 100.0) / $ids.Count)
  Write-Progress -Activity "BambooHR employee ingest" -Status "$($i+1)/$($ids.Count) id=$id" -PercentComplete $pct

  try {
    $null = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/ingest/bamboohr/employees/$id?snapshotAt=$SnapshotAt" -Headers $headers -TimeoutSec 60
    $ok += 1
  } catch {
    $fail += 1
    $msg = $_.Exception.Message
    $errors += @{ employeeId = $id; error = $msg }
    Write-Warning "[run_seed_all] failed id=$id error=$msg"
  }

  if ($SleepMs -gt 0) { Start-Sleep -Milliseconds $SleepMs }
}

Write-Host "[run_seed_all] bamboohr_ingest_ok=$ok bamboohr_ingest_fail=$fail" 

# 3) Seed document_chunks + memory_events via API (one document + one memory event per employee)
if ($SeedDocumentsAndMemory) {
  $jsonHeaders = @{ 'x-org-id' = $OrgId; 'content-type' = 'application/json' }

  $docOk = 0
  $memOk = 0
  $docFail = 0
  $memFail = 0

  for ($i = 0; $i -lt $ids.Count; $i++) {
    $id = $ids[$i]
    $pct = [Math]::Floor((($i + 1) * 100.0) / $ids.Count)
    Write-Progress -Activity "Seeding documents + memory" -Status "$($i+1)/$($ids.Count) employeeId=$id" -PercentComplete $pct

    $externalId = "seed:transcript:${id}:${SnapshotAt}"

    $docBody = @{ 
      documentType = 'meeting_transcript'
      sourceSystem  = 'seed'
      externalId    = $externalId
      metadata      = @{ employeeId = $id; seeded = $true }
      content       = "Seed transcript for employee $id"
      sensitivity   = 'standard'
      chunks        = @(
        @{ chunkIndex = 0; employeeId = $id; text = "Summary: employee $id is tracking priorities and blockers."; tokenCount = 14 }
        @{ chunkIndex = 1; employeeId = $id; text = "Actions: follow up on open items; schedule 1:1."; tokenCount = 12 }
      )
    } | ConvertTo-Json -Depth 10

    $docId = $null
    try {
      $docResp = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/ingest/documents" -Headers $jsonHeaders -Body $docBody -TimeoutSec 60
      $docId = $docResp.data.documentId
      $docOk += 1
    } catch {
      $docFail += 1
      Write-Warning "[run_seed_all] doc seed failed employeeId=$id error=$($_.Exception.Message)"
    }

    if ($null -ne $docId) {
      $memBody = @{
        employeeId = $id
        eventType  = 'seed_note'
        eventTime  = (Get-Date).ToString('o')
        summary    = "Seeded memory event for employee $id"
        sourceDocumentId = "$docId"
        confidence = 0.8
        sensitivity = 'standard'
      } | ConvertTo-Json -Depth 10

      try {
        $null = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/memory/events" -Headers $jsonHeaders -Body $memBody -TimeoutSec 60
        $memOk += 1
      } catch {
        $memFail += 1
        Write-Warning "[run_seed_all] memory seed failed employeeId=$id error=$($_.Exception.Message)"
      }
    }
  }

  Write-Host "[run_seed_all] documents_seed_ok=$docOk documents_seed_fail=$docFail memory_seed_ok=$memOk memory_seed_fail=$memFail" 
}

Write-Host "[run_seed_all] done" 
