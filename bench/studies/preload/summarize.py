"""Summarize a --preload run, including completed preloads on no-open visits."""
import json
import statistics
import sys


def summarize(path):
    with open(path, encoding="utf-8") as f:
        run = json.load(f)
    print(run["note"])
    print("choice_ms early click_ms list_ms bytes_after_list_ready")
    for dwell in (0, 500, 1500, -1):
        for early in (False, True):
            group = [s for s in run["samples"] if s["dwellMs"] == dwell and s["early"] == early]
            if len(group) != run["rounds"] or any(s["markerVerified"] != (dwell >= 0) for s in group):
                raise ValueError("missing run or marker")
            lat = [round(statistics.median(s[key] for s in group)) if dwell >= 0 else "-"
                   for key in ["clickMs", "listMs"]]
            transferred = [sum(x["encodedBodyBytes"] for x in s["transfers"]) for s in group]
            print(dwell, early, *lat, round(statistics.median(transferred)))


if __name__ == "__main__":
    for path in sys.argv[1:] or ["results/preload-study.json", "results/preload-shared-study.json"]:
        summarize(path)
