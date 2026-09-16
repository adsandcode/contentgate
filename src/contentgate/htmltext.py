"""Extract human-visible text from HTML, scoped and with boilerplate removed.

Why this exists instead of a regex: a guard that strips tags with a regex will
happily read text out of <script>, and it cannot tell "inside the article" from
"inside the site-wide call-to-action block". Both mistakes make a guard pass
when it should fail, which is worse than having no guard.
"""

from html.parser import HTMLParser

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr"}
NON_TEXT = {"script", "style", "template", "noscript"}


class _Extractor(HTMLParser):
    def __init__(self, scope=None, exclude_classes=()):
        super().__init__(convert_charrefs=True)
        self.scope = scope                  # (tag, class) or None for whole document
        self.exclude = set(exclude_classes)
        self.depth = 0                      # nesting depth inside the scope
        self.inside = scope is None
        self.skip_until = None              # depth at which the excluded block started
        self.non_text = 0
        self.chunks = []

    def _classes(self, attrs):
        return set(dict(attrs).get("class", "").split())

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        if not self.inside:
            if self.scope and tag == self.scope[0] and self.scope[1] in self._classes(attrs):
                self.inside = True
                self.depth = 0
            return
        self.depth += 1
        if self.skip_until is None and self.exclude & self._classes(attrs):
            self.skip_until = self.depth
        if tag in NON_TEXT:
            self.non_text += 1

    def handle_startendtag(self, tag, attrs):
        return

    def handle_endtag(self, tag):
        if tag in VOID or not self.inside:
            return
        if tag in NON_TEXT and self.non_text:
            self.non_text -= 1
        if self.skip_until is not None and self.depth == self.skip_until:
            self.skip_until = None
        if self.scope and tag == self.scope[0] and self.depth == 0:
            self.inside = False
            return
        self.depth -= 1

    def handle_data(self, data):
        if self.inside and self.skip_until is None and not self.non_text:
            self.chunks.append(data)


def visible_text(html, scope=None, exclude_classes=()):
    """Return the visible text of `html`.

    scope            (tag, class) tuple, e.g. ("article", "post"). None = whole document.
    exclude_classes  any element carrying one of these classes is skipped, children included.
    """
    p = _Extractor(scope, exclude_classes)
    p.feed(html)
    p.close()
    return " ".join(p.chunks)


class _LinkCollector(HTMLParser):
    def __init__(self, scope=None, exclude_classes=()):
        super().__init__(convert_charrefs=True)
        self.inner = _Extractor(scope, exclude_classes)
        self.links = []

    def handle_starttag(self, tag, attrs):
        self.inner.handle_starttag(tag, attrs)
        if (tag == "a" and self.inner.inside
                and self.inner.skip_until is None and not self.inner.non_text):
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)

    def handle_endtag(self, tag):
        self.inner.handle_endtag(tag)

    def handle_data(self, data):
        self.inner.handle_data(data)


def links(html, scope=None, exclude_classes=()):
    """Return every href inside the scope, skipping excluded blocks."""
    p = _LinkCollector(scope, exclude_classes)
    p.feed(html)
    p.close()
    return p.links
