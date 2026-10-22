/**
 * Talks to the built server over stdio the way a real client would.
 * Compiling is not evidence that the server answers.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");

const transport = new StdioClientTransport({ command: process.execPath, args: [entry] });
const client = new Client({ name: "contentgate-smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("tools:", tools.map((t) => t.name).join(", "));

const parse = (r) => JSON.parse(r.content[0].text);
let failures = 0;
const expect = (label, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  [${ok ? "ok" : "FAIL"}] ${label}: got ${got}, want ${want}`);
};

const blocked = await client.callTool({
  name: "check_keywords",
  arguments: {
    html: '<article class="post"><p>static site generator is a thing.</p></article>',
    keywords: { "static site generator": 400 },
    scope: ["article", "post"],
  },
});
expect("keyword mentioned once is blocked", parse(blocked).verdict, "block");

const passed = await client.callTool({
  name: "check_keywords",
  arguments: {
    html: '<article class="post"><p>static site generator, static site generator, static site generator.</p></article>',
    keywords: { "static site generator": 400 },
    scope: ["article", "post"],
  },
});
expect("keyword mentioned three times passes", parse(passed).verdict, "pass");

const drift = await client.callTool({
  name: "check_translation",
  arguments: {
    source: "# A\n> B\n\n| x |\n|---|\n| 1 |\n",
    translation: "# A\n> B\n\n| x |\n|---|\n",
    locale: "en",
  },
});
expect("dropped table row is blocked", parse(drift).verdict, "block");

const claim = await client.callTool({
  name: "check_claims",
  arguments: { text: "Our system delivers guaranteed profit." },
});
expect("guaranteed profit is blocked", parse(claim).verdict, "block");

const disclaimer = await client.callTool({
  name: "check_claims",
  arguments: { text: "We do not make guaranteed profit claims." },
});
expect("the disclaimer passes", parse(disclaimer).verdict, "pass");

const stable = await client.callTool({
  name: "sitemap_lastmod",
  arguments: {
    body: "<main>hello</main>",
    previous_hash: parse(await client.callTool({
      name: "content_hash", arguments: { body: "<main>hello</main>" },
    })).hash,
    previous_lastmod: "2026-01-01",
    today: "2026-09-17",
  },
});
expect("unchanged page keeps its lastmod", parse(stable).lastmod, "2026-01-01");

const article = (body, extra = "") =>
  '<html><head><link rel="icon" href="/favicon.ico">' +
  '<script type="application/ld+json">[{"@type":"Article","dateModified":"2026-09-01",' +
  '"publisher":{"@type":"Organization","name":"P"}},{"@type":"BreadcrumbList"}]</script></head>' +
  `<body><main><p>${body}</p>${extra}</main></body></html>`;
const longBody = "Static hosting serves prebuilt files from the edge. ".repeat(30);

const clean = parse(await client.callTool({
  name: "audit_page",
  arguments: { html: article(longBody), url: "https://www.mysite.example/" },
}));
expect("a complete page passes every audit check", clean.verdict, "pass");
expect("all six audit checks ran", Object.keys(clean.checks).length, 6);

const dirty = parse(await client.callTool({
  name: "audit_page",
  arguments: {
    html: article(longBody, '<a href="https://partner-x.example\\.mysite.example/">offer</a><img src="/a.png">'),
    url: "https://www.mysite.example/guide/",
  },
}));
expect("an unqualified link and a bare image block the page", dirty.verdict, "block");
expect("the backslash link resolves to the host a browser opens",
  dirty.checks.outbound_links.unqualified[0], "partner-x.example");
expect("the image without alt and width is reported", dirty.checks.images.lacking.length, 1);

const broad = await client.callTool({
  name: "audit_page",
  arguments: { html: article(longBody), url: "https://www.mysite.example/", cite_ok: ["github.io"] },
});
expect("a cite_ok entry covering a whole hosting suffix is refused", broad.isError, true);

const twins = parse(await client.callTool({
  name: "compare_pages",
  arguments: { html_a: article(longBody), html_b: article(longBody) },
}));
expect("two identical pages are duplicates", twins.verdict, "block");

const distinct = parse(await client.callTool({
  name: "compare_pages",
  arguments: {
    html_a: "<main><p>Static sites are cheap to host. They scale without effort.</p></main>",
    html_b: "<main><p>Index design follows the query pattern. Measure before adding one.</p></main>",
  },
}));
expect("two different pages are not", distinct.verdict, "pass");

await client.close();
console.log(failures ? `\n${failures} smoke check(s) failed` : "\nall smoke checks passed");
process.exit(failures ? 1 : 0);
