"""Behaviour the shared fixtures cannot reach: the CLI, the config runner, and
the site-wide duplicate index. Each test pairs a case that must pass with one
that must fail."""

import io
import json
import random
import contextlib

import pytest

from contentgate import cli
from contentgate.guards import crawler_text, duplicate_sentences, page_audit, outbound_links

GOOD = """<!doctype html><html><head><title>Home</title>
<link rel="icon" href="/favicon.ico">
<script type="application/ld+json">[{"@type":"Article","dateModified":"2026-09-01",
"publisher":{"@type":"Organization","name":"P"}},{"@type":"BreadcrumbList"}]</script>
</head><body><nav>Home Guides</nav><main><h1>Static hosting</h1>
<p>{body}</p><img src="/a.png" alt="Build times" width="600" height="400">
<a href="/pricing/">Pricing</a> <a rel="sponsored" href="https://partner-x.example/">Partner</a>
</main><footer>Footer</footer></body></html>"""


def page(body):
    return GOOD.replace("{body}", body)


LONG = " ".join("Sentence number {} explains one more detail about static hosting.".format(i)
                for i in range(30))


def run(argv):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = cli.main(argv)
    return code, out.getvalue()


def test_crawler_text_counts_exactly():
    assert crawler_text.crawler_text("<main><p>a<wbr>b</p><p>c&amp;d</p></main>") == "ab c&d"
    assert crawler_text.crawler_text("<p>x</p><script>var y = 1</script>") == "x"


def test_audit_passes_a_good_page_and_blocks_a_bad_one(tmp_path):
    good = tmp_path / "good.html"
    good.write_text(page(LONG), encoding="utf-8")
    code, out = run(["audit", str(good), "--url", "https://www.mysite.example/"])
    assert code == 0, out

    bad = tmp_path / "bad.html"
    bad.write_text(page("Too short.").replace('rel="sponsored" ', ""), encoding="utf-8")
    code, out = run(["audit", str(bad), "--url", "https://www.mysite.example/"])
    assert code == 1
    assert "visible_text" in out and "partner-x.example" in out


def test_audit_refuses_a_too_broad_cite_ok(tmp_path):
    f = tmp_path / "p.html"
    f.write_text(page(LONG), encoding="utf-8")
    code, out = run(["audit", str(f), "--url", "https://www.mysite.example/", "--cite-ok", "github.io"])
    assert code == 1 and "too broad" in out
    code, _ = run(["audit", str(f), "--url", "https://www.mysite.example/", "--cite-ok", "docs.python.org"])
    assert code == 0


def test_audit_rejects_a_relative_page_url():
    with pytest.raises(ValueError):
        page_audit.audit("<p>x</p>", "/guide/")
    with pytest.raises(ValueError):
        page_audit.audit("<p>x</p>", "https://www.mysite.example/", checks=["no_such_check"])


def test_compare_exit_codes(tmp_path):
    a, b, c = tmp_path / "a.html", tmp_path / "b.html", tmp_path / "c.html"
    a.write_text("<main><p>Static sites are cheap to host. They scale without effort.</p></main>", encoding="utf-8")
    b.write_text("<main><p>Static sites are cheap to host. They scale without effort.</p></main>", encoding="utf-8")
    c.write_text("<main><p>Index design follows the query pattern. Measure first.</p></main>", encoding="utf-8")
    assert run(["compare", str(a), str(b)])[0] == 1
    assert run(["compare", str(a), str(c)])[0] == 0


def test_overlaps_matches_pairwise_share():
    rnd = random.Random(7)
    pool = ["shared sentence number {}".format(i) for i in range(12)]
    pages = [rnd.sample(pool, rnd.randint(0, 6)) for _ in range(9)]
    found = {(i, j): (a, b) for i, j, a, b in duplicate_sentences.overlaps(pages)}
    for i in range(len(pages)):
        for j in range(i + 1, len(pages)):
            want = (duplicate_sentences.share(pages[i], pages[j]),
                    duplicate_sentences.share(pages[j], pages[i]))
            assert found.get((i, j), (0.0, 0.0)) == pytest.approx(want)


def _site(tmp_path, files, guards):
    for rel, text in files.items():
        p = tmp_path / "site" / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    cfg = tmp_path / "contentgate.json"
    cfg.write_text(json.dumps({"root": ".", "guards": guards}), encoding="utf-8")
    return str(cfg)


def test_config_page_audit_maps_files_to_urls_and_skips_404(tmp_path):
    guards = {"page_audit": {"enabled": True, "site_dir": "site", "site_url": "https://www.mysite.example"}}
    cfg = _site(tmp_path, {"index.html": page(LONG), "guide/index.html": page(LONG),
                           "404.html": "<p>missing</p>", "guide/404.html": "<p>missing</p>"}, guards)
    code, out = run(["check", "--config", cfg])
    assert code == 0, out
    assert "/guide/ (6 check(s))" in out and "404" not in out.split("checks")[-1]

    # The home page loses its favicon: only the home page may fail for it.
    (tmp_path / "site" / "index.html").write_text(
        page(LONG).replace('<link rel="icon" href="/favicon.ico">', ""), encoding="utf-8")
    code, out = run(["check", "--config", cfg])
    assert code == 1 and "[favicon]" in out and "/guide/ (6 check(s))" in out


def test_config_page_audit_with_no_pages_is_a_failure(tmp_path):
    guards = {"page_audit": {"enabled": True, "site_dir": "site", "site_url": "https://www.mysite.example"}}
    cfg = _site(tmp_path, {"404.html": "<p>missing</p>"}, guards)
    code, out = run(["check", "--config", cfg])
    assert code == 1 and "no pages matched" in out


def test_config_duplicate_sentences(tmp_path):
    guards = {"duplicate_sentences": {"enabled": True, "site_dir": "site"}}
    same = "<main><p>Static sites are cheap to host. They scale without effort.</p></main>"
    other = "<main><p>Index design follows the query pattern. Measure before adding one.</p></main>"
    cfg = _site(tmp_path, {"a/index.html": same, "b/index.html": other}, guards)
    assert run(["check", "--config", cfg])[0] == 0
    (tmp_path / "site" / "c" ).mkdir()
    (tmp_path / "site" / "c" / "index.html").write_text(same, encoding="utf-8")
    code, out = run(["check", "--config", cfg])
    assert code == 1 and "/a/ vs /c/" in out


def test_config_internal_links_reads_site_hosts(tmp_path):
    body = '<article class="post"><p>See <a href="https://www.mysite.example/pricing/">pricing</a>.</p></article>'
    files = {"blog/a/index.html": body}
    without = {"internal_links": {"enabled": True, "pages": "site/blog/*/index.html",
                                  "money_paths": ["/pricing/"]}}
    cfg = _site(tmp_path, files, without)
    assert run(["check", "--config", cfg])[0] == 1
    with_hosts = {"internal_links": dict(without["internal_links"], site_hosts=["mysite.example"])}
    cfg = _site(tmp_path, files, with_hosts)
    code, out = run(["check", "--config", cfg])
    assert code == 0, out
    broad = {"internal_links": dict(without["internal_links"], site_hosts=["pages.dev"])}
    cfg = _site(tmp_path, files, broad)
    code, out = run(["check", "--config", cfg])
    assert code == 1 and "public suffix" in out


def test_template_carries_the_new_guards_disabled(tmp_path):
    p = tmp_path / "contentgate.json"
    run(["init", "--config", str(p)])
    data = json.loads(p.read_text(encoding="utf-8"))
    assert data["guards"]["page_audit"]["enabled"] is False
    assert data["guards"]["duplicate_sentences"]["enabled"] is False
    assert outbound_links.validate_cite_ok(data["guards"]["page_audit"]["cite_ok"]) == ([], [])
