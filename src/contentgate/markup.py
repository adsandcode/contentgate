"""Tags and their attributes, in document order, for the page-level checks.

The page audit needs three things from markup: the links, the images, and the
icon declarations in the head. All three come from here, read by the standard
library's HTML parser, so that a URL inside a script string or an HTML comment
is never mistaken for a link.

The TypeScript implementation ports the same tokenisation rules
(mcp/src/html.ts, scanTags). Both are held to fixtures/cases.json. On badly
malformed markup the standard library itself changed behaviour in 2025, so the
fixtures stick to markup every supported Python version reads the same way.
"""

from html.parser import HTMLParser

# Exactly the characters for which Python's str.isspace() is true, which is
# also what \s means in a Python str pattern. Spelled out because JavaScript's
# \s is a different set (it adds U+FEFF and drops U+001C-U+001F and U+0085), and
# both implementations have to collapse, strip and split on the same characters.
WS = ("\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680"
      "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
      "\u2028\u2029\u202f\u205f\u3000")

# The same set as a regular-expression character class body.
WS_CLASS = (r"\t\n\x0b\x0c\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a"
            r"\u2028\u2029\u202f\u205f\u3000")


class _Scanner(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tokens = []

    @staticmethod
    def _attrs(attrs):
        # A valueless attribute (<img alt>) is present with an empty value.
        return [(k, "" if v is None else v) for k, v in attrs]

    def handle_starttag(self, tag, attrs):
        self.tokens.append(("start", tag, self._attrs(attrs), False))

    def handle_startendtag(self, tag, attrs):
        self.tokens.append(("start", tag, self._attrs(attrs), True))

    def handle_endtag(self, tag):
        self.tokens.append(("end", tag, [], False))


def neutralise_marked_sections(html):
    """`<![if !IE]>` and `<![ CDATA[` crash older versions of html.parser
    (it tries to parse them as SGML marked sections). Browsers treat them as
    comments. Turning the opener into text keeps everything after it readable,
    which is what matters: the link that follows must still be found."""
    return html.replace("<![", "&lt;![")


def tags(html):
    """Return [(kind, tag, attrs, self_closing)] in document order.

    kind is "start" or "end"; attrs is a list of (name, value) pairs in source
    order, duplicates included, so callers can apply first-wins the way a
    browser does.
    """
    p = _Scanner()
    p.feed(neutralise_marked_sections(html))
    p.close()
    return p.tokens


def first_wins(attrs):
    """Attribute dict where a repeated attribute keeps its first value.

    That is what browsers do: rel="noopener" rel="nofollow" is not nofollow.
    """
    out = {}
    for k, v in attrs:
        out.setdefault(k, v)
    return out
