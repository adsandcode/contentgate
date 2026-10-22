# contentgate

Pre-deploy guards for content sites. Python CLI and an MCP server, sharing one test suite.

Documentation and background: [adsandcode.com/en/open-source/contentgate](https://adsandcode.com/en/open-source/contentgate/)

These checks exist because each of them was written the day after the thing it
checks for went live and cost something.

```
negative tests
  keywords
    [ok] expected block got block  primary keyword appears once, threshold is three
    [ok] expected block got block  spaced variant must not satisfy the unspaced keyword
    ...
  121 passed, 0 failed

checks
  [ ok ] keywords   choosing-a-cms (1200/1200 volume covered)
  [FAIL] keywords   headless-vs-monolith (300/750 volume covered)
      missing keyword 'headless cms' (volume 450): found 2 time(s), needs 3
  [ ok ] i18n       fr: 19 document(s)
  [ ok ] lastmod    19 page(s), 0 genuinely changed

[FAIL] 1 check(s) failed. Deploy blocked.
```

## The one design rule

**A guard that has never been shown to fail is decoration.**

Every check ships negative tests: inputs it is required to reject. The suite runs
before any verdict is reported, and a failing suite exits `2` without saying
anything about your content. A checker that cannot prove it still catches a
known-bad input does not get to tell you your site is fine.

This is not theoretical. Guards written for this project have included: one that
read its keyword out of the site-wide footer and therefore passed every page
ever; one that ran *after* the step that regenerated the file it was checking;
and one whose exit code was discarded by the shell pipeline it lived in, so it
printed "deploy blocked" while the deploy proceeded. All three looked fine. All
three were found by asking them to fail on purpose.

## The checks

| Check | What it catches |
|---|---|
| `keywords` | The page covers the topic and never contains the term people search for. |
| `translation` | A translation that is no longer structurally the same document: dropped table row, changed price, internal link that lost its locale prefix. |
| `internal_links` | A guide that ranks, gets read, and sends nobody anywhere, because its only commercial link lives in site-wide boilerplate. |
| `claims` | Affirmative performance claims in regulated copy, without firing on the disclaimer that names them. |
| `lastmod` | A sitemap that stamps today's date on every URL every build and trains crawlers to ignore the field. |

Three details that look fussy and are not:

**Whitespace is never normalised in keyword matching.** `web hosting` and
`webhosting` are different strings with different search volumes, and in
languages that do not put spaces between words the gap between the two forms can
be an order of magnitude. Letting one satisfy the other is how a guard passes a
page that targets neither. This was found twice, on two pages, after publication.

**Boilerplate is excluded from every body check.** A call-to-action block present
on every page will otherwise satisfy `keywords` and `internal_links` everywhere,
which means both checks pass always.

**Ties are not broken by dictionary order.** Every keyword at the highest volume
is primary. The alternative, taking the first maximum, makes the verdict depend
on the order of keys in a JSON file, which is stable right up until someone
reorders the table.

## Page-level SEO/GEO audit

New in 0.2.0: checks on a built page that is meant to be found, both through
search engines (SEO) and through AI assistants that read and cite pages (GEO).
Run them on the HTML your server actually sends, not on the source.

| Check | Fails when |
|---|---|
| `visible_text` | fewer than `min_chars` characters are readable with JavaScript off |
| `structured_data` | a JSON-LD block does not parse, a required `@type` is missing, or there is no `dateModified` |
| `outbound_links` | an external link carries none of `nofollow`, `sponsored`, `ugc` and its site is not in `cite_ok` |
| `images` | an `<img>` has no `alt` or no `width` |
| `favicon` | the home page declares no icon in its head, or only formats Google Search does not list |
| `stock_phrases` | a phrase from your list appears in the body copy |
| `duplicate_sentences` | two pages share more than `max_share` of their sentences word for word |

**Text a crawler sees without JavaScript.** Google renders JavaScript before
indexing. Many AI crawlers do not: a December 2024 measurement by Vercel found
that GPTBot, ClaudeBot and PerplexityBot fetch the HTML and stop there. An
article written into the page by a script is, to them, a navigation bar and a
footer. The check drops `<script>` and `<style>`, reads only `<main>` when the
page has one, drops `<nav>` and `<footer>`, removes `<wbr>` and zero-width
spaces without leaving a gap (a word broken for line wrapping is still one
word), decodes entities and counts what is left. The default of 1200 characters
is a house rule, not a number any search engine publishes. Short pages such as
author profiles need a lower `min_chars` or no `visible_text` check at all.

**Structured data, parsed.** Every `application/ld+json` block goes through a
real JSON parser, so a trailing comma or a `NaN` is a failure rather than
something a text search would count as present. Types are collected from each
item, from `@graph`, and from `author`, `publisher` and `creator`, where
Organization and Person usually sit. The default requirement is `Article`,
`BreadcrumbList` and `Organization`; a page that declares `ProfilePage` is not
required to be an `Article`, since Google's ProfilePage documentation lists an
author page on a news site among its intended uses. Requiring a type does not
make any search engine show anything; it checks that what you meant to declare
is there and parses. `dateModified` has to be true to mean anything: a date
that moves on every build is the same lie the `lastmod` guard exists to stop.

**Outbound links, resolved the way a browser resolves them.** Google asks for
paid and affiliate links to carry `rel="sponsored"`, user-generated links
`rel="ugc"`, and `nofollow` where neither fits; an ordinary editorial link needs
no `rel` at all, and several values may be given space- or comma-separated. A
program cannot tell a citation from a placement, so every external link without
one of the three is reported unless its site is in `cite_ok`. Before deciding
where a link goes, the href is read as a browser reads it: tabs and newlines
removed, a backslash treated as a slash, any run of slashes after `https:`
starting the host. Without that, `https://partner.example\.gov.example/` looks to
`urllib` like a host under `gov.example`, while every browser opens
`partner.example`. Hosts are compared on label boundaries, so `evilexample.org`
is not under `example.org`, and a page's own subdomains count as internal. When
a tag repeats `rel`, the first one wins, as it does in the browser.

`cite_ok` is for sites you cite editorially, matched with their subdomains, for
example `["gov.uk", "who.int"]`: a suffix only government bodies can register
is a reasonable entry. A registry anyone can register under, such as `co.uk`,
`github.io` or `pages.dev`, is refused with an error, because listing it would
exempt every site below it. Paid or affiliate partners never belong in
`cite_ok`.

**Images.** Google uses alt text, together with the image and the page around
it, to understand what an image shows; `alt=""` is a deliberate statement that
an image is decorative and passes. A missing `width` lets text jump when the
image arrives. web.dev also accepts reserving the space with CSS `aspect-ratio`,
which an attribute check cannot see; if that is how your site does it, leave
`images` out of the checks.

**Favicon.** Google reads the icon from a `<link>` in the head of the home page,
so the check runs only when the page URL's path is empty or `/`. Accepted `rel`
values are the ones Google documents (`icon`, which `shortcut icon` contains,
`apple-touch-icon`, `apple-touch-icon-precomposed`). Google Search "supports the
following favicon file formats: BMP, GIF, ICO, PNG, JPEG, PPM, and TIFF", so an
SVG or WebP icon on its own fails. The format is read from the file extension.
Whether the file exists, its size and whether it is square need the built files
and are not checked here.

**Stock phrases.** An editorial style check, not a detector of machine-written
text: it finds phrases you have decided read as filler, and proves nothing about
who or what wrote the page. The default list is Traditional Chinese, because
that is where it was built and tested (總的來說, 值得注意的是, 綜上所述 and nine
more). For any other language, supply your own list; the defaults will never
match. Matching is literal and case-insensitive, on the text a crawler sees, so
a phrase inside a script or in the navigation does not count.

**Duplicate sentences.** Sentences are split on 。！？ and on `.`, `!` or `?`
followed by whitespace, so `4.99` does not end a sentence; sentences under ten
characters are ignored. The share is measured in characters and in both
directions, and the larger figure decides, because a short page copied whole
into a long one is a small share of the long page and all of the short one. The
default limit of 15% is a house rule.

Sources, checked when this release was written:
[qualifying outbound links](https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links) (Google Search Central, updated 2025-12-10),
[favicons in search results](https://developers.google.com/search/docs/appearance/favicon-in-search) (Google Search Central, updated 2026-08-28),
[ProfilePage structured data](https://developers.google.com/search/docs/appearance/structured-data/profile-page) (Google Search Central, updated 2026-09-08),
[image SEO](https://developers.google.com/search/docs/appearance/google-images) (Google Search Central, updated 2026-03-02),
[optimizing layout shift](https://web.dev/articles/optimize-cls) (web.dev, updated 2025-02-07),
and, as a third-party measurement, [AI crawlers and JavaScript](https://vercel.com/blog/the-rise-of-the-ai-crawler) (Vercel, 2024-12-17).

## Install

Python 3.8+, standard library only, no dependencies.

```bash
git clone https://github.com/adsandcode/contentgate
cd contentgate
python -m contentgate init          # writes contentgate.json
python -m contentgate check
```

Exit codes are the contract:

| Code | Meaning |
|---|---|
| `0` | everything passed |
| `1` | a guard failed on your content |
| `2` | the guards' own negative tests failed, so no verdict was given |

Wire it in front of your deploy and honour the exit code:

```bash
python -m contentgate check || exit 1
npx wrangler pages deploy site
```

The page audit also runs on a single built file, without a config:

```bash
python -m contentgate audit site/guide/index.html --url https://www.example.org/guide/
python -m contentgate audit site/index.html --url https://www.example.org/ \
    --cite-ok gov.uk --phrases phrases.txt --only visible_text --only favicon
python -m contentgate compare site/a/index.html site/b/index.html --max-share 0.15
```

`--url` is the address the page is served at: it decides which links are
external and whether the page is the home page. `--phrases` is a UTF-8 file with
one phrase per line and replaces the default list.

## Configuration

`contentgate.json`, next to your project:

```json
{
  "root": ".",
  "scope": ["article", "post"],
  "exclude_classes": ["cta"],
  "guards": {
    "keywords": {
      "enabled": true,
      "table": "content/keywords.json",
      "page_for_slug": "site/blog/{slug}/index.html",
      "primary_min_hits": 3
    },
    "internal_links": {
      "enabled": true,
      "pages": "site/blog/*/index.html",
      "money_paths": ["/products/", "/plans/"],
      "require_figure": true
    },
    "translation": {
      "enabled": true,
      "source_dir": "content/blog",
      "locales": ["de", "fr", "ja"],
      "same_script_locales": [],
      "native": "content/blog/_native.json"
    },
    "lastmod": {
      "enabled": true,
      "pages": "site/**/index.html",
      "state": ".contentgate-lastmod.json",
      "strip_classes": [],
      "bulk_change_threshold": 0.3
    }
  }
}
```

`scope` is the element that holds the real content, as `[tag, class]`.
`exclude_classes` is your boilerplate. Both matter more than they look.

`same_script_locales` is for targets that legitimately share the source script,
such as Simplified Chinese from a Traditional Chinese source. Without it, the
leftover-characters check fails every document in that locale forever.

`bulk_change_threshold` stops a run that moves more than that share of lastmod
dates at once. Adding a block to every page changes every hash, which moves every
date, which is the lie the check exists to prevent. It looks identical to a
legitimate mass edit, so the run stops and asks rather than writing silently.

`content/keywords.json` maps a page to its terms and their real monthly volumes:

```json
{
  "choosing-a-cms": { "headless cms": 450, "cms comparison": 200 }
}
```

Use numbers from a tool. A guard fed invented volumes enforces invented priorities.

The page audit and the duplicate check read the built site:

```json
{
  "guards": {
    "page_audit": {
      "enabled": true,
      "site_dir": "site",
      "site_url": "https://www.example.org",
      "pages": "**/*.html",
      "skip": ["404.html"],
      "checks": ["visible_text", "structured_data", "outbound_links", "images", "favicon", "stock_phrases"],
      "min_chars": 1200,
      "require_types": ["Article", "BreadcrumbList", "Organization"],
      "require_date_modified": true,
      "cite_ok": ["gov.uk"],
      "stock_phrases": null
    },
    "duplicate_sentences": {
      "enabled": true,
      "site_dir": "site",
      "pages": "**/*.html",
      "skip": ["404.html"],
      "max_share": 0.15
    }
  }
}
```

Each file is judged under the URL it is served at: `index.html` is `/`,
`guide/index.html` is `/guide/`, `guide/faq.html` is `/guide/faq.html`. Files
named in `skip` are left out at every level. A glob that matches nothing fails
rather than passing an empty site. `stock_phrases: null` keeps the default list;
`[]` flags nothing. The duplicate check finds pairs through an index of shared
sentences instead of comparing every page with every other.

## MCP server

The same checks as tools an assistant can call while it is writing a page, rather
than after the page is deployed.

```bash
npx mcp-server-contentgate
```

```json
{
  "mcpServers": {
    "contentgate": { "command": "npx", "args": ["-y", "mcp-server-contentgate"] }
  }
}
```

Tools: `check_keywords`, `check_translation`, `check_internal_links`,
`check_claims`, `sitemap_lastmod`, `content_hash`, `audit_page` (the six
single-page checks above, each switchable) and `compare_pages` (duplicate
sentences between two pages).

Every tool is pure: content in, verdict out. No filesystem access, no network
access, nothing written. The server runs its negative tests at startup and
refuses to start if they fail.

## Why there are two implementations

The Python CLI runs in a deploy pipeline. The MCP server runs inside an assistant
while the content is being written. Neither replaces the other.

They share `fixtures/cases.json`, and both are required to produce identical
verdicts on every case in it. If they disagree, one has drifted and CI fails.

```bash
python -m contentgate selftest     # 121 passed, 0 failed
cd mcp && npm run build && npm run selftest
```

Agreeing on page markup takes more than the same regular expressions. The
Python side reads links, images and icons with the standard library's HTML
parser and decodes entities with `html.unescape`; the TypeScript side carries a
port of that parser's tokeniser and of `html.unescape` with the full entity
table, so `&hellip;` is one character in both. The parser itself changed how it
reads badly malformed markup in 2025, so the shared cases stick to markup every
supported Python version reads the same way.

## Contributing

A pull request that adds a check must add its negative tests to
`fixtures/cases.json` and implement it on both sides. That is the whole bar.

If you found a way to make a guard pass something it should have caught, that is
the most useful issue you can file.

## Licence

MIT.

## Maintainer

Built and maintained by [Ads & Code](https://adsandcode.com/).
