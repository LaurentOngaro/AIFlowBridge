<#
.SYNOPSIS
    One-shot setup script for the local-only _Private/ folder (personal working notes).

.DESCRIPTION
    Creates a bare git repo at $HOME\aiflowbridge-private.git and clones it into
    _Private/ at the project root. The folder is gitignored from the main AIFlowBridge
    repo (so it never lands on GitHub or in the VSIX) but has its own full git
    history via the local bare repo.

    Architecture:
        $HOME\aiflowbridge-private.git   bare repo (history, can be backed up off-site)
        <project>\_Private\              working tree (gitignored from main repo)

    The script is idempotent: running it twice does not destroy existing data.

.PARAMETER Force
    Skip the interactive confirmation prompt.

.PARAMETER BareRepoPath
    Path to the bare git repo. Default: $HOME\aiflowbridge-private.git

.PARAMETER WorkingDir
    Name of the working tree directory at the project root. Default: _Private

.EXAMPLE
    pwsh -File _helpers/setup-private.ps1
    Interactive setup with confirmation prompt.

.EXAMPLE
    pwsh -File _helpers/setup-private.ps1 -Force
    Non-interactive setup (for CI or automation).

.NOTES
    Requirements: PowerShell 7+ (pwsh) and git in PATH.
#>

[CmdletBinding()]
param(
    [switch]$Force,
    [string]$BareRepoPath = (Join-Path $HOME "aiflowbridge-private.git"),
    [string]$WorkingDir = "_Private"
)

$ErrorActionPreference = "Stop"

# ---- Helpers ----

function Write-Step {
    param([string]$Message)
    Write-Host "[setup-private] $Message" -ForegroundColor Cyan
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[setup-private] $Message" -ForegroundColor Yellow
}

function Write-Ok {
    param([string]$Message)
    Write-Host "[setup-private] $Message" -ForegroundColor Green
}

# ---- Pre-flight checks ----

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is not in PATH. Install git or open a terminal that has it available."
}

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$workingPath = Join-Path $projectRoot $WorkingDir
$bareExists = Test-Path $BareRepoPath

Write-Step "Project root : $projectRoot"
Write-Step "Bare repo    : $BareRepoPath (exists: $bareExists)"
Write-Step "Working dir  : $workingPath (exists: $(Test-Path $workingPath))"

# ---- Interactive confirmation ----

if (-not $Force) {
    $response = Read-Host "`nProceed with setup? [y/N]"
    if ($response -ne "y" -and $response -ne "Y") {
        Write-Warn "Aborted by user."
        exit 0
    }
}

# ---- Step 1: bare repo ----

if ($bareExists) {
    Write-Step "Bare repo already exists, skipping creation"
} else {
    Write-Step "Creating bare repo at $BareRepoPath"
    git init --bare $BareRepoPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git init --bare failed" }
    Write-Ok "Bare repo created"
}

# ---- Step 2: clone into _Private/ ----

if (Test-Path $workingPath) {
    $gitInWorking = Test-Path (Join-Path $workingPath ".git")
    if ($gitInWorking) {
        Write-Step "$WorkingDir already initialized as a git repo, skipping clone"
    } else {
        throw "$WorkingDir exists but is not a git repo. Move it away or remove it first."
    }
} else {
    Write-Step "Cloning bare repo into $workingPath"
    git clone $BareRepoPath $workingPath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
    Write-Ok "Working tree cloned"
}

# ---- Step 3: starter structure ----

$hasDocs = Test-Path (Join-Path $workingPath "docs")
$hasArchives = Test-Path (Join-Path $workingPath "archives")
$hasReadme = Test-Path (Join-Path $workingPath "README.md")

if ($hasDocs -and $hasArchives -and $hasReadme) {
    Write-Step "Starter structure already in place, skipping scaffold"
} else {
    if (-not $hasDocs) {
        New-Item -ItemType Directory -Path (Join-Path $workingPath "docs") -Force | Out-Null
    }
    if (-not $hasArchives) {
        New-Item -ItemType Directory -Path (Join-Path $workingPath "archives") -Force | Out-Null
    }
    if (-not $hasReadme) {
        $readme = @"
# _Private/ - Personal working notes (local-only)

This folder is **gitignored** from the main AIFlowBridge repo. It exists only on
this machine and is **never** published to GitHub or bundled in the VSIX.

It is backed by a bare git repo at ``$BareRepoPath`` (the source of truth for the
history; back it up off-site if you want redundancy).

## What goes here

- Drafts of audits, action plans, strategy docs that are not yet ready to be public.
- WIP for feature design, experiment notes, post-mortems.
- Personal templates, brainstorms, anything you would put in a private journal.

## What does NOT go here

- Anything that should be visible to the public (use ``_helpers/`` for that).
- Build artifacts, dependencies, secrets (these are gitignored separately).

## Daily workflow

```
cd _Private
git add docs/my-draft.md
git commit -m "WIP: ..."
git push   # to the local bare repo only, never to GitHub
```

## Promoting a note to public

When a draft is ready:

1. Copy the file to ``_helpers/docs/`` (or the appropriate public location).
2. Remove it from ``_Private/`` if you do not need the private history anymore.

## Backup

The bare repo at ``$BareRepoPath`` is the source of truth. To add a remote backup:

```
git -C $BareRepoPath remote add backup git@github.com:<you>/aiflowbridge-private.git
git -C _Private push backup master
```

Use a **private** GitHub repo or an external drive. The _Private/ folder is
local-only by design, but the history in the bare repo can travel to a private
remote.
"@
        $readmePath = Join-Path $workingPath "README.md"
        Set-Content -LiteralPath $readmePath -Value $readme -Encoding UTF8 -NoNewline
    }

    git -C $workingPath add docs archives README.md 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git add failed" }

    # Commit only if there is something to commit
    $status = git -C $workingPath status --porcelain
    if ($status) {
        git -C $workingPath commit -m "init: scaffold _Private/ with docs/, archives/, README" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
        Write-Ok "Starter structure committed"
    } else {
        Write-Step "Nothing to commit (scaffold already up to date)"
    }
}

# ---- Step 4: .gitignore ----

$gitignorePath = Join-Path $projectRoot ".gitignore"
$gitignoreContent = Get-Content $gitignorePath -Raw
$ignoreMarker = "# Personal private notes (local-only, see _helpers/setup-private.ps1)"
if ($gitignoreContent -match [regex]::Escape($WorkingDir)) {
    Write-Step "$WorkingDir already in .gitignore"
} else {
    Write-Step "Adding $WorkingDir to .gitignore"
    Add-Content -LiteralPath $gitignorePath -Value "`n$ignoreMarker`n$WorkingDir/"
    Write-Ok ".gitignore updated"
}

# ---- Step 5: .vscodeignore (defensive) ----

$vscodeignorePath = Join-Path $projectRoot ".vscodeignore"
if (Test-Path $vscodeignorePath) {
    $vscodeignoreContent = Get-Content $vscodeignorePath -Raw
    if ($vscodeignoreContent -match [regex]::Escape($WorkingDir)) {
        Write-Step "$WorkingDir already in .vscodeignore"
    } else {
        Write-Step "Adding $WorkingDir to .vscodeignore"
        Add-Content -LiteralPath $vscodeignorePath -Value "`n# Personal private notes`n$WorkingDir/**"
        Write-Ok ".vscodeignore updated"
    }
}

# ---- Done ----

Write-Host ""
Write-Ok "Setup complete."
Write-Host "  Bare repo    : $BareRepoPath"
Write-Host "  Working tree : $workingPath"
Write-Host "  .gitignore   : $WorkingDir/ excluded from main repo"
Write-Host "  .vscodeignore: $WorkingDir/** excluded from VSIX"
Write-Host ""
Write-Step "Next steps:"
Write-Host "  cd $WorkingDir"
Write-Host "  git add ."
Write-Host "  git commit -m 'init: my first private note'"
Write-Host "  git push   # pushes to the local bare repo, NEVER to GitHub"
