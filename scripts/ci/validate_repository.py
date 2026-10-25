#!/usr/bin/env python3
"""Minimal public-repository guardrails; NOT a substitute for GitHub secret scanning."""
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
required = (
    "AGENTS.md",
    "docs/ai/HANDOFF-PROTOCOL.md",
    "docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md",
)
problems = []
for name in required:
    if not (ROOT / name).is_file():
        problems.append(f"Missing required collaboration document: {name}")
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
for name in filter(None, tracked):
    path = pathlib.PurePosixPath(name)
    lower = path.name.lower()
    if lower == ".env" or (lower.startswith(".env.") and lower not in {".env.example", ".env.sample", ".env.template"}):
        problems.append(f"Prohibited tracked secret-config filename: {name}")
    if lower.endswith((".pem", ".p12", ".pfx", ".key", ".jks", ".keystore")):
        problems.append(f"Prohibited tracked private-key filename: {name}")
if problems:
    print("\n".join("ERROR: " + p for p in problems), file=sys.stderr)
    raise SystemExit(1)
print("PASS: mandatory GitHub handoff documents and basic tracked-file-name checks.")
if not (ROOT / "package-lock.json").exists():
    print("NOTE: no root package-lock.json yet. App typecheck/lint/unit-test CI is not active until AI-4 creates a real application scaffold.")
