"""The TypeScript entity table must be Python's, character for character.

Both implementations count visible characters after decoding references. If
the table in mcp/src/entities.ts drifts from html.entities.html5, "&hellip;"
becomes one character in Python and eight in TypeScript, and the two give
different verdicts on the same page.
"""

import re
import html
import json
import html.entities
import pathlib

TS = pathlib.Path(__file__).resolve().parents[1] / "mcp" / "src" / "entities.ts"


def _const(source, name):
    m = re.search(r"export const " + name + r"[^=]*= (?:new Set\()?(.*?)\)?;\n", source, re.S)
    assert m, name + " not found in entities.ts"
    return json.loads(m.group(1))


def test_named_references_match_python():
    assert _const(TS.read_text(encoding="utf-8"), "HTML5_ENTITIES") == html.entities.html5


def test_numeric_reference_rules_match_python():
    src = TS.read_text(encoding="utf-8")
    assert {int(k): v for k, v in _const(src, "INVALID_CHARREFS").items()} == html._invalid_charrefs
    assert set(_const(src, "INVALID_CODEPOINTS")) == set(html._invalid_codepoints)


def test_a_changed_entry_would_be_caught():
    src = TS.read_text(encoding="utf-8").replace('"hellip;": "\\u2026"', '"hellip;": "..."')
    assert _const(src, "HTML5_ENTITIES") != html.entities.html5
