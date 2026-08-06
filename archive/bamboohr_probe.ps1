param(
  [Parameter(Mandatory = $true)]
  [string]$Company,

  [Parameter(Mandatory = $false)]
  [string]$ApiBase = "https://api.bamboohr.com/api/gateway.php"
)

$ErrorActionPreference = 'Stop'

function New-BambooAuthHeader {
  param([Parameter(Mandatory = $true)][string]$ApiKey)
  $raw = "$ApiKey:x"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
  $b64 = [Convert]::ToBase64String($bytes)
  return @{ Authorization = "Basic $b64" }
}

function Invoke-BambooGet {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Headers,
    [Parameter(Mandatory = $true)][string]$Url
  )

  return Invoke-RestMethod -Method Get -Headers $Headers -Uri $Url
}

$apiKey = $env:BAMBOOHR_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
  throw "Missing env var BAMBOOHR_API_KEY. Set it in the current PowerShell session and rerun."
}

$headers = New-BambooAuthHeader -ApiKey $apiKey

$metaFieldsUrl = "$ApiBase/$Company/v1/meta/fields"
$directoryUrl = "$ApiBase/$Company/v1/employees/directory"

Write-Host "Probing BambooHR for company '$Company'..." -ForegroundColor Cyan

# 1) Meta fields (schema)
$metaFields = Invoke-BambooGet -Headers $headers -Url $metaFieldsUrl

$fieldCount = 0
$fieldKeys = @()
if ($null -ne $metaFields) {
  if ($metaFields.PSObject.Properties.Name -contains 'fields') {
    $fieldCount = @($metaFields.fields).Count
    $fieldKeys = @($metaFields.fields | ForEach-Object { $_.alias } | Where-Object { $_ } | Sort-Object -Unique)
  } else {
    # Some responses are arrays
    $fieldCount = @($metaFields).Count
    $fieldKeys = @($metaFields | ForEach-Object { $_.alias } | Where-Object { $_ } | Sort-Object -Unique)
  }
}

# 2) Directory (sample record shape)
$directory = Invoke-BambooGet -Headers $headers -Url $directoryUrl
$employeeCount = 0
$directoryFieldNames = @()

if ($null -ne $directory) {
  if ($directory.PSObject.Properties.Name -contains 'employees') {
    $employeeCount = @($directory.employees).Count
    if ($employeeCount -gt 0) {
      $directoryFieldNames = @($directory.employees[0].PSObject.Properties.Name | Sort-Object)
    }
  } else {
    $employeeCount = @($directory).Count
    if ($employeeCount -gt 0) {
      $directoryFieldNames = @($directory[0].PSObject.Properties.Name | Sort-Object)
    }
  }
}

$summary = [ordered]@{
  company = $Company
  apiBase = $ApiBase
  fetchedAt = (Get-Date).ToString('o')
  endpoints = [ordered]@{
    metaFields = $metaFieldsUrl
    directory = $directoryUrl
  }
  meta = [ordered]@{
    fieldCount = $fieldCount
    aliasesSample = ($fieldKeys | Select-Object -First 30)
  }
  directory = [ordered]@{
    employeeCount = $employeeCount
    fieldNames = $directoryFieldNames
  }
}

$summaryJson = $summary | ConvertTo-Json -Depth 6

Write-Host "\n=== BambooHR Probe Summary (no PII printed) ===" -ForegroundColor Green
Write-Output $summaryJson
