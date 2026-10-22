"""Run the single-page SEO/GEO checks together.

Each check stays usable on its own; this only gives them one entry point and
one result shape: {check: {"verdict": "pass"|"block", "problems": [...], ...}}.
"""

from . import crawler_text, structured_data, outbound_links, images, favicon, stock_phrases

CHECKS = ("visible_text", "structured_data", "outbound_links", "images", "favicon", "stock_phrases")


def audit(html, url, checks=CHECKS,
          min_chars=crawler_text.DEFAULT_MIN_CHARS,
          require_types=structured_data.DEFAULT_REQUIRE_TYPES,
          require_date_modified=True,
          cite_ok=(),
          phrases=stock_phrases.DEFAULT_PHRASES):
    """Return {check_name: result} for each requested check, in CHECKS order.

    Raises ValueError for an unknown check name, an invalid page URL, or a
    cite_ok entry that is too broad. A configuration that cannot be trusted
    gets no verdict at all.
    """
    unknown = [c for c in checks if c not in CHECKS]
    if unknown:
        raise ValueError("unknown check(s): {}; known: {}".format(
            ", ".join(unknown), ", ".join(CHECKS)))
    runners = {
        "visible_text": lambda: crawler_text.check(html, min_chars),
        "structured_data": lambda: structured_data.check(html, require_types, require_date_modified),
        "outbound_links": lambda: outbound_links.check(html, url, cite_ok),
        "images": lambda: images.check(html),
        "favicon": lambda: favicon.check(html, url),
        "stock_phrases": lambda: stock_phrases.check(html, phrases),
    }
    results = {}
    for name in CHECKS:
        if name not in checks:
            continue
        problems, details = runners[name]()
        result = {"verdict": "block" if problems else "pass", "problems": problems}
        result.update(details)
        results[name] = result
    return results


def failed(results):
    return [name for name, r in results.items() if r["verdict"] == "block"]
