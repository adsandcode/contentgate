"""External links that do not say what kind of link they are.

Google asks for paid and affiliate links to carry rel="sponsored" and for
user-generated links to carry rel="ugc"; "nofollow" covers the rest. An
ordinary editorial link needs no rel attribute at all. A machine cannot tell an
editorial citation from a paid placement, so this check reports every external
link with none of the three values, and you list the sites you cite editorially
in `cite_ok`.

Which host a link goes to is decided the way a browser decides it (see
contentgate.urls). A link is internal when its host is the page's host, minus
a leading "www.", or a subdomain of it, compared on label boundaries, so
evil-example.com is not under example.com.

rel is read from the first rel attribute on the tag, because that is the one a
browser uses; a second rel="nofollow" later in the same tag does nothing.
"""

import re
from collections import Counter

from ..markup import WS, WS_CLASS, tags, first_wins
from ..urls import page_parts, resolve_host, under

QUALIFIERS = ("nofollow", "sponsored", "ugc")

# Domains anyone can register under. Putting one in cite_ok would exempt every
# site below it; treating one as the page's own host would make all of them
# internal. Not the full Public Suffix List, only the likeliest slips.
TOO_BROAD = frozenset({
    "com.tw", "net.tw", "org.tw", "idv.tw", "game.tw", "club.tw", "ebiz.tw",
    "pages.dev", "workers.dev", "github.io", "vercel.app", "netlify.app", "web.app",
    "firebaseapp.com", "blogspot.com", "wordpress.com", "wixsite.com", "herokuapp.com",
    "appspot.com", "azurewebsites.net", "cloudfront.net", "amazonaws.com",
})
_CC_SECOND_LEVEL = re.compile(r"(?:com|net|org|co|idv)\.[a-z]{2}")
_REL_SPLIT = re.compile("[" + WS_CLASS + ",]+")
_SCHEME_PREFIX = re.compile(r"^[a-z][a-z0-9+.-]*://")
_WILDCARD_OR_WWW = re.compile(r"^(?:\*?\.|www\.)")


def is_public_suffix_like(domain):
    return domain in TOO_BROAD or _CC_SECOND_LEVEL.fullmatch(domain) is not None


def too_broad(domain):
    return "." not in domain or is_public_suffix_like(domain)


def normalise_domain(value):
    """'https://www.Docs.Example.org/x' -> 'docs.example.org'; '*.a.b' -> 'a.b'."""
    bare = _SCHEME_PREFIX.sub("", value.strip(WS).lower()).split("/")[0]
    return _WILDCARD_OR_WWW.sub("", bare)


def validate_cite_ok(entries):
    """Return (domains, problems). Empty entries are dropped."""
    domains, problems = [], []
    for raw in entries:
        d = normalise_domain(raw)
        if not d:
            continue
        if too_broad(d):
            problems.append(
                "cite_ok entry '{}' is too broad: it would exempt every site "
                "registered under it; list the specific site instead".format(raw))
            continue
        domains.append(d)
    return domains, problems


def rel_tokens(value):
    """rel values, lower-cased. Google accepts a space- or comma-separated list."""
    return [t for t in _REL_SPLIT.split(value.lower()) if t]


def scan(html, url, cite_ok=()):
    """Return (unqualified_hosts, cited_hosts), one entry per link, in order.

    Raises ValueError for an invalid page URL, a too-broad cite_ok entry, or a
    page host that is itself a public suffix.
    """
    allowed, problems = validate_cite_ok(cite_ok)
    if problems:
        raise ValueError("; ".join(problems))
    scheme, host, _path = page_parts(url)
    site = host[4:] if host.startswith("www.") else host
    if is_public_suffix_like(site):
        raise ValueError("page host '{}' is a public suffix; every site under it "
                         "would count as internal".format(site))
    unqualified, cited = [], []
    for kind, tag, attrs, _ in tags(html):
        if kind != "start" or tag != "a":
            continue
        a = first_wins(attrs)
        href = a.get("href")
        if not href:
            continue
        h = resolve_host(href, scheme, host)
        if not h or under(h, site):
            continue
        if any(q in QUALIFIERS for q in rel_tokens(a.get("rel", ""))):
            continue
        (cited if any(under(h, d) for d in allowed) else unqualified).append(h)
    return unqualified, cited


def summary(hosts, limit=5):
    """'a.example x2, b.example', most frequent first, ties in order of appearance."""
    return ", ".join(h if n == 1 else "{} x{}".format(h, n)
                     for h, n in Counter(hosts).most_common(limit))


def check(html, url, cite_ok=()):
    """Return (problems, details)."""
    unqualified, cited = scan(html, url, cite_ok)
    problems = []
    if unqualified:
        problems.append("{} external link(s) without rel nofollow, sponsored or ugc: {}".format(
            len(unqualified), summary(unqualified)))
    return problems, {"unqualified": unqualified, "cited": cited}
