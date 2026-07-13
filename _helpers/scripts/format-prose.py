#!/usr/bin/env python3
"""Wrap long markdown prose paragraphs at sentence boundaries.

Honors the "one sentence per line, no line break inside a sentence" rule from ``docs/agent-instructions/style.md`` and adds a soft ceiling: any prose line longer than ``MAX`` characters (default 180) is split at the last safe sentence boundary that keeps each chunk under ``MAX``.

Safe boundaries: ``[.!?]`` + space + uppercase ASCII letter. Lines that contain no safe boundary (long URL, hash reference, fenced code, ...) are left untouched so we never break a sentence in the middle of a word.

Non-prose lines are passed through verbatim:

* blank lines, ATX headings, list items, table rows, blockquotes, code fences (`` ``` `` and indented), and YAML frontmatter (``---`` blocks).

Line endings (CRLF vs LF) and the trailing newline of the input are preserved so the formatter does not rewrite the file's encoding.

Usage
-----
::

    python3 _helpers/scripts/format-prose.py <file-or-dir> [more ...]
    python3 _helpers/scripts/format-prose.py --check <file-or-dir>   # dry run, exit 1 on diff
    MAX=200 python3 _helpers/scripts/format-prose.py path/to/dir

A directory target is walked recursively for ``*.md`` files. Hidden directories (names starting with ``.``) and the common build / dependency / personal trees (``node_modules``, ``dist``, ``out``, ``__pycache__``,0 ``.venv``, ``venv``, ``_Private``) are skipped automatically.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

MAX = int(os.environ.get("MAX", "180"))
if MAX < 40:
    print(
        f'[format-prose] invalid MAX={os.environ.get("MAX")} (must be >= 40)',
        file=sys.stderr,
    )
    sys.exit(2)

_SENTENCE_RE = re.compile(r"[.!?]\s+(?=[A-Z])")
_HEADING_RE = re.compile(r"^#{1,6}\s")
_LIST_RE = re.compile(r"^\s*(?:[-*+]|\d+\.)\s")

# Directories pruned when walking a directory target. They contain
# generated, dependency, or personal material that should never be
# reformatted by this tool.
_SKIP_DIRS = frozenset(
    {
        "node_modules",
        "dist",
        "out",
        "__pycache__",
        ".venv",
        "venv",
        "_Private",
    }
)


def _is_code_fence(line: str) -> bool:
    return line.startswith("```")


def _is_table_row(line: str) -> bool:
    return line.lstrip().startswith("|")


def _is_heading(line: str) -> bool:
    return bool(_HEADING_RE.match(line.lstrip()))


def _is_list_item(line: str) -> bool:
    return bool(_LIST_RE.match(line))


def _is_blockquote(line: str) -> bool:
    return line.lstrip().startswith(">")


def _is_indented_code(line: str) -> bool:
    return line.startswith("    ") or line.startswith("\t")


def wrap_at_sentences(line: str, max_len: int) -> list[str]:
    """Split a prose line into chunks of at most ``max_len`` characters.

    Chunks are cut at the last safe sentence boundary that keeps the
    accumulated length under ``max_len``. If a single sentence exceeds
    ``max_len`` it is emitted oversized rather than broken mid-word so
    the loop always makes forward progress.
    """
    if len(line) <= max_len:
        return [line]

    starts = [0]
    for m in _SENTENCE_RE.finditer(line):
        starts.append(m.end())
    if len(starts) == 1:
        # No safe boundary: leave the line alone rather than break a word.
        return [line]

    chunks: list[str] = []
    i = 0
    while i < len(starts):
        j = i + 1
        while j < len(starts) and starts[j] - starts[i] <= max_len:
            j += 1
        end_idx = j - 1
        if end_idx == i:
            # A single sentence exceeds max: emit it oversized, move on.
            upper = starts[i + 1] if i + 1 < len(starts) else len(line)
            chunks.append(line[starts[i]:upper].rstrip())
            i = i + 1
        else:
            chunks.append(line[starts[i]:starts[end_idx]].rstrip())
            i = end_idx
    return chunks


def format_markdown(text: str) -> str:
    """Return ``text`` with every prose line shortened to at most MAX chars.

    The function tracks YAML frontmatter, fenced code blocks, and other
    non-prose constructs so the rewrap never touches them. Line endings
    (CRLF vs LF) and the trailing newline of the input are preserved.
    """
    eol = "\r\n" if "\r\n" in text else "\n"
    # ``splitlines()`` drops the trailing newline; we re-apply it below
    # only if the original had one.
    lines = text.splitlines()
    out: list[str] = []
    in_fence = False
    in_frontmatter = False
    frontmatter_closed = False

    for line in lines:
        if _is_code_fence(line):
            in_fence = not in_fence
            out.append(line)
            continue
        if in_fence:
            out.append(line)
            continue

        # YAML frontmatter only counts as such at the very top of the file.
        if not frontmatter_closed and line.strip() == "---":
            is_opening = not in_frontmatter and all(l.strip() == "" for l in out)
            if is_opening:
                in_frontmatter = True
                out.append(line)
                continue
            if in_frontmatter:
                in_frontmatter = False
                frontmatter_closed = True
                out.append(line)
                continue
        if in_frontmatter:
            out.append(line)
            continue
        frontmatter_closed = True

        if (
            line.strip() == ""
            or _is_heading(line)
            or _is_list_item(line)
            or _is_table_row(line)
            or _is_blockquote(line)
            or _is_indented_code(line)
        ):
            out.append(line)
            continue

        out.extend(wrap_at_sentences(line, MAX))

    result = eol.join(out)
    if text.endswith("\n") and not result.endswith("\n"):
        result += eol
    return result


def _should_skip_dir(name: str) -> bool:
    return name in _SKIP_DIRS or name.startswith(".")


def _display_path(path: Path) -> str:
    try:
        return str(path.relative_to(Path.cwd()))
    except ValueError:
        return str(path)


def _expand_targets(raw_targets: list[str]) -> tuple[list[Path], bool]:
    """Expand each target into the ``*.md`` files to process.

    A file is returned as-is (non-``.md`` files are reported and skipped).
    A directory is walked recursively; see ``_SKIP_DIRS`` and
    ``_should_skip_dir`` for the prune list. The second tuple element is
    True if at least one target was unresolvable (so the caller can map
    it to a non-zero exit code).
    """
    files: list[Path] = []
    any_missing = False
    for raw in raw_targets:
        path = Path(raw)
        if not path.exists():
            print(f"not found: {raw}", file=sys.stderr)
            any_missing = True
            continue
        if path.is_file():
            if path.suffix.lower() == ".md":
                files.append(path)
            else:
                print(f"skip (not .md): {raw}", file=sys.stderr)
            continue
        if path.is_dir():
            for root, dirs, filenames in os.walk(path):
                # Prune skipped directories in-place so os.walk does not
                # descend into them.
                dirs[:] = sorted(d for d in dirs if not _should_skip_dir(d))
                for name in sorted(filenames):
                    if name.lower().endswith(".md"):
                        files.append(Path(root) / name)
            continue
        print(f"skip (not a file or directory): {raw}", file=sys.stderr)
        any_missing = True
    return files, any_missing


def main(argv: list[str]) -> int:
    args = list(argv)
    check = bool(args) and args[0] == "--check"
    raw_targets = args[1:] if check else args

    if not raw_targets:
        print(
            "Usage: python3 _helpers/scripts/format-prose.py [--check] <file-or-dir> [...]",
            file=sys.stderr,
        )
        return 2

    files, any_missing = _expand_targets(raw_targets)
    if not files:
        if any_missing:
            return 1
        print("no .md files found under the given targets", file=sys.stderr)
        return 0

    diffs = 0
    for path in files:
        display = _display_path(path)
        try:
            orig = path.read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"read error ({exc}): {display}", file=sys.stderr)
            diffs += 1
            continue
        next_text = format_markdown(orig)
        if next_text == orig:
            print(f"unchanged: {display}")
            continue
        diffs += 1
        if check:
            print(f"would rewrap: {display}")
        else:
            # Write in binary so Python does not translate newlines; the
            # formatter already chose the right EOL.
            path.write_bytes(next_text.encode("utf-8"))
            print(f"rewrapped:   {display}")

    if check and diffs > 0:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
