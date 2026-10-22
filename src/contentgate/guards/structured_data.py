"""JSON-LD structured data that parses and says what the page is.

Read with a real JSON parser, never grep. A block with a trailing comma is
ignored by every consumer, and a grep for "@type" would still count it.

Types are collected from each top-level item, from items in @graph, and from
the author, publisher and creator of those items, because that is where
Organization and Person usually live. @type may be a string or a list.

A page that declares ProfilePage is not required to be an Article: Google's
ProfilePage documentation lists author pages among its intended uses.
"""

import json
import re

from ..markup import WS

DEFAULT_REQUIRE_TYPES = ("Article", "BreadcrumbList", "Organization")

_BLOCK = re.compile(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", re.I | re.S | re.A)
_NESTED = ("author", "publisher", "creator")


def _reject_constant(name):
    # Python's json module accepts NaN and Infinity; JSON does not, and neither
    # does JSON.parse. A block containing them is broken for real consumers.
    raise ValueError("{} is not valid JSON".format(name))


def _add_types(out, value):
    for t in (value if isinstance(value, list) else [value]):
        if isinstance(t, str) and t:
            out.append(t)


def _node(out, item):
    _add_types(out, item.get("@type"))
    for key in _NESTED:
        v = item.get(key)
        for x in (v if isinstance(v, list) else [v]):
            if isinstance(x, dict):
                _add_types(out, x.get("@type"))


def _dates(value):
    """Every non-empty string dateModified, anywhere in the parsed block."""
    found, stack = [], [value]
    while stack:
        v = stack.pop()
        if isinstance(v, dict):
            dm = v.get("dateModified")
            if isinstance(dm, str) and dm:
                found.append(dm)
            stack.extend(reversed(list(v.values())))
        elif isinstance(v, list):
            stack.extend(reversed(v))
    return found


def parse(html):
    """Return (types, broken, dates).

    types   every @type found, in document order, duplicates kept
    broken  one error message per block that did not parse
    dates   every dateModified value found
    """
    types, broken, dates = [], [], []
    for block in _BLOCK.findall(html):
        try:
            data = json.loads(block.strip(WS), parse_constant=_reject_constant)
        except Exception as exc:  # ValueError, or RecursionError on absurd nesting
            broken.append(str(exc)[:80])
            continue
        dates.extend(_dates(data))
        for item in (data if isinstance(data, list) else [data]):
            if not isinstance(item, dict):
                continue
            _node(types, item)
            graph = item.get("@graph")
            for g in (graph if isinstance(graph, list) else [graph]):
                if isinstance(g, dict):
                    _node(types, g)
    return types, broken, dates


def check(html, require_types=DEFAULT_REQUIRE_TYPES, require_date_modified=True):
    """Return (problems, details)."""
    types, broken, dates = parse(html)
    present = set(types)
    wanted = list(require_types)
    if "ProfilePage" in present:
        wanted = [t for t in wanted if t != "Article"]
    missing = [t for t in wanted if t not in present]

    problems = []
    if broken:
        problems.append("{} JSON-LD block(s) do not parse: {}".format(
            len(broken), "; ".join(broken)))
    if missing:
        problems.append("structured data lacks {} (found: {})".format(
            ", ".join(missing), ", ".join(sorted(present)) or "none"))
    if require_date_modified and not dates:
        problems.append("no dateModified in the structured data")
    return problems, {"types": sorted(present), "broken_blocks": len(broken),
                      "date_modified": dates}
