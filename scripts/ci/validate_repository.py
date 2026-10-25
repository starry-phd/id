#!/usr/bin/env python3
"""Fail-closed public repository hygiene and custom-agent profile validation."""
from pathlib import Path, PurePosixPath
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
required = [
    "AGENTS.md",
    "docs/ai/HANDOFF-PROTOCOL.md",
    "docs/contracts/FUTURE-HGLOBAL-MEMBER-API.md",
    "scripts/ci/validate_repository.py",
    ".github/workflows/starry-ci.yml",
    ".github/agents/ai-0-coordinator.agent.md",
    ".github/agents/ai-1-auth-member.agent.md",
    ".github/agents/ai-2-billing-iap.agent.md",
    ".github/agents/ai-3-battery-trust.agent.md",
    ".github/agents/ai-4-expo-workers.agent.md",
]
issues = []
for name in required:
    if not (ROOT / name).is_file():
        issues.append(f"Missing required Starry configuration: {name}")
for name in required:
    if not name.endswith(".agent.md") or not (ROOT / name).is_file():
        continue
    content = (ROOT / name).read_text(encoding="utf-8")
    if not content.startswith("---\n") or "\n---\n" not in content[4:]:
        issues.append(f"Agent profile lacks YAML frontmatter: {name}")
    for token in ("description:", "target: github-copilot", "tools:"):
        if token not in content[:800]:
            issues.append(f"Agent profile missing {token}: {name}")
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
for name in filter(None, tracked):
    path = PurePosixPath(name)
    low = path.name.lower()
    if low == ".env" or (low.startswith(".env.") and low not in (".env.example", ".env.sample", ".env.template")):
        issues.append(f"Forbidden tracked environment secret filename: {name}")
    if low == ".dev.vars" or low.startswith(".dev.vars.") or low.endswith((".pem", ".p12", ".pfx", ".key", ".jks", ".keystore")):
        issues.append(f"Forbidden tracked key/secret filename: {name}")
if issues:
    print("\n".join("ERROR: " + e for e in issues), file=sys.stderr)
    raise SystemExit(1)
print("PASS: Starry collaboration scope, Copilot agent profiles, and basic tracked-file safeguards.")
if not (ROOT / "package-lock.json").exists():
    print("NOTICE: app is not initialized; TypeScript/lint/unit tests are NOT yet validated.")
