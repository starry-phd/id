#!/usr/bin/env python3
"""Fail if a tracked file name looks like a secret or local credential file."""
from pathlib import PurePosixPath
import subprocess
import sys

ALLOWED_ENV = {".env.example"}
SECRET_SUFFIXES = (".pem", ".p8", ".p12", ".pfx", ".key", ".jks", ".keystore", ".mobileprovision")

tracked = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
problems = []
for name in filter(None, tracked):
    low = PurePosixPath(name).name.lower()
    if (low == ".env" or low.startswith(".env.")) and low not in ALLOWED_ENV:
        problems.append(name)
    elif low == ".dev.vars" or low.startswith(".dev.vars."):
        problems.append(name)
    elif low.endswith(SECRET_SUFFIXES):
        problems.append(name)

if problems:
    for name in problems:
        print(f"ERROR: secret-like file is tracked: {name}", file=sys.stderr)
    sys.exit(1)
print(f"PASS: {len([t for t in tracked if t])} tracked files, no secret-like file names.")
