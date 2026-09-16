"""Run the shared negative-test cases against this implementation.

A guard that has never been shown to fail is decoration. Every case in
fixtures/cases.json states an expected verdict, and half of them expect the
guard to block. The TypeScript implementation runs the same file, so the two
cannot quietly drift apart.
"""

import io
import os
import json
import pathlib

from .guards import keywords, translation, internal_links, claims, lastmod

FIXTURES = pathlib.Path(__file__).resolve().parents[2] / "fixtures" / "cases.json"


def _verdict(case):
    """Return 'pass' or 'block' for one case."""
    g, i = case["guard"], case["input"]

    if g == "keywords":
        problems, _ = keywords.check(
            i["html"], i["keywords"],
            scope=tuple(i["scope"]) if i.get("scope") else None,
            exclude_classes=i.get("exclude_classes", ()),
            primary_min_hits=i.get("primary_min_hits", keywords.DEFAULT_PRIMARY_MIN_HITS))
        return "block" if problems else "pass"

    if g == "translation":
        problems = translation.check(
            i["source"], i["translation"], i["locale"],
            forbid_source_script=i.get("forbid_source_script", True),
            check_locale_prefix=i.get("check_locale_prefix", True))
        return "block" if problems else "pass"

    if g == "internal_links":
        problems, _ = internal_links.check(
            i["html"], i["money_paths"],
            scope=tuple(i["scope"]) if i.get("scope") else None,
            exclude_classes=i.get("exclude_classes", ()),
            require_figure=i.get("require_figure", False))
        return "block" if problems else "pass"

    if g == "claims":
        return "block" if claims.check(i["text"]) else "pass"

    if g == "lastmod":
        strip = i.get("strip_classes", ())
        prev_hash = lastmod.content_hash(i["previous_body"], strip)
        got, _changed, _h = lastmod.resolve(
            i["body"], prev_hash, i["previous_lastmod"], i["today"], strip)
        return "pass" if got == i["expect_lastmod"] else "block"

    raise ValueError("unknown guard in fixtures: " + g)


def run(stream=None, fixtures=FIXTURES):
    """Execute every case. Returns (ok, passed, failed)."""
    out = stream if stream is not None else io.StringIO()
    data = json.loads(pathlib.Path(fixtures).read_text(encoding="utf-8"))
    passed = failed = 0
    current = None
    for case in data["cases"]:
        if case["guard"] != current:
            current = case["guard"]
            print("  " + current, file=out)
        got = _verdict(case)
        ok = got == case["expect"]
        passed, failed = (passed + 1, failed) if ok else (passed, failed + 1)
        print("    [{}] expected {:<5} got {:<5}  {}".format(
            "ok" if ok else "FAIL", case["expect"], got, case["name"]), file=out)
    print("  {} passed, {} failed".format(passed, failed), file=out)
    return failed == 0, passed, failed


if __name__ == "__main__":
    import sys
    ok, p, f = run(sys.stdout)
    sys.exit(0 if ok else 2)
