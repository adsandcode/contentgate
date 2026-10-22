"""The schema.org subtype table must be the same in both implementations.

A required type is satisfied by its listed subtypes. If the two tables drift,
a BlogPosting passes in Python and blocks in TypeScript, and the fixtures only
notice for the handful of types they happen to use.
"""

import re
import json
import pathlib

from contentgate.guards.structured_data import SUBTYPES, satisfied

TS = pathlib.Path(__file__).resolve().parents[1] / "mcp" / "src" / "audit.ts"


def _ts_table(source):
    m = re.search(r"export const SCHEMA_SUBTYPES[^=]*= (\{.*?\n\});", source, re.S)
    assert m, "SCHEMA_SUBTYPES not found in audit.ts"
    return json.loads(m.group(1))


def test_tables_match():
    assert _ts_table(TS.read_text(encoding="utf-8")) == SUBTYPES


def test_a_changed_entry_would_be_caught():
    src = TS.read_text(encoding="utf-8").replace('"BlogPosting",', '"BlogPost",', 1)
    assert _ts_table(src) != SUBTYPES


def test_subtypes_satisfy_and_strangers_do_not():
    assert satisfied("Article", {"BlogPosting"})
    assert satisfied("Organization", {"NewsMediaOrganization"})
    assert not satisfied("Organization", {"Person"})
    assert not satisfied("Article", {"WebPage"})
    assert satisfied("BreadcrumbList", {"BreadcrumbList"})
