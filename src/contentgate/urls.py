"""Which host a link really goes to, decided the way a browser decides it.

urllib and browsers disagree on hostile or sloppy URLs, and the browser's
answer is the one that matters. Before resolving, an href is normalised the
way a browser reads it:

  - tabs and newlines anywhere are removed; leading and trailing whitespace
    and control characters are stripped
  - a backslash is a slash
  - after "http:" or "https:", any run of two or more slashes starts the host,
    and so does any run at all when the scheme differs from the page's
  - a scheme-relative link ("//host") skips every extra leading slash

Without that, "https://partner.example\\.gov.example/" reads to urllib as a host
under gov.example, while every browser goes to partner.example.

The splitting itself mirrors urllib.parse.urlsplit, written out here so the
result does not depend on which Python version runs it and so the TypeScript
port (mcp/src/urls.ts) can match it line for line.
"""

import re
import unicodedata

from .markup import WS

_C0_OR_SPACE = "".join(chr(c) for c in range(0x21))
STRIP = "".join(sorted(set(WS) | set(_C0_OR_SPACE)))
_SCHEME_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.")
_HTTP_PREFIX = re.compile(r"(https?):(/*)", re.I | re.A)
_QUERY_OR_FRAGMENT = re.compile(r"[?#]")


def split(u):
    """(scheme, netloc, tail) the way urlsplit reads them.

    netloc is None when there is no authority part; tail is whatever follows
    the netloc (or the scheme, when there is no netloc).
    """
    scheme = ""
    i = u.find(":")
    if (i > 0 and u[0].isascii() and u[0].isalpha()
            and all(c in _SCHEME_CHARS for c in u[:i])):
        scheme, u = u[:i].lower(), u[i + 1:]
    if not u.startswith("//"):
        return scheme, None, u
    end = len(u)
    for c in "/?#":
        k = u.find(c, 2)
        if k >= 0:
            end = min(end, k)
    return scheme, u[2:end], u[end:]


def hostname(netloc):
    """Lower-cased host of a netloc, or "" when there is none or it is invalid."""
    if ("[" in netloc) != ("]" in netloc):
        return ""
    if not netloc.isascii():
        # urllib refuses a netloc that NFKC normalisation would turn into one
        # carrying URL delimiters (a fullwidth solidus, for instance).
        n = netloc
        for c in "@:#?":
            n = n.replace(c, "")
        folded = unicodedata.normalize("NFKC", n)
        if folded != n and any(c in folded for c in "/?#@:"):
            return ""
    hostinfo = netloc.rpartition("@")[2]
    if "[" in hostinfo:
        host = hostinfo.partition("[")[2].partition("]")[0]
    else:
        host = hostinfo.partition(":")[0]
    return host.lower()


def page_parts(url):
    """(scheme, host, path) of the page's own URL.

    Raises ValueError unless it is an absolute http(s) URL with a host.
    """
    scheme, netloc, tail = split(url.strip(STRIP))
    host = hostname(netloc) if netloc else ""
    if scheme not in ("http", "https") or not host:
        raise ValueError("page url must be an absolute http(s) URL with a host: {!r}".format(url))
    return scheme, host, _QUERY_OR_FRAGMENT.split(tail, 1)[0]


def normalise(href, page_scheme):
    """`href` rewritten the way a browser reads it on a page_scheme page."""
    u = re.sub(r"[\t\n\r]", "", href).strip(STRIP).replace("\\", "/")
    m = _HTTP_PREFIX.match(u)
    if m:
        scheme = m.group(1).lower()
        if len(m.group(2)) >= 2 or scheme != page_scheme:
            u = scheme + "://" + u[m.end():]
    elif u.startswith("//"):
        u = "//" + u.lstrip("/")
    return u


def resolve(href, page_scheme, page_host):
    """(host, path, absolute) for `href` on a page at page_scheme://page_host.

    absolute is False for a link relative to the page, whose host is then
    page_host. host is "" for targets that are not http(s) (mailto:, tel:,
    javascript:) and for URLs a browser would refuse. path excludes the query
    and fragment.
    """
    scheme, netloc, tail = split(normalise(href, page_scheme))
    path = _QUERY_OR_FRAGMENT.split(tail, 1)[0]
    if scheme in ("", page_scheme):
        # Same scheme as the page: a link without a host is relative to it.
        if not netloc:
            return page_host, path, False
        return hostname(netloc), path, True
    if scheme not in ("http", "https") or netloc is None:
        return "", path, True
    return hostname(netloc), path, True


def resolve_host(href, page_scheme, page_host):
    """Host a browser opens for `href` on a page at page_scheme://page_host.

    Returns "" for targets that are not http(s) (mailto:, tel:, javascript:)
    and for URLs a browser would refuse.
    """
    return resolve(href, page_scheme, page_host)[0]


def under(host, domain):
    """host is domain itself or a subdomain of it, on a label boundary."""
    return host == domain or host.endswith("." + domain)
