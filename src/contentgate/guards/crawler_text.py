"""The text a crawler sees when it does not run JavaScript.

Google renders JavaScript before indexing. Many AI crawlers do not: they read
the HTML the server sent and stop there. A page whose article is injected by a
script reads, to them, as a navigation bar and a footer. This check counts what
is left of the page with JavaScript off and fails when too little survives.

What counts:
  - <script> and <style> contents are dropped
  - if the page has a <main>, only <main> is read
  - <nav> and <footer> are dropped
  - <wbr> is a line-break opportunity, not a character, so it is removed
    without leaving a space; so is U+200B ZERO WIDTH SPACE
  - tags are stripped, entities decoded, whitespace collapsed

The default minimum of 1200 characters is a house rule, not a number published
by any search engine. Set your own.
"""

import re
from html import unescape

from ..markup import WS_CLASS

DEFAULT_MIN_CHARS = 1200

_SCRIPT_STYLE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.I | re.S | re.A)
_MAIN = re.compile(r"<main[^>]*>(.*?)</main>", re.I | re.S | re.A)
_NAV_FOOTER = re.compile(r"<(nav|footer)[^>]*>.*?</\1>", re.I | re.S | re.A)
_WBR = re.compile(r"<wbr[" + WS_CLASS + r"]*/?>", re.I | re.A)
_TAG = re.compile(r"<[^>]+>", re.S)
_WS_RUN = re.compile("[" + WS_CLASS + "]+")


def crawler_text(html):
    """Visible text of `html` with JavaScript off, whitespace collapsed."""
    t = _SCRIPT_STYLE.sub(" ", html)
    m = _MAIN.search(t)
    if m:
        t = m.group(1)
    t = _NAV_FOOTER.sub(" ", t)
    t = _WBR.sub("", t)
    t = _TAG.sub(" ", t)
    t = unescape(t).replace("\u200b", "")
    return _WS_RUN.sub(" ", t).strip(" ")


def check(html, min_chars=DEFAULT_MIN_CHARS):
    """Return (problems, details). details = {"chars": n}."""
    n = len(crawler_text(html))
    problems = []
    if n < min_chars:
        problems.append(
            "only {} character(s) of text are readable with JavaScript off; "
            "needs at least {}".format(n, min_chars))
    return problems, {"chars": n}
