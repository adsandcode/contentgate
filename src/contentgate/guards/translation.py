"""Structural drift between a source document and its translation.

Translation review does not scale by eye. Six locales times twenty articles is
120 documents, and the expensive errors are not stylistic. They are a dropped
table row, a price that changed digits, an internal link that lost its locale
prefix and now sends every reader back to the source-language site.

This compares structure, not meaning. It cannot tell you the translation is
good. It can tell you the translation is not the same document, which is the
failure that actually ships.
"""

import re

# Deliberately does not match a figure carrying a local-currency code.
# "R$1,250" next to "$1,250 USDT" is a translator doing the right thing for a
# local reader, not a price that changed. Trailing comma or period is excluded
# so "$150, and" does not read as the token "$150,".
PRICE = re.compile(r"(?<![A-Za-z])\$\d[\d,]*(?<![,.])(?:\s?USDT)?")

EMOJI = re.compile(r"[\U0001F300-\U0001FAFF☀-➿⬀-⯿]")

# Characters that must not survive into a translation out of a CJK source.
CJK = re.compile(r"[一-鿿㐀-䶿！-～]")

MD_LINK = re.compile(r"\]\((/[^)]*)\)")


def fingerprint(text, locale=None):
    """Structural fingerprint. With a locale, internal links are compared with
    the locale prefix removed so the paths line up against the source."""
    links = MD_LINK.findall(text)
    if locale:
        links = [re.sub(r"^/" + re.escape(locale) + r"(?=/)", "", u) or "/" for u in links]
    return {
        "headings": re.findall(r"^(#{1,6})\s", text, re.M),
        "tags": re.findall(r"<\s*/?\s*([a-zA-Z][a-zA-Z0-9]*)", text),
        "table_rows": len(re.findall(r"^\s*\|", text, re.M)),
        "links": sorted(links),
        "prices": sorted(PRICE.findall(text)),
    }


def check(source, translation, locale,
          require_front_matter=True,
          forbid_source_script=True,
          source_script=CJK,
          check_locale_prefix=True):
    """Return a list of human-readable problems. Empty list means it passes."""
    problems = []
    lines = translation.split("\n")

    if require_front_matter:
        if not lines or not lines[0].startswith("# "):
            problems.append("line 1 is not an H1 heading")
        if len(lines) < 2 or not lines[1].startswith("> "):
            problems.append("line 2 is not a summary blockquote")

    a, b = fingerprint(source), fingerprint(translation, locale)

    if a["headings"] != b["headings"]:
        problems.append("heading sequence differs (source {}, translation {})".format(
            len(a["headings"]), len(b["headings"])))
    if a["tags"] != b["tags"]:
        problems.append("HTML tag sequence differs (source {}, translation {})".format(
            len(a["tags"]), len(b["tags"])))
    if a["table_rows"] != b["table_rows"]:
        problems.append("table row count differs (source {}, translation {})".format(
            a["table_rows"], b["table_rows"]))
    if a["links"] != b["links"]:
        missing = sorted(set(a["links"]) - set(b["links"]))
        extra = sorted(set(b["links"]) - set(a["links"]))
        problems.append("internal links differ; missing {} unexpected {}".format(
            missing[:3], extra[:3]))
    if a["prices"] != b["prices"]:
        problems.append("price tokens differ: source {} translation {}".format(
            a["prices"], b["prices"]))

    if check_locale_prefix and locale:
        raw = MD_LINK.findall(translation)
        bare = [u for u in raw if not u.startswith("/" + locale + "/")]
        doubled = [u for u in raw if u.startswith("/" + locale + "/" + locale + "/")]
        if bare:
            problems.append("{} internal link(s) missing the /{} prefix: {}".format(
                len(bare), locale, bare[:3]))
        if doubled:
            problems.append("{} internal link(s) carry the locale prefix twice: {}".format(
                len(doubled), locale and doubled[:3]))

    if forbid_source_script and source_script.search(translation):
        problems.append("{} untranslated source-script character(s) remain".format(
            len(source_script.findall(translation))))

    # An em dash is only the translator's doing if the source did not have one.
    if translation.count("—") > source.count("—"):
        problems.append("em dashes introduced (source {}, translation {})".format(
            source.count("—"), translation.count("—")))

    if EMOJI.search(translation):
        problems.append("{} emoji present".format(len(EMOJI.findall(translation))))

    return problems
