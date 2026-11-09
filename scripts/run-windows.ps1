$ErrorActionPreference = "Stop"

# Auto-detect ProjectDir whether called from scripts/ or project root
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot "package.json") -PathType Leaf) {
    $ProjectDir = $PSScriptRoot
} elseif (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) "package.json") -PathType Leaf) {
    $ProjectDir = Split-Path -Parent $PSScriptRoot
} else {
    $ProjectDir = (Get-Item -LiteralPath "$PSScriptRoot\..").FullName
}
Set-Location -LiteralPath $ProjectDir

# Ensure user's Bun bin directory is in PATH on Windows (if installed via bun.sh)
$UserBunDir = Join-Path $HOME ".bun\bin"
if ((Test-Path -LiteralPath $UserBunDir) -and ($env:PATH -notlike "*$UserBunDir*")) {
    $env:PATH = "$UserBunDir;$env:PATH"
}

$BackendProcess = $null
$DevProcess = $null
$BridgeProcess = $null
$RelayProcess = $null
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
$LyricsPort = Get-EnvOrDefault "LYRICS_PORT" "3005"
$BridgePort = Get-EnvOrDefault "BRIDGE_PORT" (Get-EnvOrDefault "FILE_BRIDGE_PORT" "3001")

$Bridge = Get-EnvOrDefault "BRIDGE" "1"
$KillPorts = Get-EnvOrDefault "KILL_PORTS" "1"

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
    } else {
        $env:STORAGE_DIR = Join-Path $ProjectDir "storage"
    }
}

if ([string]::IsNullOrWhiteSpace($env:ND_DATAFOLDER)) {
    $ParentDir = Split-Path -Path $ProjectDir -Parent
    $ExistingDbDir = Join-Path $ParentDir "navidrome"
    if (Test-Path -LiteralPath (Join-Path $ExistingDbDir "navidrome.db")) {
        $env:ND_DATAFOLDER = $ExistingDbDir
    } else {
        $env:ND_DATAFOLDER = Join-Path $ProjectDir ".navidrome-data"
    }
}

$BackendUrl = "http://$($env:ND_ADDRESS):$($env:ND_PORT)"
$WebUrl = "http://localhost:$WebPort"
$RelayUrl = "http://localhost:$LyricsPort"
$BridgeUrl = "http://localhost:$BridgePort"

$LogDir = Join-Path $ProjectDir ".runner-logs"
$BackendStdout = Join-Path $LogDir "navidrome.stdout.log"
$BackendStderr = Join-Path $LogDir "navidrome.stderr.log"
$RelayStdout = Join-Path $LogDir "relay.stdout.log"
$RelayStderr = Join-Path $LogDir "relay.stderr.log"
$BridgeStdout = Join-Path $LogDir "bridge.stdout.log"
$BridgeStderr = Join-Path $LogDir "bridge.stderr.log"
$FrontendStdout = Join-Path $LogDir "frontend.stdout.log"
$FrontendStderr = Join-Path $LogDir "frontend.stderr.log"

$EnvFile = Join-Path $ProjectDir ".env"
$EnvExample = Join-Path $ProjectDir ".env.example"

function Test-PortInUse {
    param([int]$Port)

    try {
        $Listeners = @(
            Get-NetTCPConnection `
                -State Listen `
                -LocalPort $Port `
                -ErrorAction Stop
        )
        return ($Listeners.Count -gt 0)
    }
    catch {
        # Fallback via TcpClient if Get-NetTCPConnection is unavailable or restricted
        try {
            $Client = New-Object System.Net.Sockets.TcpClient
            $Client.Connect("127.0.0.1", $Port)
            $Client.Close()
            return $true
        } catch {
            return $false
        }
    }
}

function Show-PortOwner {
    param([int]$Port)

    try {
        $Listeners = @(
            Get-NetTCPConnection `
                -State Listen `
                -LocalPort $Port `
                -ErrorAction Stop
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
    catch {}
}

function Kill-Port {
    param([int]$Port)

    $Pids = @()
    try {
        $Listeners = @(
            Get-NetTCPConnection `
                -State Listen `
                -LocalPort $Port `
                -ErrorAction Stop
        )
        $Pids = @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
    } catch {}

    if ($Pids.Count -gt 0) {
        Write-Log ("Port {0} is occupied by PID(s): {1}. Stopping existing process..." -f $Port, ($Pids -join ", "))
        foreach ($PidToKill in $Pids) {
            try {
                & "$env:SystemRoot\System32\taskkill.exe" /PID $PidToKill /T /F 2>$null | Out-Null
            } catch {
                Stop-Process -Id $PidToKill -Force -ErrorAction SilentlyContinue
            }
        }

        for ($Attempt = 1; $Attempt -le 15; $Attempt++) {
            if (-not (Test-PortInUse -Port $Port)) {
                Write-Log "Port $Port is now free."
                return
            }
            Start-Sleep -Milliseconds 200
        }

        if (Test-PortInUse -Port $Port) {
            throw "Failed to free port $Port (occupied by PID(s): $($Pids -join ', '))."
        } else {
            Write-Log "Port $Port has been forcefully freed."
        }
    }
}

function Test-Backend {
    $PingUrl = (
        "$BackendUrl/rest/ping.view" +
        "?u=any&t=any&s=any&v=1.16.1" +
        "&c=plenrip-runner&f=json"
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

function Test-HttpOk {
    param([string]$Url)

    try {
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($Response.StatusCode -eq 200)
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            return ([int]$_.Exception.Response.StatusCode -eq 200)
        }
        return $false
    }
}

function Test-BridgeUp {
    param([string]$Url)

    try {
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        return ($Response.StatusCode -eq 200 -or $Response.StatusCode -eq 401)
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $Code = [int]$_.Exception.Response.StatusCode
            return ($Code -eq 200 -or $Code -eq 401)
        }
        return $false
    }
}

function Wait-ForService {
    param(
        [string]$Url,
        [int]$TimeoutSec,
        [string]$Name,
        [string]$LogFile,
        [System.Diagnostics.Process]$Process = $null,
        [switch]$IsBridge
    )

    for ($Attempt = 1; $Attempt -le ($TimeoutSec * 2); $Attempt++) {
        if ($null -ne $Process) {
            $Process.Refresh()
            if ($Process.HasExited) {
                Write-Log ""
                Write-Log "$Name process exited unexpectedly during startup (exit code $($Process.ExitCode))."
                if (Test-Path -LiteralPath $LogFile) {
                    Write-Log "--- $LogFile ---"
                    Get-Content -LiteralPath $LogFile -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
                }
                throw "$Name exited during startup."
            }
        }

        $IsUp = if ($IsBridge) { Test-BridgeUp -Url $Url } else { Test-HttpOk -Url $Url }
        if ($IsUp) {
            Write-Log "$Name is responding."
            return $true
        }
        Start-Sleep -Milliseconds 500
    }

    Write-Log ""
    Write-Log "$Name did not respond within ${TimeoutSec}s:"
    if (Test-Path -LiteralPath $LogFile) {
        Write-Log "--- $LogFile ---"
        Get-Content -LiteralPath $LogFile -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    }
    throw "$Name did not respond within the startup timeout."
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

    $ParentDir = Split-Path -Path $ProjectDir -Parent
    $Candidates = @(
        (Join-Path $ProjectDir "navidrome.exe"),
        (Join-Path $ProjectDir "bin\navidrome.exe"),
        (Join-Path $ProjectDir "tools\navidrome\navidrome.exe"),
        (Join-Path $ParentDir "navidrome\navidrome.exe"),
        (Join-Path $ParentDir "navidrome.exe")
    )

    if ($env:ProgramFiles) {
        $Candidates += Join-Path `
            $env:ProgramFiles `
            "Navidrome\navidrome.exe"
    }
    if ($env:LOCALAPPDATA) {
        $Candidates += Join-Path $env:LOCALAPPDATA "Programs\Navidrome\navidrome.exe"
        $Candidates += Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\navidrome.exe"
    }
    if ($env:USERPROFILE) {
        $Candidates += Join-Path $env:USERPROFILE "scoop\apps\navidrome\current\navidrome.exe"
        $Candidates += Join-Path $env:USERPROFILE "scoop\shims\navidrome.exe"
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
                -Tail 60 `
                -ErrorAction SilentlyContinue |
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
    Write-Log "  Plenrip Audio: Navidrome + Relay + Bridge + Frontend"
    Write-Log "========================================================"
    Write-Log ""
    Write-Log "Project: $ProjectDir"

    if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "package.json") -PathType Leaf)) {
        throw "package.json not found in project directory ($ProjectDir)"
    }

    $ClientIndex = Join-Path $ProjectDir "client\index.html"
    $RootIndex = Join-Path $ProjectDir "index.html"
    if (-not (Test-Path -LiteralPath $ClientIndex -PathType Leaf) -and -not (Test-Path -LiteralPath $RootIndex -PathType Leaf)) {
        throw "client\index.html not found in project directory ($ProjectDir)"
    }

    if (-not (Test-Path -LiteralPath (Join-Path $ProjectDir "relay") -PathType Container)) {
        throw "relay\ directory not found in project directory ($ProjectDir)"
    }

    $NodeCommand = Get-Command "node.exe" -CommandType Application -ErrorAction SilentlyContinue
    $BunCommand = Get-Command "bun.exe" -CommandType Application -ErrorAction SilentlyContinue
    if (-not $BunCommand) {
        $UserBun = Join-Path $HOME ".bun\bin\bun.exe"
        if (Test-Path -LiteralPath $UserBun -PathType Leaf) {
            $BunCommand = [PSCustomObject]@{ Source = $UserBun; Name = "bun.exe" }
        }
    }

    if (-not $NodeCommand -and -not $BunCommand) {
        throw "Neither Node.js nor Bun is available in PATH. Install Node.js or Bun and reopen the terminal."
    }
    $JsRuntime = if ($NodeCommand) { $NodeCommand } else { $BunCommand }

    # Avoid starting a second copy on top of an existing run / Kill occupied ports
    $PortsToCheck = @([int]$WebPort, [int]$LyricsPort)
    if ($Bridge -ne "0") {
        $PortsToCheck += [int]$BridgePort
    }

    foreach ($Port in $PortsToCheck) {
        if (Test-PortInUse -Port $Port) {
            if ($KillPorts -eq "1") {
                Kill-Port -Port $Port
            } else {
                Show-PortOwner -Port $Port
                throw (
                    "Port $Port is already in use. " +
                    "Stop the previous server before starting another runner, or set KILL_PORTS=1."
                )
            }
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
    }

    Write-Log ""
    Write-Log "Checking backend: $BackendUrl"

    if (Test-Backend) {
        Write-Log "Navidrome is already responding."
        Write-Log "Reusing it; this runner will not stop that existing server."
    }
    else {
        if (Test-PortInUse -Port ([int]$env:ND_PORT)) {
            Show-PortOwner -Port ([int]$env:ND_PORT)
            throw "Backend port $($env:ND_PORT) is occupied, but no Navidrome response was detected."
        }

        $NavidromeBinary = Find-Navidrome

        if (-not $NavidromeBinary) {
            throw "Navidrome executable not found. Put navidrome.exe in PATH, bin\navidrome.exe, or set NAVIDROME_BIN."
        }

        Write-Log "Starting Navidrome..."
        Write-Log "  Binary: $NavidromeBinary"
        Write-Log "  Music:  $($env:ND_MUSICFOLDER)"
        Write-Log "  Data:   $($env:ND_DATAFOLDER)"
        Write-Log "  Log:    $BackendStdout"

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
    Write-Log "Backend reachability verified. Account credentials are NOT verified."
    Write-Log "Sign in from the app: Settings > Navidrome Server."
    Write-Log ""

    # --- Lyrics relay (Bun, port 3005) ---
    if ($null -eq $BunCommand) {
        throw "Bun is required for the lyrics relay but was not found in PATH or ~/.bun/bin. Install Bun (https://bun.sh) and reopen the terminal."
    }

    $RelayDir = Join-Path $ProjectDir "relay"

    # Install relay dependencies if missing (e.g. fresh unzip)
    if (-not (Test-Path (Join-Path $RelayDir "node_modules"))) {
        Write-Log "Installing lyrics relay dependencies (bun install)..."
        Push-Location $RelayDir
        try {
            & $BunCommand.Source install
            if ($LASTEXITCODE -ne 0) {
                throw "bun install failed for the lyrics relay (exit code $LASTEXITCODE)."
            }
        } finally {
            Pop-Location
        }
    }

    Write-Log "Starting lyrics relay..."
    Write-Log "  Log: $RelayStdout"

    $env:PORT = "$LyricsPort"
    $RelayProcess = Start-Process `
        -FilePath $BunCommand.Source `
        -ArgumentList @("run", "src/index.ts") `
        -WorkingDirectory $RelayDir `
        -NoNewWindow `
        -PassThru `
        -RedirectStandardOutput $RelayStdout `
        -RedirectStandardError $RelayStderr

    Wait-ForService -Url "http://localhost:$LyricsPort/api/health" -TimeoutSec 30 -Name "Lyrics relay" -LogFile $RelayStderr -Process $RelayProcess

    # --- NAS file bridge (Node, port 3001) ---
    if ($Bridge -ne "0") {
        $NasKeyFile = Join-Path $ProjectDir ".nas-api-key"
        if ([string]::IsNullOrWhiteSpace($env:NAS_API_KEY)) {
            if (Test-Path -LiteralPath $NasKeyFile -PathType Leaf) {
                $env:NAS_API_KEY = (Get-Content -LiteralPath $NasKeyFile -Raw).Trim()
            } else {
                $RandomBytes = New-Object byte[] 32
                $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
                $Rng.GetBytes($RandomBytes)
                $env:NAS_API_KEY = ($RandomBytes | ForEach-Object { "{0:x2}" -f $_ }) -join ""
                $Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
                [System.IO.File]::WriteAllText($NasKeyFile, $env:NAS_API_KEY, $Utf8NoBom)
                Write-Log "Generated a NAS API key and saved it to .nas-api-key."
            }
        }

        Write-Log "Starting file bridge..."
        Write-Log "  Log: $BridgeStdout"
        Write-Log "  NAS API key: $($env:NAS_API_KEY)"
        Write-Log "  (Enter this key in the app under Settings > NAS Storage.)"

        $env:FILE_BRIDGE_PORT = "$BridgePort"
        $BridgeProcess = Start-Process `
            -FilePath $JsRuntime.Source `
            -ArgumentList @("server/file-bridge.js") `
            -WorkingDirectory $ProjectDir `
            -NoNewWindow `
            -PassThru `
            -RedirectStandardOutput $BridgeStdout `
            -RedirectStandardError $BridgeStderr

        Wait-ForService -Url "http://localhost:$BridgePort/api/files/list?path=" -TimeoutSec 30 -Name "File bridge" -LogFile $BridgeStderr -Process $BridgeProcess -IsBridge
    } else {
        Write-Log "File bridge skipped (BRIDGE=0)."
    }

    # --- Frontend (Node static server) ---
    Write-Log "Starting frontend..."
    Write-Log "  Log: $FrontendStdout"

    $env:WEB_PORT = "$WebPort"
    $DevProcess = Start-Process `
        -FilePath $JsRuntime.Source `
        -ArgumentList @("server/serve.js") `
        -WorkingDirectory $ProjectDir `
        -NoNewWindow `
        -PassThru `
        -RedirectStandardOutput $FrontendStdout `
        -RedirectStandardError $FrontendStderr

    Wait-ForService -Url "$WebUrl/" -TimeoutSec 30 -Name "Frontend" -LogFile $FrontendStderr -Process $DevProcess

    Write-Log ""
    Write-Log "All services are up:"
    Write-Log "  Frontend:     $WebUrl"
    Write-Log "  Lyrics relay: $RelayUrl"
    if ($Bridge -ne "0") {
        Write-Log "  File bridge:  $BridgeUrl"
    }
    Write-Log "  Navidrome:    $BackendUrl"
    Write-Log ""
    Write-Log "Press Ctrl+C to stop all services started by this runner."
    Write-Log "--------------------------------------------------------"

    while (-not $DevProcess.HasExited) {
        Start-Sleep -Milliseconds 300
        $DevProcess.Refresh()

        if ($null -ne $RelayProcess) {
            $RelayProcess.Refresh()
            if ($RelayProcess.HasExited) {
                throw "Lyrics relay stopped unexpectedly."
            }
        }

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
    Write-Log "Stopping services started by this runner..."

    Stop-OwnedProcess -Process $DevProcess -Label "Frontend"
    Stop-OwnedProcess -Process $BridgeProcess -Label "File Bridge"
    Stop-OwnedProcess -Process $RelayProcess -Label "Lyrics Relay"
    Stop-OwnedProcess -Process $BackendProcess -Label "Navidrome"

    Write-Log "Shutdown complete."
}

exit $RunnerExitCode
