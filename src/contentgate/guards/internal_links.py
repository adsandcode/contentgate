"""Content pages must link to the pages that pay for them.

A guide can rank, get read, and send nobody anywhere. The usual cause is that
the only commercial link on the page lives in the site-wide call-to-action
block, which every page has, which means the page itself sells nothing.

So the check ignores boilerplate and looks at the body only. Optionally it also
requires one concrete figure, because "contact us for a quote" is not an offer.

Only links into your own site count. A relative link does; an absolute link
counts only when its host is one of `site_hosts` or a subdomain of one,
compared on label boundaries, and with the href read the way a browser reads
it. Without `site_hosts`, absolute links never count: a link to
https://competitor.example/pricing/ ends in /pricing/ and sells someone
else's product. The money path is matched against the link's path, never its
query string.
"""

import re

from ..htmltext import links as extract_links, visible_text
from ..urls import resolve, under
from .outbound_links import normalise_domain, is_public_suffix_like

FIGURE = re.compile(r"(?<![A-Za-z])[$€£¥]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*\s?(?:USD|USDT|EUR|GBP|TWD|JPY)\b",
                    re.I)


def site_domains(site_hosts):
    """Normalise site_hosts ('https://www.Example.org/' -> 'example.org').

    Raises ValueError for an entry anyone can register under, which would make
    every site below it count as yours.
    """
    out = []
    for raw in site_hosts:
        d = normalise_domain(raw)
        if not d:
            continue
        if is_public_suffix_like(d):
            raise ValueError("site_hosts entry '{}' is a public suffix; every site under it "
                             "would count as yours".format(raw))
        out.append(d)
    return out


def own_path(href, domains):
    """The path of `href` if it points into the site, else None."""
    host, path, absolute = resolve(href, "https", "")
    if absolute and not (host and any(under(host, d) for d in domains)):
        return None
    return path


def check(html, money_paths, scope=None, exclude_classes=(),
          require_figure=False, figure_pattern=FIGURE, extra_evidence=(), site_hosts=()):
    """Return (problems, found_links).

    money_paths     path prefixes that count as commercial, e.g. ["/pricing/"]
    require_figure  also demand a concrete price or quantity in the body
    extra_evidence  literal strings that satisfy require_figure on their own,
                    e.g. named product modules
    site_hosts      hosts that are this site, e.g. ["www.example.org"]; absolute
                    links count only when they point at one of them
    """
    domains = site_domains(site_hosts)
    problems = []
    found = []
    for h in extract_links(html, scope, exclude_classes):
        path = own_path(h, domains)
        if path is not None and any(path.startswith(p) or ("/" + p.lstrip("/")) in path
                                    for p in money_paths):
            found.append(h)
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
