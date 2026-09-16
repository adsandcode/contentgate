"""Sitemap lastmod that tells the truth.

Stamping today's date on every URL on every build is the default behaviour of
most static site pipelines, and it is a lie told daily. Crawlers learn that the
field carries no information and stop acting on it, so the one signal you had
for "this page genuinely changed" is spent.

The fix is a state machine, not a timestamp. Hash the meaningful content of each
page, keep the hash and the date it last changed, and only move the date when
the hash moves.

Two traps this module handles, both learned the expensive way:

1. Volatile blocks. A visitor counter, a build id, a "related posts" strip that
   reshuffles will change the hash on every build and put you back where you
   started. Strip them before hashing.

2. The site-wide edit. Add a block to every page and every hash changes at once,
   so every lastmod moves, and the sitemap lies about the whole site on the same
   day. That is not a hash failure, it is a missing entry in the strip list, and
   it looks identical to a legitimate mass edit. So a run that moves more than a
   threshold share of pages stops and asks, rather than writing silently.
"""

import re
import json
import hashlib
from html.parser import HTMLParser

DEFAULT_BULK_CHANGE_THRESHOLD = 0.30

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}


class _Stripper(HTMLParser):
    """Serialise the document with excluded subtrees removed."""

    def __init__(self, strip_classes=(), strip_tags=("script", "style", "noscript")):
        super().__init__(convert_charrefs=True)
        self.strip_classes = set(strip_classes)
        self.strip_tags = set(strip_tags)
        self.out = []
        self.stack = []
        self.skip_depth = None

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)
        if self.skip_depth is not None:
            return
        classes = set(dict(attrs).get("class", "").split())
        if tag in self.strip_tags or (self.strip_classes & classes):
            self.skip_depth = len(self.stack)
            return
        self.out.append("<" + tag + ">")

    def handle_startendtag(self, tag, attrs):
        if self.skip_depth is None:
            self.out.append("<" + tag + "/>")

    def handle_endtag(self, tag):
        if self.skip_depth is not None and len(self.stack) == self.skip_depth:
            self.skip_depth = None
            if self.stack:
                self.stack.pop()
            return
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
        elif tag in self.stack:
            while self.stack and self.stack.pop() != tag:
                pass
        if self.skip_depth is None:
            self.out.append("</" + tag + ">")

    def handle_data(self, data):
        if self.skip_depth is None:
            self.out.append(data)


def content_hash(body, strip_classes=(), strip_patterns=()):
    """Stable hash of the meaningful content of a page."""
    for pattern in strip_patterns:
        body = re.sub(pattern, "", body, flags=re.S)
    p = _Stripper(strip_classes)
    p.feed(body)
    p.close()
    normalised = re.sub(r"\s+", " ", "".join(p.out)).strip()
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


def resolve(body, previous_hash, previous_lastmod, today,
            strip_classes=(), strip_patterns=()):
    """Decide this page's lastmod. Returns (lastmod, changed, new_hash)."""
    new_hash = content_hash(body, strip_classes, strip_patterns)
    if previous_hash is None:
        return (previous_lastmod or today), (previous_hash is None), new_hash
    if new_hash == previous_hash:
        return previous_lastmod, False, new_hash
    return today, True, new_hash


def load_state(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}


def save_state(path, state):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")


def bulk_change_warning(changed, total, threshold=DEFAULT_BULK_CHANGE_THRESHOLD):
    """Return a warning string when too much of the site moved at once."""
    if total == 0 or not changed:
        return None
    share = changed / total
    if share <= threshold:
        return None
    return ("{} of {} pages ({:.0%}) changed hash in one run, above the {:.0%} "
            "threshold. If you added or edited a site-wide block, add it to the "
            "strip list instead of letting every lastmod move."
            .format(changed, total, share, threshold))
