param([string]$Bun = "bun")
$ErrorActionPreference = "Stop"
$mutex = [Threading.Mutex]::new($false, 'Local\LeafviewBrowserStudy2026')
$held = $false
$old = $env:LEAFVIEW_SCAN_MUTEX
try {
    try { $held = $mutex.WaitOne() } catch [Threading.AbandonedMutexException] { $held = $true }
    if (-not $held) { throw 'Study lock unavailable' }
    $env:LEAFVIEW_SCAN_MUTEX = 'held'
    & $Bun "$PSScriptRoot/run.ts"
    if ($LASTEXITCODE -ne 0) { throw "Scan study failed ($LASTEXITCODE)" }
} finally {
    $env:LEAFVIEW_SCAN_MUTEX = $old
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
