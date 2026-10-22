/**
 * The package's importable entry ("main" in package.json): every guard as a
 * plain function, with no side effects. Importing this module starts nothing;
 * the MCP server lives in index.ts and is what the bin runs.
 */

export {
  checkKeywords, checkTranslation, checkInternalLinks, checkClaims, contentHash, resolveLastmod,
  siteDomains, ownPath, DEFAULT_PRIMARY_MIN_HITS,
} from "./guards.js";
export type { KeywordRow, TranslationOptions } from "./guards.js";
export {
  auditPage, crawlerText, dropUnrendered, checkVisibleText, parseStructuredData, checkStructuredData,
  checkOutboundLinks, scanOutbound, validateCiteOk, normaliseDomain, checkImages, checkFavicon,
  iconsInHead, isHomePage, supportedIcon, checkStockPhrases, checkDuplicateSentences, sentences, share,
  CHECKS, DEFAULT_MIN_CHARS, DEFAULT_REQUIRE_TYPES, DEFAULT_PHRASES, DEFAULT_MAX_SHARE, SCHEMA_SUBTYPES,
  QUALIFIERS, TOO_BROAD, ICON_RELS,
} from "./audit.js";
export type { AuditOptions, CheckResult, CheckName } from "./audit.js";
export { visibleText, links, unescape, scanTags } from "./html.js";
export type { TagToken, Scope } from "./html.js";
export { resolveHost, resolve, pageParts } from "./urls.js";
export { VERSION } from "./version.js";
