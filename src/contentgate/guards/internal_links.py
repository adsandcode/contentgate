"""Content pages must link to the pages that pay for them.

A guide can rank, get read, and send nobody anywhere. The usual cause is that
the only commercial link on the page lives in the site-wide call-to-action
block, which every page has, which means the page itself sells nothing.

So the check ignores boilerplate and looks at the body only. Optionally it also
requires one concrete figure, because "contact us for a quote" is not an offer.
"""

import re

from ..htmltext import links as extract_links, visible_text

FIGURE = re.compile(r"(?<![A-Za-z])[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\s?(?:USD|USDT|EUR|GBP|TWD|JPY)\b",
                    re.I)


def check(html, money_paths, scope=None, exclude_classes=(),
          require_figure=False, figure_pattern=FIGURE, extra_evidence=()):
    """Return (problems, found_links).

    money_paths     path prefixes that count as commercial, e.g. ["/pricing/"]
    require_figure  also demand a concrete price or quantity in the body
    extra_evidence  literal strings that satisfy require_figure on their own,
                    e.g. named product modules
    """
    problems = []
    found = [h for h in extract_links(html, scope, exclude_classes)
             if any(h.startswith(p) or ("/" + p.lstrip("/")) in h for p in money_paths)]
    if not found:
        problems.append(
            "no link to a commercial page in the body; looked for {}".format(list(money_paths)))

    if require_figure:
        body = visible_text(html, scope, exclude_classes)
        has_figure = bool(figure_pattern.search(body))
        has_named = any(e and e in body for e in extra_evidence)
        if not (has_figure or has_named):
            problems.append("no concrete figure or named product capability in the body")

    return problems, found
