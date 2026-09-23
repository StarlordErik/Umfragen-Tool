"""Compatibility shim for existing Python/JetBrains Run configurations.

The platform itself starts in Node. Importing this module never loads Olive.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys

from .environment import ROOT


def run() -> None:
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js 24 LTS fehlt. Siehe README.md.")
    arguments = sys.argv[1:]
    if "--no-browser" not in arguments and "--open-browser" not in arguments:
        arguments = [*arguments, "--open-browser"]
    environment = {**os.environ, "PLATFORM_PARENT_PIPE": "1"}
    # Keep the interpreter selected by an existing JetBrains Python configuration.
    environment.setdefault("OLIVE_PYTHON", sys.executable)
    child = subprocess.Popen(
        [node, str(ROOT / "scripts/server.ts"), *arguments],
        cwd=ROOT, env=environment, stdin=subprocess.PIPE,
    )
    try:
        code = child.wait()
    except KeyboardInterrupt:
        code = 0
    finally:
        # Closing the dedicated pipe asks Node to stop, including its Olive child.
        child.stdin.close()
        try:
            child.wait(timeout=12)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()
    raise SystemExit(code if code > 0 else 0)
