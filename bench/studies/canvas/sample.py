"""Windows external sampler. Sum private commit across supplied live Chromium PIDs.
Emit a first sample before the ready flag. The stop flag ends the window.
Single-threaded, with a hard timeout if the driver exits unexpectedly.
"""
import ctypes as C
from ctypes import wintypes as W
import json
import statistics
import sys
from pathlib import Path
import time

class Counters(C.Structure):
    _fields_ = [("cb", W.DWORD), ("faults", W.DWORD)] + [
        (n, C.c_size_t) for n in ("peakWS", "ws", "peakPaged", "paged",
                                   "peakNonpaged", "nonpaged", "pagefile", "peakPagefile", "private")]

k = C.WinDLL("kernel32", use_last_error=True)
k.OpenProcess.argtypes = [W.DWORD, W.BOOL, W.DWORD]
k.OpenProcess.restype = W.HANDLE
k.CloseHandle.argtypes = [W.HANDLE]
p = C.WinDLL("psapi", use_last_error=True)
p.GetProcessMemoryInfo.argtypes = [W.HANDLE, C.POINTER(Counters), W.DWORD]
handles = []
readings = []

def take():
    total = 0
    for h in handles:
        c = Counters(cb=C.sizeof(Counters))
        if not p.GetProcessMemoryInfo(h, C.byref(c), c.cb):
            raise C.WinError(C.get_last_error())
        total += c.private
    readings.append((time.perf_counter(), total))

directory = Path(sys.argv[1])
try:
    for pid in sys.argv[2:]:
        h = k.OpenProcess(0x410, False, int(pid))
        if not h:
            raise C.WinError(C.get_last_error())
        handles.append(h)
    take()
    (directory / "ready").touch()
    deadline = time.monotonic() + 90
    while not (directory / "stop").exists():
        if time.monotonic() > deadline:
            raise TimeoutError("Sampler stop flag missing")
        time.sleep(.01)
        if not (directory / "stop").exists():
            take()
    take()
    gaps = [1000*(b[0]-a[0]) for a,b in zip(readings,readings[1:])]
    (directory / "result.json").write_text(json.dumps(dict(count=len(readings), peakBytes=max(r[1] for r in readings),
                          initialBytes=readings[0][1], medianGapMs=statistics.median(gaps),
                          maxGapMs=max(gaps), spanMs=1000*(readings[-1][0]-readings[0][0]))))
finally:
    for h in handles:
        k.CloseHandle(h)
