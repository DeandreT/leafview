$ErrorActionPreference = 'Stop'
$mutex = [Threading.Mutex]::new($false, 'Local\LeafviewBrowserStudy2026')
$held = $false
try {
    $wait = [Diagnostics.Stopwatch]::StartNew()
    Write-Host 'Waiting for the shared Leafview browser study mutex'
    try { $held = $mutex.WaitOne() } catch [Threading.AbandonedMutexException] { $held = $true }
    $env:LEAFVIEW_CANVAS_LOCK_OWNER = "$PID"
    Write-Host ("Mutex acquired after {0:n1}s; starting Bun canvas study" -f $wait.Elapsed.TotalSeconds)
    bun "$PSScriptRoot/run.mjs"
    if ($LASTEXITCODE -ne 0) { throw "Canvas study failed ($LASTEXITCODE)" }
} finally {
    Remove-Item Env:LEAFVIEW_CANVAS_LOCK_OWNER -ErrorAction SilentlyContinue
    if ($held) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
