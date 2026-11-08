"""Fail CI on high/critical security results; print rule IDs and paths only."""
import json
import hashlib
from pathlib import Path
import sys


def high_findings(document):
    findings = []
    for run in document.get("runs", []):
        components = [run["tool"]["driver"], *run["tool"].get("extensions", [])]
        rules = {rule["id"]: rule for component in components for rule in component.get("rules", [])}
        for result in run.get("results", []):
            rule = rules[result["ruleId"]]
            score = float(rule.get("properties", {}).get("security-severity", 0))
            if score >= 7:
                locations = result.get("locations", [])
                location = locations[0].get("physicalLocation", {}) if locations else {}
                findings.append((rule["id"], location.get("artifactLocation", {}).get("uri", "unknown")))
    return findings


def reviewed_constraint(rule, location, root, entries):
    """Review applies only to an exact rule, repository path and source digest."""
    root = Path(root).resolve()
    target = (root / location).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        return False
    digest = hashlib.sha256(target.read_bytes().replace(b"\r\n", b"\n")).hexdigest()
    return any(entry["rule"] == rule and entry["path"] == location and
               entry["sha256"] == digest and entry.get("reason") for entry in entries)


if __name__ == "__main__":
    reports = sorted(Path(sys.argv[1]).rglob("*.sarif"))
    if not reports:
        raise SystemExit("CodeQL produced no SARIF report")
    findings = [finding for report in reports for finding in high_findings(json.loads(report.read_text(encoding="utf8")))]
    triage_path = Path(".github/codeql-reviewed-constraints.json")
    entries = json.loads(triage_path.read_text(encoding="utf8")) if triage_path.exists() else []
    findings = [(rule, location) for rule, location in findings
                if not reviewed_constraint(rule, location, Path.cwd(), entries)]
    for rule, location in findings:
        print(f"High/critical CodeQL security finding: {rule} in {location}")
    raise SystemExit(1 if findings else 0)
