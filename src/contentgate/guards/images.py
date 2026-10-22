"""Images without alt text or a declared width.

alt is how a crawler that cannot see the image learns what it shows; alt=""
is a deliberate statement that the image is decorative and is accepted. A
missing width means the browser cannot reserve space before the file arrives,
so the text jumps when it does (layout shift).

Only real <img> elements count: one written inside a script string is not an
image.
"""

from ..markup import tags, first_wins

REQUIRED = ("alt", "width")


def check(html):
    """Return (problems, details)."""
    total, lacking = 0, []
    for kind, tag, attrs, _ in tags(html):
        if kind != "start" or tag != "img":
            continue
        total += 1
        a = first_wins(attrs)
        missing = [x for x in REQUIRED if x not in a]
        if missing:
            lacking.append({"src": a.get("src") or "(no src)", "missing": missing})
    problems = []
    if lacking:
        problems.append("{} of {} image(s) lack alt or width: {}".format(
            len(lacking), total,
            "; ".join("{} ({})".format(x["src"], ", ".join(x["missing"])) for x in lacking[:5])))
    return problems, {"images": total, "lacking": lacking}
