"""Command line entry point.

Exit codes are the contract, because the whole point is to stop a deploy:

  0  everything passed
  1  at least one guard failed on your content
  2  the guards' own negative tests failed, so no verdict was given

A run always executes the negative tests first. A guard that cannot prove it
still catches a known-bad input does not get to say your site is fine.
"""

import sys
import json
import argparse
import pathlib

from . import config as config_mod
from . import selftest as selftest_mod
from .guards import keywords, translation, internal_links, claims, lastmod
from .guards import page_audit, duplicate_sentences, crawler_text, structured_data, stock_phrases
from .guards.crawler_text import crawler_text as _crawler_text

OK, FAIL, MARK = "[ ok ]", "[FAIL]", "[warn]"


def _glob(root, pattern):
    return sorted(pathlib.Path(root).glob(pattern))


def _read(p):
    return pathlib.Path(p).read_text(encoding="utf-8")


def run_keywords(cfg, report):
    g = cfg.guard("keywords")
    table = json.loads(_read(cfg.resolve(g["table"])))
    failures = 0
    for slug in sorted(k for k in table if not k.startswith("_")):
        # A key of the form "<locale>/<slug>" addresses a localised copy of the
        # page. Sites lay that out differently ("/en/blog/x/" vs "/blog/en/x/"),
        # so it gets its own template rather than a guessed rule.
        if "/" in slug and g.get("page_for_locale_slug"):
            locale, name = slug.split("/", 1)
            page = cfg.resolve(g["page_for_locale_slug"].format(locale=locale, slug=name))
        else:
            page = cfg.resolve(g["page_for_slug"].format(slug=slug))
        if not page.exists():
            report.append((FAIL, "keywords", "{}: page not found at {}".format(slug, page)))
            failures += 1
            continue
        problems, rows = keywords.check(
            _read(page), table[slug], cfg.scope, cfg.exclude_classes,
            g.get("primary_min_hits", keywords.DEFAULT_PRIMARY_MIN_HITS))
        covered, total = keywords.covered_volume(rows)
        if problems:
            failures += 1
            report.append((FAIL, "keywords", "{} ({}/{} volume covered)".format(slug, covered, total)))
            for p in problems:
                report.append(("", "", "    " + p))
        else:
            report.append((OK, "keywords", "{} ({}/{} volume covered)".format(slug, covered, total)))
    return failures


def run_internal_links(cfg, report):
    g = cfg.guard("internal_links")
    failures = 0
    for page in _glob(cfg.root, g["pages"]):
        problems, found = internal_links.check(
            _read(page), g["money_paths"], cfg.scope, cfg.exclude_classes,
            g.get("require_figure", False),
            extra_evidence=g.get("extra_evidence", ()))
        name = page.relative_to(cfg.root).as_posix()
        if problems:
            failures += 1
            report.append((FAIL, "links", name))
            for p in problems:
                report.append(("", "", "    " + p))
        else:
            report.append((OK, "links", "{} ({} commercial link(s))".format(name, len(found))))
    return failures


def run_translation(cfg, report):
    g = cfg.guard("translation")
    src_dir = cfg.resolve(g["source_dir"])
    native_path = cfg.resolve(g["native"]) if g.get("native") else None
    native = {}
    if native_path and native_path.exists():
        native = {k: v for k, v in json.loads(_read(native_path)).items()
                  if not k.startswith("_")}
    sources = {p.stem: p for p in src_dir.glob("*.md") if not p.stem.startswith("_")}
    failures = 0
    for locale in g["locales"]:
        d = src_dir / locale
        if not d.exists():
            report.append((MARK, "i18n", "{}: directory missing".format(locale)))
            continue
        bad = 0
        translated = sorted(p.stem for p in d.glob("*.md"))
        for stem in translated:
            if stem not in sources:
                if stem in native.get(locale, []):
                    continue
                report.append((FAIL, "i18n", "{}/{}: no source document and not listed as native".format(locale, stem)))
                bad += 1
                continue
            problems = translation.check(
                _read(sources[stem]), _read(d / (stem + ".md")), locale,
                # zh-Hans out of a zh-Hant source is still Han script. Demanding
                # its absence would fail every document in that locale forever.
                forbid_source_script=locale not in g.get("same_script_locales", []))
            if problems:
                bad += 1
                report.append((FAIL, "i18n", "{}/{}".format(locale, stem)))
                for p in problems:
                    report.append(("", "", "    " + p))
        missing = sorted(set(sources) - set(translated))
        line = "{}: {} document(s)".format(locale, len(translated))
        if missing:
            line += ", {} not yet translated".format(len(missing))
        report.append((OK if bad == 0 else FAIL, "i18n", line))
        failures += bad
    return failures


def run_claims(cfg, report):
    g = cfg.guard("claims")
    from .htmltext import visible_text
    failures = 0
    for page in _glob(cfg.root, g["pages"]):
        hits = claims.check(visible_text(_read(page)))
        if hits:
            failures += 1
            report.append((FAIL, "claims", page.relative_to(cfg.root).as_posix()))
            for kind, sentence in hits:
                report.append(("", "", "    [{}] {}".format(kind, sentence)))
    if not failures:
        report.append((OK, "claims", "no affirmative performance claims found"))
    return failures


def run_lastmod(cfg, report, write=True):
    g = cfg.guard("lastmod")
    import datetime
    today = datetime.date.today().isoformat()
    state_path = cfg.resolve(g["state"])
    state = lastmod.load_state(state_path)
    strip_classes = g.get("strip_classes", ())
    strip_patterns = g.get("strip_patterns", ())
    changed, total, updates = 0, 0, {}
    for page in _glob(cfg.root, g["pages"]):
        key = "/" + page.relative_to(cfg.root).parent.as_posix().strip("/") + "/"
        prev = state.get(key, {})
        new_date, did_change, new_hash = lastmod.resolve(
            _read(page), prev.get("hash"), prev.get("lastmod"), today,
            strip_classes, strip_patterns)
        total += 1
        changed += 1 if did_change and prev.get("hash") else 0
        updates[key] = {"hash": new_hash, "lastmod": new_date}
    warning = lastmod.bulk_change_warning(
        changed, total, g.get("bulk_change_threshold", lastmod.DEFAULT_BULK_CHANGE_THRESHOLD))
    if warning:
        report.append((FAIL, "lastmod", warning))
        return 1
    if write:
        lastmod.save_state(state_path, updates)
    report.append((OK, "lastmod", "{} page(s), {} genuinely changed".format(total, changed)))
    return 0


def _site_pages(cfg, g):
    """[(path, url_path)] for the built site, skipping 404 pages at every level.

    index.html maps to "", a/index.html to "a/", a/b.html to "a/b.html", so the
    URL each page is judged under is the one it is served at.
    """
    site_dir = cfg.resolve(g.get("site_dir", "."))
    skip = set(g.get("skip", ["404.html"]))
    out = []
    for p in _glob(site_dir, g.get("pages", "**/*.html")):
        if not p.is_file() or p.name in skip:
            continue
        rel = p.relative_to(site_dir).as_posix()
        if rel == "index.html":
            rel = ""
        elif rel.endswith("/index.html"):
            rel = rel[:-len("index.html")]
        out.append((p, rel))
    return out


def _audit_options(g):
    phrases = g.get("stock_phrases")
    return dict(
        checks=g.get("checks", page_audit.CHECKS),
        min_chars=g.get("min_chars", crawler_text.DEFAULT_MIN_CHARS),
        require_types=g.get("require_types", structured_data.DEFAULT_REQUIRE_TYPES),
        require_date_modified=g.get("require_date_modified", True),
        cite_ok=g.get("cite_ok", []),
        phrases=stock_phrases.DEFAULT_PHRASES if phrases is None else phrases,
    )


def _report_audit(report, label, results):
    bad = page_audit.failed(results)
    if not bad:
        report.append((OK, "audit", "{} ({} check(s))".format(label, len(results))))
        return 0
    report.append((FAIL, "audit", "{} ({})".format(label, ", ".join(bad))))
    for name in bad:
        for p in results[name]["problems"]:
            report.append(("", "", "    [{}] {}".format(name, p)))
    return 1


def run_page_audit(cfg, report):
    g = cfg.guard("page_audit")
    site_url = g["site_url"].rstrip("/") + "/"
    pages = _site_pages(cfg, g)
    if not pages:
        # Nothing matched means the paths are wrong, not that the site is fine.
        report.append((FAIL, "audit", "no pages matched {!r} under {}".format(
            g.get("pages", "**/*.html"), g.get("site_dir", "."))))
        return 1
    opts = _audit_options(g)
    failures = 0
    for page, rel in pages:
        results = page_audit.audit(_read(page), site_url + rel, **opts)
        failures += _report_audit(report, "/" + rel, results)
    return failures


def run_duplicate_sentences(cfg, report):
    g = cfg.guard("duplicate_sentences")
    limit = g.get("max_share", duplicate_sentences.DEFAULT_MAX_SHARE)
    pages = _site_pages(cfg, g)
    if len(pages) < 2:
        report.append((FAIL, "dupes", "fewer than two pages matched {!r} under {}".format(
            g.get("pages", "**/*.html"), g.get("site_dir", "."))))
        return 1
    sents = [duplicate_sentences.sentences(_crawler_text(_read(p))) for p, _ in pages]
    over = sorted(((max(a, b), i, j, a, b) for i, j, a, b in duplicate_sentences.overlaps(sents)
                   if max(a, b) > limit), reverse=True)
    for _, i, j, a, b in over[:30]:
        report.append((FAIL, "dupes", "/{} vs /{}: {}% / {}% of sentences shared".format(
            pages[i][1], pages[j][1], int(a * 100 + 0.5), int(b * 100 + 0.5))))
    if len(over) > 30:
        report.append(("", "", "    ... and {} more pair(s)".format(len(over) - 30)))
    if not over:
        report.append((OK, "dupes", "{} page(s), no pair above {}% shared".format(
            len(pages), int(limit * 100 + 0.5))))
    return len(over)


RUNNERS = [
    ("keywords", run_keywords),
    ("internal_links", run_internal_links),
    ("translation", run_translation),
    ("claims", run_claims),
    ("lastmod", run_lastmod),
    ("page_audit", run_page_audit),
    ("duplicate_sentences", run_duplicate_sentences),
]


def _split_list(values):
    """Repeatable option that also accepts comma-separated values."""
    return [v.strip() for item in (values or []) for v in item.split(",") if v.strip()]


def cmd_audit(args):
    try:
        html = _read(args.file)
    except (FileNotFoundError, UnicodeDecodeError) as exc:
        print("{} cannot read {}: {}".format(FAIL, args.file, exc))
        return 1
    phrases = stock_phrases.DEFAULT_PHRASES
    if args.phrases:
        phrases = [l.strip() for l in _read(args.phrases).splitlines() if l.strip()]
    try:
        results = page_audit.audit(
            html, args.url,
            checks=args.only or page_audit.CHECKS,
            min_chars=args.min_chars,
            require_types=_split_list(args.require_type) or structured_data.DEFAULT_REQUIRE_TYPES,
            require_date_modified=not args.no_date_modified,
            cite_ok=_split_list(args.cite_ok),
            phrases=phrases)
    except ValueError as exc:
        print("{} configuration problem: {}".format(FAIL, exc))
        return 1
    print("\naudit {}".format(args.url))
    for name, r in results.items():
        print("  {:<6} {}".format(OK if r["verdict"] == "pass" else FAIL, name))
        for p in r["problems"]:
            print("      " + p)
    bad = page_audit.failed(results)
    if bad:
        print("\n{} {} check(s) failed. Deploy blocked.".format(FAIL, len(bad)))
        return 1
    print("\n{} all checks passed.".format(OK))
    return 0


def cmd_compare(args):
    problems, d = duplicate_sentences.check(_read(args.a), _read(args.b), args.max_share)
    print("\ncompare")
    print("  {}% of {}'s sentences appear verbatim in {}".format(int(d["a_in_b"] * 100 + 0.5), args.a, args.b))
    print("  {}% of {}'s sentences appear verbatim in {}".format(int(d["b_in_a"] * 100 + 0.5), args.b, args.a))
    for s in d["shared"]:
        print("    shared: " + s)
    if problems:
        print("\n{} {}".format(FAIL, problems[0]))
        return 1
    print("\n{} below the {}% limit.".format(OK, int(args.max_share * 100 + 0.5)))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="contentgate",
                                 description="Pre-deploy guards for content sites.")
    sub = ap.add_subparsers(dest="command")
    c = sub.add_parser("check", help="run the guards against your site")
    c.add_argument("--config", default="contentgate.json")
    c.add_argument("--only", action="append", default=None,
                   help="run only this guard; repeatable")
    c.add_argument("--dry-run", action="store_true",
                   help="do not write the lastmod state file")
    sub.add_parser("selftest", help="run the guards' own negative tests and stop")
    i = sub.add_parser("init", help="write a starting contentgate.json")
    i.add_argument("--config", default="contentgate.json")
    a = sub.add_parser("audit", help="page-level SEO/GEO checks on one built HTML file")
    a.add_argument("file", help="the built HTML file")
    a.add_argument("--url", required=True,
                   help="the URL the page is served at; decides which links are external "
                        "and whether this is the home page")
    a.add_argument("--only", action="append", choices=page_audit.CHECKS,
                   help="run only this check; repeatable")
    a.add_argument("--min-chars", type=int, default=crawler_text.DEFAULT_MIN_CHARS,
                   help="visible_text: minimum characters readable with JavaScript off")
    a.add_argument("--require-type", action="append",
                   help="structured_data: required @type; repeatable or comma-separated")
    a.add_argument("--no-date-modified", action="store_true",
                   help="structured_data: do not require dateModified")
    a.add_argument("--cite-ok", action="append",
                   help="outbound_links: domain cited editorially, exempt from rel; "
                        "repeatable or comma-separated")
    a.add_argument("--phrases", help="stock_phrases: UTF-8 file, one phrase per line, "
                                     "replacing the default list")
    cm = sub.add_parser("compare", help="verbatim sentence overlap between two built HTML files")
    cm.add_argument("a")
    cm.add_argument("b")
    cm.add_argument("--max-share", type=float, default=duplicate_sentences.DEFAULT_MAX_SHARE)
    args = ap.parse_args(argv)

    if args.command == "init":
        p = config_mod.write_template(args.config)
        print("wrote {}".format(p))
        return 0

    print("negative tests")
    ok, passed, failed = selftest_mod.run(sys.stdout)
    if not ok:
        print("\n{} the guards' own tests failed ({} of {}). No verdict given."
              .format(FAIL, failed, passed + failed))
        return 2
    if args.command == "selftest":
        return 0
    if args.command == "audit":
        return cmd_audit(args)
    if args.command == "compare":
        return cmd_compare(args)

    cfg = config_mod.load(args.config)
    report, failures = [], 0
    print("\nchecks")
    for name, fn in RUNNERS:
        if not cfg.enabled(name):
            continue
        if args.only and name not in args.only:
            continue
        try:
            if name == "lastmod":
                failures += fn(cfg, report, write=not args.dry_run)
            else:
                failures += fn(cfg, report)
        except FileNotFoundError as exc:
            failures += 1
            report.append((FAIL, name, "configuration points at a file that is not there: {}".format(exc)))
        except (KeyError, ValueError) as exc:
            failures += 1
            report.append((FAIL, name, "configuration problem: {}".format(exc)))

    for mark, tag, line in report:
        print("  {:<6} {:<10} {}".format(mark, tag, line) if mark else "  " + line)

    if failures:
        print("\n{} {} check(s) failed. Deploy blocked.".format(FAIL, failures))
        return 1
    print("\n{} all checks passed.".format(OK))
    return 0


if __name__ == "__main__":
    sys.exit(main())
