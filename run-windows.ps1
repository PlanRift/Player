$ErrorActionPreference = "Stop"

$ProjectDir = $PSScriptRoot
Set-Location -LiteralPath $ProjectDir

$BackendProcess = $null
$DevProcess = $null
$BridgeProcess = $null
$RunnerExitCode = 0

function Write-Log {
    param([string]$Message)

    Write-Host $Message
}

function Get-EnvOrDefault {
    param(
        [string]$Name,
        [string]$DefaultValue
    )

    $Value = [Environment]::GetEnvironmentVariable(
        $Name,
        "Process"
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $DefaultValue
    }

    return $Value
}

$env:ND_PORT = Get-EnvOrDefault "ND_PORT" "4533"
$env:ND_ADDRESS = Get-EnvOrDefault "ND_ADDRESS" "127.0.0.1"

$WebPort = Get-EnvOrDefault "WEB_PORT" "5500"
$BridgePort = Get-EnvOrDefault "FILE_BRIDGE_PORT" "3001"

if ([string]::IsNullOrWhiteSpace($env:ND_MUSICFOLDER)) {
    $ParentDir = Split-Path -Path $ProjectDir -Parent
    $MusicCandidates = @(
        "G:\Server\Music",
        (Join-Path $ParentDir "Music"),
        (Join-Path $HOME "Music\Mornye"),
        (Join-Path $HOME "Music"),
        (Join-Path $ProjectDir "music")
    )

    foreach ($Candidate in $MusicCandidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Container) {
            $env:ND_MUSICFOLDER = $Candidate
            break
        }
    }

    if ([string]::IsNullOrWhiteSpace($env:ND_MUSICFOLDER)) {
        $env:ND_MUSICFOLDER = Join-Path $ProjectDir "music"
    }
}

if ([string]::IsNullOrWhiteSpace($env:STORAGE_DIR)) {
    if (Test-Path -LiteralPath "G:\Server" -PathType Container) {
        $env:STORAGE_DIR = "G:\Server"
    } elseif (-not [string]::IsNullOrWhiteSpace($env:ND_MUSICFOLDER)) {
        $env:STORAGE_DIR = Split-Path -Path $env:ND_MUSICFOLDER -Parent
    }
}

if ([string]::IsNullOrWhiteSpace($env:ND_DATAFOLDER)) {
    $env:ND_DATAFOLDER = Join-Path $ProjectDir ".navidrome-data"
}

$BackendUrl = "http://$($env:ND_ADDRESS):$($env:ND_PORT)"
$WebUrl = "http://localhost:$WebPort"

$LogDir = Join-Path $ProjectDir ".runner-logs"
$BackendStdout = Join-Path $LogDir "navidrome.stdout.log"
$BackendStderr = Join-Path $LogDir "navidrome.stderr.log"

$WebDir = $ProjectDir
$EnvFile = Join-Path $ProjectDir ".env"
$EnvExample = Join-Path $ProjectDir ".env.example"

function Test-PortInUse {
    param([int]$Port)

    $Listeners = @(
        Get-NetTCPConnection `
            -State Listen `
            -LocalPort $Port `
            -ErrorAction SilentlyContinue
    )

    return ($Listeners.Count -gt 0)
}

function Show-PortOwner {
    param([int]$Port)

    $Listeners = @(
        Get-NetTCPConnection `
            -State Listen `
            -LocalPort $Port `
            -ErrorAction SilentlyContinue
    )

    foreach ($Listener in $Listeners) {
        $OwnerProcess = Get-Process `
            -Id $Listener.OwningProcess `
            -ErrorAction SilentlyContinue

        $ProcessName = if ($OwnerProcess) {
            $OwnerProcess.ProcessName
        }
        else {
            "unknown"
        }

        Write-Log (
            "  Port {0}: {1}, PID {2}" -f `
                $Port,
                $ProcessName,
                $Listener.OwningProcess
        )
    }
}

function Test-Backend {
    $PingUrl = (
        "$BackendUrl/rest/ping.view" +
        "?u=any&t=any&s=any&v=1.16.1" +
        "&c=century-runner&f=json"
    )

    try {
        $Response = Invoke-RestMethod `
            -Uri $PingUrl `
            -Method Get `
            -TimeoutSec 2

        $SubsonicResponse = $Response.'subsonic-response'

        return (
            $null -ne $SubsonicResponse -and
            $SubsonicResponse.type -eq "navidrome"
        )
    }
    catch {
        return $false
    }
}

function Find-Navidrome {
    if (-not [string]::IsNullOrWhiteSpace($env:NAVIDROME_BIN)) {
        $ConfiguredPath = $env:NAVIDROME_BIN

        if (Test-Path -LiteralPath $ConfiguredPath -PathType Leaf) {
            return (
                Resolve-Path -LiteralPath $ConfiguredPath
            ).Path
        }

        $ConfiguredCommand = Get-Command `
            $ConfiguredPath `
            -CommandType Application `
            -ErrorAction SilentlyContinue

        if ($ConfiguredCommand) {
            return $ConfiguredCommand.Source
        }

        throw "NAVIDROME_BIN is invalid: $ConfiguredPath"
    }

    $Command = Get-Command `
        "navidrome.exe" `
        -CommandType Application `
        -ErrorAction SilentlyContinue

    if ($Command) {
        return $Command.Source
    }

    $Candidates = @(
        (Join-Path $ProjectDir "navidrome.exe"),
        (Join-Path $ProjectDir "bin\navidrome.exe"),
        (Join-Path $ProjectDir "tools\navidrome\navidrome.exe")
    )

    if ($env:ProgramFiles) {
        $Candidates += Join-Path `
            $env:ProgramFiles `
            "Navidrome\navidrome.exe"
    }

    foreach ($Candidate in $Candidates) {
        if (Test-Path -LiteralPath $Candidate -PathType Leaf) {
            return $Candidate
        }
    }

    return $null
}

function Show-BackendLogs {
    foreach ($LogFile in @($BackendStdout, $BackendStderr)) {
        if (Test-Path -LiteralPath $LogFile) {
            Write-Log ""
            Write-Log "--- $LogFile ---"

            Get-Content `
                -LiteralPath $LogFile `
                -Tail 60 |
                ForEach-Object { Write-Host $_ }
        }
    }
}

function Stop-OwnedProcess {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Label
    )

    if ($null -eq $Process) {
        return
    }

    try {
        $Process.Refresh()

        if (-not $Process.HasExited) {
            Write-Log "Stopping $Label (PID $($Process.Id))..."

            & "$env:SystemRoot\System32\taskkill.exe" `
                /PID "$($Process.Id)" `
                /T `
                /F 2>$null |
                Out-Null
        }
    }
    catch {
        Write-Log "Could not completely stop ${Label}: $($_.Exception.Message)"
    }
}

try {
    Write-Log "========================================================"
    Write-Log "  Century: Music Client + Navidrome"
    Write-Log "========================================================"
    Write-Log ""
    Write-Log "Project: $ProjectDir"

    if (-not (Test-Path -LiteralPath (
        Join-Path $ProjectDir "package.json"
    ))) {
        throw "package.json not found. Put this script in the project root."
    }

    if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "index.html"))) {
        throw "index.html not found in project root."
    }

    $NodeCommand = Get-Command "node.exe" -CommandType Application -ErrorAction SilentlyContinue
    $BunCommand = Get-Command "bun.exe" -CommandType Application -ErrorAction SilentlyContinue

    if (-not $NodeCommand -and -not $BunCommand) {
        throw "Neither Node.js nor Bun is available in PATH. Install Node.js or Bun and reopen the terminal."
    }
    $JsRuntime = if ($NodeCommand) { $NodeCommand } else { $BunCommand }

    foreach ($Port in @([int]$WebPort, [int]$BridgePort)) {
        if (Test-PortInUse -Port $Port) {
            Show-PortOwner -Port $Port

            throw (
                "Port $Port is already in use. " +
                "Stop the previous server before starting another runner."
            )
        }
    }

    foreach ($Directory in @(
        $env:ND_MUSICFOLDER,
        $env:ND_DATAFOLDER,
        $LogDir
    )) {
        New-Item `
            -ItemType Directory `
            -Path $Directory `
            -Force |
            Out-Null
    }

    if (-not (Test-Path -LiteralPath $EnvFile)) {
        if (Test-Path -LiteralPath $EnvExample) {
            Copy-Item `
                -LiteralPath $EnvExample `
                -Destination $EnvFile

            Write-Log "Created .env from .env.example."
        }
        else {
            $EnvContent = @"
VITE_NAVIDROME_URL=$BackendUrl
VITE_NAVIDROME_USER=
VITE_NAVIDROME_PASSWORD=
"@

            $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

            [System.IO.File]::WriteAllText(
                $EnvFile,
                $EnvContent,
                $Utf8NoBom
            )

            Write-Log "Created .env with backend URL."
            Write-Log "Credentials are blank. Configure your Navidrome account."
        }
    }
    else {
        Write-Log "Keeping existing .env unchanged."
    }

    Write-Log ""
    Write-Log "Checking backend: $BackendUrl"

    if (Test-Backend) {
        Write-Log "Navidrome is already responding."
        Write-Log "Reusing it; this runner will not stop that existing server."
        Write-Log "Music/data settings belong to the existing server process."
    }
    else {
        if (Test-PortInUse -Port ([int]$env:ND_PORT)) {
            Show-PortOwner -Port ([int]$env:ND_PORT)

            throw (
                "Backend port is occupied, but no Navidrome response was detected."
            )
        }

        $NavidromeBinary = Find-Navidrome

        if (-not $NavidromeBinary) {
            throw (
                "navidrome.exe was not found. " +
                "Put it in bin\navidrome.exe or set NAVIDROME_BIN."
            )
        }

        Write-Log "Starting Navidrome..."
        Write-Log "  Binary: $NavidromeBinary"
        Write-Log "  Music:  $($env:ND_MUSICFOLDER)"
        Write-Log "  Data:   $($env:ND_DATAFOLDER)"
        Write-Log "  Logs:   $LogDir"

        $BackendProcess = Start-Process `
            -FilePath $NavidromeBinary `
            -WorkingDirectory $ProjectDir `
            -NoNewWindow `
            -PassThru `
            -RedirectStandardOutput $BackendStdout `
            -RedirectStandardError $BackendStderr

        $BackendReady = $false

        for ($Attempt = 1; $Attempt -le 60; $Attempt++) {
            $BackendProcess.Refresh()

            if ($BackendProcess.HasExited) {
                Show-BackendLogs
                throw "Navidrome exited during startup."
            }

            if (Test-Backend) {
                $BackendReady = $true
                break
            }

            Start-Sleep -Milliseconds 500
        }

        if (-not $BackendReady) {
            Show-BackendLogs
            throw "Navidrome did not respond within the startup timeout."
        }

        Write-Log "Navidrome is responding."
    }

    Write-Log ""
    Write-Log "Backend reachability verified; account credentials NOT verified."
    Write-Log ""
    Write-Log "Starting File Bridge and Web Player..."
    Write-Log "  Web Player:  $WebUrl"
    Write-Log "  File Bridge: http://localhost:$BridgePort"
    Write-Log "  Navidrome:   $BackendUrl"
    Write-Log "  NAS Root:    $($env:STORAGE_DIR)"
    Write-Log "  Music:       $($env:ND_MUSICFOLDER)"
    Write-Log ""
    Write-Log "Press Ctrl+C to stop all services."
    Write-Log "--------------------------------------------------------"

    $BridgeProcess = Start-Process `
        -FilePath $JsRuntime.Source `
        -ArgumentList @("file-bridge.js") `
        -WorkingDirectory $ProjectDir `
        -NoNewWindow `
        -PassThru

    $DevProcess = Start-Process `
        -FilePath $JsRuntime.Source `
        -ArgumentList @("serve.js") `
        -WorkingDirectory $ProjectDir `
        -NoNewWindow `
        -PassThru

    while (-not $DevProcess.HasExited) {
        Start-Sleep -Milliseconds 300
        $DevProcess.Refresh()

        if ($null -ne $BridgeProcess) {
            $BridgeProcess.Refresh()
            if ($BridgeProcess.HasExited) {
                throw "File Bridge stopped unexpectedly."
            }
        }

        if ($null -ne $BackendProcess) {
            $BackendProcess.Refresh()

            if ($BackendProcess.HasExited) {
                Show-BackendLogs
                throw "Navidrome stopped while the player was running."
            }
        }
    }

    $DevProcess.WaitForExit()
    $RunnerExitCode = $DevProcess.ExitCode
}
catch {
    $RunnerExitCode = 1

    Write-Host ""
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
    Write-Log ""
    Write-Log "Cleaning up services started by this runner..."

    Stop-OwnedProcess -Process $BridgeProcess -Label "File Bridge"
    Stop-OwnedProcess -Process $DevProcess -Label "Web Player"
    Stop-OwnedProcess -Process $BackendProcess -Label "Navidrome"

    Write-Log "Cleanup complete."
}

exit $RunnerExitCode