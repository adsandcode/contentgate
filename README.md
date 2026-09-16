# contentgate

Pre-deploy guards for content sites. Python CLI and an MCP server, sharing one test suite.

These checks exist because each of them was written the day after the thing it
checks for went live and cost something.

```
negative tests
  keywords
    [ok] expected block got block  primary keyword appears once, threshold is three
    [ok] expected block got block  spaced variant must not satisfy the unspaced keyword
    ...
  36 passed, 0 failed

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

## Install

Python 3.8+, standard library only, no dependencies.

```bash
git clone https://github.com/hahaha821102-droid/contentgate
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
`check_claims`, `sitemap_lastmod`, `content_hash`.

Every tool is pure: content in, verdict out. No filesystem access, no network
access, nothing written. The server runs its negative tests at startup and
refuses to start if they fail.

## Why there are two implementations

The Python CLI runs in a deploy pipeline. The MCP server runs inside an assistant
while the content is being written. Neither replaces the other.

They share `fixtures/cases.json`, and both are required to produce identical
verdicts on every case in it. If they disagree, one has drifted and CI fails.

```bash
python -m contentgate selftest     # 36 passed, 0 failed
cd mcp && npm run build && npm run selftest
```

## Contributing

A pull request that adds a check must add its negative tests to
`fixtures/cases.json` and implement it on both sides. That is the whole bar.

If you found a way to make a guard pass something it should have caught, that is
the most useful issue you can file.

## Licence

MIT.
