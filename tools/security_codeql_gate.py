"""Fail CI on high/critical security results; print rule IDs and paths only."""
import json
from pathlib import Path
import sys


def high_findings(document):
    findings = []
    for run in document.get("runs", []):
        rules = {rule["id"]: rule for rule in run["tool"]["driver"].get("rules", [])}
        for result in run.get("results", []):
            rule = rules[result["ruleId"]]
            score = float(rule.get("properties", {}).get("security-severity", 0))
            if score >= 7:
                locations = result.get("locations", [])
                location = locations[0].get("physicalLocation", {}) if locations else {}
                findings.append((rule["id"], location.get("artifactLocation", {}).get("uri", "unknown")))
    return findings


if __name__ == "__main__":
    reports = sorted(Path(sys.argv[1]).rglob("*.sarif"))
    if not reports:
        raise SystemExit("CodeQL produced no SARIF report")
    findings = [finding for report in reports for finding in high_findings(json.loads(report.read_text(encoding="utf8")))]
    for rule, location in findings:
        print(f"High/critical CodeQL security finding: {rule} in {location}")
    raise SystemExit(1 if findings else 0)
