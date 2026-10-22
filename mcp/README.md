# mcp-server-contentgate

MCP server for pre-deploy content checks. Catch the problem while the page is
being written, not after it is live.

Documentation and background: [adsandcode.com/en/open-source/contentgate](https://adsandcode.com/en/open-source/contentgate/)

```json
{
  "mcpServers": {
    "contentgate": { "command": "npx", "args": ["-y", "mcp-server-contentgate"] }
  }
}
```

## Tools

| Tool | What it answers |
|---|---|
| `check_keywords` | Do the terms this page is meant to rank for actually appear in it? |
| `check_translation` | Is this translation still structurally the same document as its source? |
| `check_internal_links` | Does this page link to anything that makes money, outside the boilerplate? |
| `check_claims` | Does this copy state outcomes as facts in a way regulated advertising rejects? |
| `sitemap_lastmod` | Has this page genuinely changed, or is the build about to lie about it? |
| `content_hash` | Stable hash of a page with volatile blocks removed. |
| `audit_page` | Is this page readable without JavaScript, marked up with JSON-LD that parses, honest about its outbound links, and complete in its images and favicon? |
| `compare_pages` | How many sentences do these two pages share word for word? |

Every tool is pure: content in, verdict out. No filesystem access, no network
access, nothing written.

## Page audit

`audit_page` runs six checks on one rendered page and returns a verdict for
each; pass `checks` to run fewer.

- `visible_text`: characters readable with JavaScript off. Google renders
  JavaScript; many AI crawlers read only the HTML the server sent, so an article
  injected by a script is invisible to them. 1200 is a house default, not a
  search-engine number.
- `structured_data`: every JSON-LD block parses, the `@type` values you require
  are present (default `Article`, `BreadcrumbList`, `Organization`), and there is
  a `dateModified`. A `ProfilePage` is not required to be an `Article`.
- `outbound_links`: external links without `rel` `nofollow`, `sponsored` or `ugc`.
  Hosts are resolved the way a browser resolves them, so backslashes and extra
  slashes do not disguise where a link goes. List sites you cite editorially in
  `cite_ok`; registries anyone can register under (`co.uk`, `github.io`,
  `pages.dev`) are refused.
- `images`: `<img>` without `alt` or `width`. `alt=""` is accepted.
- `favicon`: home page only; an icon `<link>` in the head, in a format Google
  Search lists (BMP, GIF, ICO, PNG, JPEG, PPM, TIFF).
- `stock_phrases`: an editorial style list, not a detector of machine-written
  text. The default list is Traditional Chinese; pass your own for any other
  language.

`compare_pages` splits both pages into sentences (on 。！？ and on `. ! ?` before
whitespace), ignores sentences under ten characters, and measures the shared
share in characters in both directions.

Sources for each rule are in the repository README.

## The one design rule

**A guard that has never been shown to fail is decoration.**

The server runs its negative tests at startup and refuses to start if they fail.
A checker that cannot prove it still catches a known-bad input should not be
answering questions about your content.

The same test file is run by the Python implementation in the same repository,
and both are required to produce identical verdicts on every case.

## Three behaviours worth knowing before you call it

**Keyword matching never normalises whitespace.** `web hosting` and
`webhosting` are different strings with different search volumes. If you pass
one, the other does not satisfy it.

**Pass `exclude_classes`.** A call-to-action block that appears on every page
will otherwise satisfy `check_keywords` and `check_internal_links` everywhere,
and both tools become decoration.

**Set `forbid_source_script: false`** when the target language shares the source
script, such as Simplified Chinese from a Traditional Chinese source. Otherwise
every document in that locale is reported as untranslated.

## Python CLI

The same checks run as a deploy gate, reading your site from disk, in the
`contentgate` package in the same repository.

## Licence

MIT.

## Maintainer

Built and maintained by [Ads & Code](https://adsandcode.com/).
