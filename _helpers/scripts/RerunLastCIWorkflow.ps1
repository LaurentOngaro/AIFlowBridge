<#
.SYNOPSIS
    Recreate and re-push the last git tag to retrigger the GitHub Actions CI workflow.

.DESCRIPTION
    Deletes the most recent tag (locally and on the remote), recreates it at the same commit SHA,
    and pushes it. The push is what re-triggers the CI workflow that listens to tag pushes.

    Without arguments the script targets the last tag reachable from HEAD (git describe --tags --abbrev=0).
    Use -TagName to target a specific tag.

.PARAMETER TagName
    Tag to recreate. Defaults to the most recent tag (git describe --tags --abbrev=0).

.PARAMETER Remote
    Name of the git remote. Defaults to "origin".

.PARAMETER RepoRoot
    Path to the git repository. Defaults to the parent of the script folder.

.EXAMPLE
    pwsh -File _helpers/scripts/RerunLastCIWorkflow.ps1
    Recreate and re-push the most recent tag.

.EXAMPLE
    pwsh -File _helpers/scripts/RerunLastCIWorkflow.ps1 -TagName v2.11.0
    Recreate and re-push the v2.11.0 tag.

.NOTES
    Requirements: PowerShell 7+ (pwsh) and git in PATH.
#>

[CmdletBinding()]
param(
  [string]$TagName = "",

  [string]$Remote = "origin",

  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Set-Location -LiteralPath $RepoRoot

function Write-Step {
  param([string]$Message)
  Write-Host "[rerun-ci] $Message" -ForegroundColor Cyan
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[rerun-ci] $Message" -ForegroundColor Yellow
}

function Write-Ok {
  param([string]$Message)
  Write-Host "[rerun-ci] $Message" -ForegroundColor Green
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [Parameter(Mandatory = $true)]
    [string[]]$ArgumentList
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $FilePath $($ArgumentList -join ' ')"
  }
}

function Get-LatestTag {
  # `git describe --tags --abbrev=0` returns the most recent tag reachable
  # from HEAD. It fails (exit 128) when HEAD has no tag ancestor, which
  # is the case for a brand-new repo. Fall back to sorting all tags by
  # creation date so the script still works on a fresh checkout that
  # happens to have remote-only tags.
  $tag = & git describe --tags --abbrev=0 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($tag)) {
    return $tag.Trim()
  }

  $sorted = & git for-each-ref --sort=-creatordate --format="%(refname:short)" refs/tags
  if ($LASTEXITCODE -ne 0) {
    throw "Could not enumerate tags. Make sure the repository has at least one tag."
  }
  $first = $sorted | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1
  if ($null -eq $first) {
    throw "No tags found in this repository."
  }
  return $first.Trim()
}

function Test-TagExistsLocally {
  param([Parameter(Mandatory = $true)][string]$Name)
  $null = & git rev-parse --verify --quiet "refs/tags/$Name" 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Test-TagExistsOnRemote {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$RemoteName
  )
  $null = & git ls-remote --tags $RemoteName "refs/tags/$Name" 2>$null
  # ls-remote exits 0 even when the ref is absent (empty stdout). Use
  # the captured output instead of the exit code to decide.
  return ($null -ne $LASTEXITCODE -and $LASTEXITCODE -eq 0 -and $LASTEXITCODE -ne 128)
}

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot ".git"))) {
  throw "Not a git repository: $RepoRoot"
}

if ([string]::IsNullOrWhiteSpace($TagName)) {
  $TagName = Get-LatestTag
  Write-Step "No -TagName supplied; using latest tag: $TagName"
} else {
  Write-Step "Using supplied tag: $TagName"
}

# Resolve the commit the tag currently points to so we can recreate it
# at the exact same SHA even after a delete + recreate round-trip.
$tagSha = & git rev-list -n 1 $TagName 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($tagSha)) {
  throw "Tag '$TagName' cannot be resolved to a commit. Aborting."
}
$tagSha = $tagSha.Trim()
Write-Step "Tag '$TagName' currently points to: $tagSha"

# Confirm the remote is reachable before we mutate anything - a failure
# mid-script would leave the local tag deleted with no way to recreate
# it on the remote side.
& git remote get-url $Remote 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Remote '$Remote' is not configured."
}

$localExists = Test-TagExistsLocally -Name $TagName
$remoteExists = $false
$lsRemote = & git ls-remote --tags $Remote "refs/tags/$TagName"
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($lsRemote)) {
  $remoteExists = $true
}

if ($remoteExists) {
  Write-Step "Deleting remote tag '$TagName' on '$Remote'..."
  Invoke-CheckedCommand -FilePath "git" -ArgumentList @("push", $Remote, ":refs/tags/$TagName")
} else {
  Write-Step "Remote tag '$TagName' does not exist on '$Remote'; skipping remote delete."
}

if ($localExists) {
  Write-Step "Deleting local tag '$TagName'..."
  Invoke-CheckedCommand -FilePath "git" -ArgumentList @("tag", "-d", $TagName)
} else {
  Write-Step "Local tag '$TagName' does not exist; skipping local delete."
}

Write-Step "Recreating local tag '$TagName' at $tagSha..."
Invoke-CheckedCommand -FilePath "git" -ArgumentList @("tag", $TagName, $tagSha)

Write-Step "Pushing recreated tag '$TagName' to '$Remote' (this triggers the CI workflow)..."
Invoke-CheckedCommand -FilePath "git" -ArgumentList @("push", $Remote, $TagName)

Write-Step ""
Write-Ok "Done. Tag '$TagName' was deleted (local+remote), recreated at $tagSha, and pushed to '$Remote'."
Write-Step "Watch the CI run at: https://github.com/$((& git config --get remote.$Remote.url) -replace '\.git$','' -replace '^.*github\.com[:/]','')/actions"