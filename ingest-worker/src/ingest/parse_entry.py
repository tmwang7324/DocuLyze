"""Sandboxed child entrypoint: `python -m ingest.parse_entry <parser_name>`.

Reads untrusted bytes on stdin, writes extracted Markdown (UTF-8) to the parent
over a RESERVED copy of fd 1, and points the real fd 1 at stderr for the duration
of the parse. Exits non-zero on ANY exception. The parent (sandbox.py) turns
non-zero/timeout into a document-level ParseError — a crash here can never take
the worker down.

Why the fd dance: the Docling/torch/onnx stack is chatty (progress bars, logs,
and — crucially — NATIVE C writes straight to fd 1) that a Python-level
`sys.stdout` swap would miss. Anything on fd 1 would be concatenated into the
payload and silently corrupt the Markdown, so we hand the parser a stderr-backed
fd 1 and keep the real stdout private to this module.
"""

import os
import sys

# Quiet the ML stack at the source (belt-and-suspenders with the fd redirect
# below, and keeps stderr readable for real diagnostics). setdefault so an
# explicit parent override still wins.
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TQDM_DISABLE", "1")

from ingest.parsers import PARSERS


def main() -> int:
    parser_name = sys.argv[1]
    data = sys.stdin.buffer.read()

    # Reserve fd 1 for the payload BEFORE the parser (or its imports) can write
    # anything: dup the real stdout aside, then point fd 1 at stderr so every
    # stray write — Python-level OR native C — lands on stderr, not the payload.
    payload_fd = os.dup(1)
    os.dup2(2, 1)

    try:
        text = PARSERS[parser_name].parse(data)  # actual parsing; parser_name <- content type
    except Exception as exc:  # noqa: BLE001 — any failure is a parse failure
        print(f"parse failed ({parser_name}): {exc}", file=sys.stderr)
        return 1

    # os.fdopen wraps the reserved fd in a buffered writer that handles partial
    # writes (large Markdown over a pipe) and closes the fd on exit.
    with os.fdopen(payload_fd, "wb") as payload:
        payload.write(text.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
