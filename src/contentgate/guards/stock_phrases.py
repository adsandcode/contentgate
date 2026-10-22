"""Stock phrases an editor would cut.

This is an editorial style check, not a detector of machine-written text. It
looks for phrases you have decided read as filler: connectives that open a
paragraph without saying anything, summaries that announce themselves. Nothing
about a phrase's presence proves who or what wrote the page.

The default list is Traditional Chinese, because that is where it was built and
tested. For any other language, supply your own list; the defaults will simply
never match. Matching is literal and case-insensitive, on the text a crawler
sees with JavaScript off (see crawler_text), so a phrase inside a script or in
the navigation does not count.
"""

from .crawler_text import crawler_text

DEFAULT_PHRASES = (
    "總的來說", "值得注意的是", "無論如何", "綜上所述", "首先，", "其次，",
    "最後，", "此外，", "然而，", "因此，", "總而言之", "在這個快節奏",
)


def check(html, phrases=DEFAULT_PHRASES):
    """Return (problems, details). details["found"] maps phrase to count."""
    text = crawler_text(html).lower()
    found = {}
    for p in phrases:
        if not p:
            continue
        n = text.count(p.lower())
        if n:
            found[p] = n
    problems = []
    if found:
        problems.append("{} stock phrase(s) found: {}".format(
            len(found), ", ".join("'{}' ({})".format(p, n) for p, n in found.items())))
    return problems, {"found": found}
