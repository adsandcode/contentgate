# mcp-server-contentgate

MCP server for pre-deploy content checks. Catch the problem while the page is
being written, not after it is live.

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

Every tool is pure: content in, verdict out. No filesystem access, no network
access, nothing written.

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
