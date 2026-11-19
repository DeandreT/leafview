param([Parameter(Mandatory=$true, Position=0)][string]$Script,
      [Parameter(ValueFromRemainingArguments=$true)][string[]]$ScriptArgs)
$ErrorActionPreference = 'Stop'
$mutex = [Threading.Mutex]::new($false,'Local\LeafviewBrowserStudy2026')
try {
    try { $null = $mutex.WaitOne() } catch [Threading.AbandonedMutexException] {}
    try { & bun (Join-Path $PSScriptRoot $Script) @ScriptArgs; $status = $LASTEXITCODE }
    finally { $mutex.ReleaseMutex() }
} finally { $mutex.Dispose() }
exit $status
