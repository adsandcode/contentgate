"""The home page must declare a favicon in a format Google Search can show.

Google reads the icon from a <link> in the head of the home page, so the check
runs only when the page URL's path is empty or "/". It fails when no icon is
declared there, or when every declared icon is in a format Google Search does
not list (SVG and WebP are the usual cases).

Accepted rel values are those Google documents: icon (which "shortcut icon"
contains), apple-touch-icon and apple-touch-icon-precomposed. A <link> counts
when it comes before </head> or <body>. The format is read from the file
extension of the href; an icon URL without one of the listed extensions counts
as unsupported.

Out of scope, because they need the built files or the network: whether the
file exists, its size, and whether it is square.
"""

import re

from ..markup import WS, WS_CLASS, tags, first_wins
from ..urls import page_parts

ICON_RELS = ("icon", "apple-touch-icon", "apple-touch-icon-precomposed")
# developers.google.com/search/docs/appearance/favicon-in-search lists
# BMP, GIF, ICO, PNG, JPEG, PPM and TIFF.
SUPPORTED_EXT = re.compile(r"\.(?:ico|png|gif|jpe?g|bmp|ppm|tiff?)$", re.I | re.A)
_REL_SPLIT = re.compile("[" + WS_CLASS + "]+")
_QUERY_OR_FRAGMENT = re.compile(r"[?#]")


def is_home_page(url):
    return page_parts(url)[2] in ("", "/")


def icons_in_head(html):
    """hrefs of icon <link>s that appear before </head> or <body>."""
    found = []
    for kind, tag, attrs, _ in tags(html):
        if (kind == "end" and tag == "head") or (kind == "start" and tag == "body"):
            break
        if kind != "start" or tag != "link":
            continue
        a = first_wins(attrs)
        rels = [t for t in _REL_SPLIT.split(a.get("rel", "").lower()) if t]
        href = a.get("href", "").strip(WS)
        if href and any(r in ICON_RELS for r in rels):
            found.append(href)
    return found


def supported(href):
    return SUPPORTED_EXT.search(_QUERY_OR_FRAGMENT.split(href, 1)[0]) is not None


def check(html, url):
    """Return (problems, details)."""
    if not is_home_page(url):
        return [], {"home_page": False, "icons": []}
    icons = icons_in_head(html)
    problems = []
    if not icons:
        problems.append('the home page declares no favicon (<link rel="icon"> in <head>); '
                        "Google Search reads it from the home page")
    elif not any(supported(h) for h in icons):
        problems.append("every declared favicon is in a format Google Search does not list "
                        "({}); use ICO, PNG, GIF, JPEG, BMP, PPM or TIFF".format(", ".join(icons)))
    return problems, {"home_page": True, "icons": icons}
