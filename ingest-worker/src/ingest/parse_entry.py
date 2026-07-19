"""Sandboxed child entrypoint: `python -m ingest.parse_entry <parser_name>`.

Reads untrusted bytes on stdin, writes extracted text (UTF-8) to stdout, exits
non-zero on ANY exception. The parent (sandbox.py) turns non-zero/timeout into a
document-level ParseError — a crash here can never take the worker down.
"""

import sys

from ingest.parsers import PARSERS


def main() -> int:
    parser_name = sys.argv[1]
    data = sys.stdin.buffer.read()
    try:
        text = PARSERS[parser_name](data)
    except Exception as exc:  # noqa: BLE001 — any failure is a parse failure
        print(f"parse failed ({parser_name}): {exc}", file=sys.stderr)
        return 1
    sys.stdout.buffer.write(text.encode("utf-8"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
