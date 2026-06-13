param(
  [Parameter(Mandatory = $true)]
  [string]$InputFile,

  [string]$OutputFile = "data.json",

  [switch]$DryRun,

  [switch]$Replace
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot $OutputFile

Set-Location $projectRoot

python ".\scripts\excel_to_json.py" $InputFile $outputPath

$uploadArgs = @(".\scripts\upload_to_firestore.js", "--data=$outputPath")

if ($DryRun) {
  $uploadArgs += "--dry-run"
}

if ($Replace) {
  $uploadArgs += "--replace"
}

node @uploadArgs
