"""Target keywords must actually appear in the rendered page.

The failure this prevents: a writer covers the topic, the page reads well, and
the one term with real search volume never appears in the body. Nobody notices
until the page has been live for a month with no impressions.

Two rules that look fussy and are not:

1. No whitespace normalisation. "web hosting" and "webhosting" are two
   different strings with two different search volumes, and in languages written
   without spaces between words the gap can be an order of magnitude. Letting one
   satisfy the other is how a guard passes a page that targets neither.

2. Boilerplate is excluded from the count. A site-wide call-to-action block that
   happens to contain the keyword will otherwise satisfy this check on every
   page, which means the check passes always and guards nothing.
"""

from ..htmltext import visible_text

DEFAULT_PRIMARY_MIN_HITS = 3


def check(html, keywords, scope=None, exclude_classes=(),
          primary_min_hits=DEFAULT_PRIMARY_MIN_HITS):
    """Return (problems, rows).

    keywords          {keyword: monthly_volume}
    primary_min_hits  every term at the highest volume must appear this many
                      times; every other term at least once

    rows is [(keyword, volume, hits, needed, ok)] for reporting.
    """
    body = visible_text(html, scope, exclude_classes).lower()
    if not keywords:
        return [], []

    # Every term tied at the highest volume is primary. Picking one of them
    # would make the verdict depend on the order of keys in a JSON file, which
    # is not a rule, it is an accident that happens to be stable until someone
    # reorders the table.
    top = max(keywords.values())
    primaries = {k for k, v in keywords.items() if v == top}

    rows, problems = [], []
    for kw, volume in sorted(keywords.items(), key=lambda kv: (-kv[1], kv[0])):
        hits = body.count(kw.lower())
        needed = primary_min_hits if kw in primaries else 1
        ok = hits >= needed
        rows.append((kw, volume, hits, needed, ok))
        if not ok:
            problems.append(
                "missing keyword {!r} (volume {}): found {} time(s), needs {}".format(
                    kw, volume, hits, needed))
    return problems, rows


def covered_volume(rows):
    """Monthly volume actually covered, and the total on the table."""
    return (sum(r[1] for r in rows if r[4]), sum(r[1] for r in rows))
