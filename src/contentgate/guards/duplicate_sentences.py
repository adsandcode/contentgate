"""Two pages that share too many sentences word for word.

Sentences are split on 。！？ and on . ! ? followed by whitespace or the end of
the text, so a decimal point does not end a sentence. Sentences shorter than
ten characters are ignored ("Yes." is not duplication). Text is what a crawler
sees with JavaScript off, so shared navigation and footers do not count.

The share is measured in characters: of all the characters in page A's
sentences, how many sit in sentences that also appear verbatim in page B. It is
measured both ways and the larger figure is the verdict, because a short page
copied whole into a long one is a small share of the long page and all of the
short one.
"""

import re

from ..markup import WS, WS_CLASS
from .crawler_text import crawler_text

DEFAULT_MAX_SHARE = 0.15
MIN_SENTENCE_CHARS = 10

_SPLIT = re.compile("[。！？]|[.!?](?![^" + WS_CLASS + "])")


def sentences(text):
    """Unique sentences of at least MIN_SENTENCE_CHARS characters, in order."""
    out, seen = [], set()
    for part in _SPLIT.split(text):
        s = part.strip(WS)
        if len(s) >= MIN_SENTENCE_CHARS and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def share(a, b):
    """Share of a's sentence characters found in sentences of b."""
    if not a:
        return 0.0
    in_b = set(b)
    return sum(len(s) for s in a if s in in_b) / sum(len(s) for s in a)


def overlaps(pages):
    """For a site: given each page's sentences(), yield (i, j, share_i_in_j,
    share_j_in_i) for every pair i < j sharing at least one sentence.

    Uses an index from sentence to pages, so pages that share nothing cost
    nothing; comparing every pair directly is quadratic in the page count.
    """
    totals = [sum(len(s) for s in p) for p in pages]
    owners = {}
    for i, p in enumerate(pages):
        for s in p:
            owners.setdefault(s, []).append(i)
    shared = {}
    for s, who in owners.items():
        for x in range(len(who)):
            for y in range(x + 1, len(who)):
                key = (who[x], who[y])
                shared[key] = shared.get(key, 0) + len(s)
    for (i, j), n in sorted(shared.items()):
        yield i, j, n / totals[i], n / totals[j]


def _percent(x):
    return int(x * 100 + 0.5)


def check(html_a, html_b, max_share=DEFAULT_MAX_SHARE):
    """Return (problems, details)."""
    a = sentences(crawler_text(html_a))
    b = sentences(crawler_text(html_b))
    a_in_b, b_in_a = share(a, b), share(b, a)
    in_b = set(b)
    shared = [s for s in a if s in in_b]
    problems = []
    if max(a_in_b, b_in_a) > max_share:
        problems.append(
            "pages share sentences verbatim: {}% of A appears in B, {}% of B appears in A; "
            "limit {}%".format(_percent(a_in_b), _percent(b_in_a), _percent(max_share)))
    return problems, {"a_in_b": a_in_b, "b_in_a": b_in_a,
                      "shared": [s[:80] for s in shared[:5]]}
