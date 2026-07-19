"""Subprocess-with-timeout parser runner (guide Phase 6).

Any parser crash, hang past the timeout, or garbage input surfaces as a raised
ParseError in the caller — never a worker-process death.
"""

import os
import subprocess
import sys
from pathlib import Path

from ingest.config import parse_timeout_s


class ParseError(Exception):
    pass


def _child_env() -> dict[str, str]:
    # The child must resolve `ingest` the same way the parent did, regardless of
    # how the parent was launched (pytest sys.path hack vs container PYTHONPATH).
    src_dir = str(Path(__file__).resolve().parents[1])
    env = dict(os.environ)
    env["PYTHONPATH"] = src_dir + os.pathsep + env.get("PYTHONPATH", "")
    return env


def run_parser_sandboxed(
    parser_name: str, object_bytes: bytes, timeout_s: float | None = None
) -> str:
    if timeout_s is None:
        timeout_s = parse_timeout_s()
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "ingest.parse_entry", parser_name],
            input=object_bytes,
            capture_output=True,
            timeout=timeout_s,
            env=_child_env(),
        )
    except subprocess.TimeoutExpired as exc:
        raise ParseError(f"{parser_name} timed out after {timeout_s}s") from exc
    if proc.returncode != 0:
        raise ParseError(
            f"{parser_name} exited {proc.returncode}: {proc.stderr.decode('utf-8', 'replace')[:300]}"
        )
    return proc.stdout.decode("utf-8", errors="replace")
