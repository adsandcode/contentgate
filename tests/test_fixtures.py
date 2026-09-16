"""pytest wrapper around the shared fixture file.

The cases live in fixtures/cases.json because the TypeScript implementation runs
them too. This file only makes them visible to pytest, one test per case, so a
failure names the case instead of saying "the suite failed".
"""

import io
import json
import pathlib

import pytest

from contentgate import selftest

CASES = json.loads(pathlib.Path(selftest.FIXTURES).read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize(
    "case",
    CASES,
    ids=["{}: {}".format(c["guard"], c["name"]) for c in CASES],
)
def test_case(case):
    assert selftest._verdict(case) == case["expect"]


def test_suite_runs_clean():
    ok, passed, failed = selftest.run(io.StringIO())
    assert ok, "{} case(s) failed".format(failed)
    assert passed == len(CASES)


def test_at_least_half_the_cases_expect_a_block():
    """A suite of happy paths proves nothing. Keep the negative cases dominant."""
    blocking = sum(1 for c in CASES if c["expect"] == "block")
    assert blocking >= len(CASES) // 2, (
        "only {} of {} cases expect the guard to block".format(blocking, len(CASES)))
