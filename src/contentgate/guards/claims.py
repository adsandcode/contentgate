"""Performance-claim scanner for regulated verticals.

Finance, health and other regulated copy gets rejected, or worse, for stating
outcomes as facts. The hard part is not finding the phrase, it is not firing on
the sentence that exists precisely to disclaim it. "We do not make guaranteed
profit claims" contains the phrase and is the opposite of a violation.

But a negation somewhere in the sentence proves nothing: 「保證獲利，絕不會虧損」
negates the loss, not the guarantee. So a claim is exempt only when the
negation governs the claim itself:

  - a negator or prohibition ("not", "never", "no", "avoid", "reject", 不,
    沒有, 禁止, 嚴禁 ...) stands shortly before the phrase: at most three
    Latin words or two Han characters between them, and no clause break
    (，,：:) in between. 不保證獲利, 不做保證獲利宣稱, "we do not guarantee
    profit", "no guaranteed returns", "never promise guaranteed income".
  - idioms that only look negative do not count: "not only", "don't miss",
    "no doubt", "no risk", 不僅, 不斷, 不怕, 沒有風險 ...
  - phrases in one list ("guaranteed win, sure win or risk-free return",
    保證獲利、穩賺不賠) share a verdict: if the list is governed, so is
    every item in it.
  - a phrase that is being named rather than asserted is exempt when it is
    followed by a word like "claims" or 等字眼 and a prohibition in the same
    clause: "guaranteed profit claims are banned", 保證獲利等字眼一律不得使用.

This is a net for copy review, not a legal opinion. It errs towards flagging.
"""

import re

from ..markup import WS, WS_CLASS

_S = "[" + WS_CLASS + "]"
_D = "[0-9０-９]"
_L = "(?<![A-Za-z])"
_R = "(?![A-Za-z])"

# Every pattern is written with explicit character classes rather than \s, \d
# or \b, whose meaning differs between Python and JavaScript, and is
# case-insensitive on ASCII only; the TypeScript port uses the same strings.
CLAIM = (
    "guaranteed" + _S + "+(?:profit|win|return|income)|guarantees?" + _S + "+profit|"
    "sure" + _S + "+win|risk(?:-|" + _S + ")?free" + _S + "+(?:profit|return)|"
    "can['’]?t" + _S + "+lose|"
    "保證獲利|保證賺|穩賺不賠|穩賺|必勝|包贏|穩定獲利|穩定盈利"
)
PERF = (
    "win" + _S + "*rate" + _S + "*" + _D + "|hit" + _S + "*rate" + _S + "*" + _D + "|"
    "roi" + _S + "*" + _D + "+" + _S + "*x|returns?" + _S + "+of" + _S + "+" + _D + "+" + _S + "*[%％]|"
    + _D + "+" + _S + "*[%％]" + _S + "+win" + _S + "+rate|"
    "勝率" + _S + "*" + _D + "|命中率" + _S + "*" + _D + "|報酬率" + _S + "*" + _D + "|"
    "獲利" + _S + "*" + _D + "+" + _S + "*(?:[%％]|倍|萬)"
)
GOVERN = (
    _L + "(?:not|no|never|without|cannot|nor|avoids?|rejects?|blocks?|bans?|prohibits?|"
    "forbids?|disclaims?|rather" + _S + "+than|instead" + _S + "+of|free" + _S + "+of)" + _R + "|"
    + _L + "(?:do|does|did|wo|is|are|was|were|should|would)n['’]t" + _R + "|"
    "不|沒有|禁止|嚴禁|避免|排除|拒絕|攔下|擋下"
)
# Read at the position of a governor: it only looks like a negation.
NOT_GOVERNING = (
    "(?:not|never|(?:do|does|did|wo|is|are|was|were|should|would)n['’]t)" + _S + "+"
    "(?:only|just|before|miss|regret|wait|hesitate|worry|forget|delay|stop|lose)" + _R + "|"
    "no" + _S + "+(?:doubt|matter|wonder|risk|worries|need)" + _R + "|"
    "不(?:斷|少|錯|僅|只|但|止|管|論|用|同|久|怕|必)|沒有(?:風險|問題|比)"
)
MENTION = (
    "^" + _S + "*(?:claims?|wording|language|phrases?|statements?|promises?|"
    "等字眼|等字樣|等說法|等用語|字眼|字樣|說法|用語|宣稱|之類)"
)
PROHIBIT = (
    _L + "(?:banned|prohibited|forbidden|not" + _S + "+allowed|illegal|rejected|blocked)" + _R + "|"
    "禁止|不得|不允許|不可|違法|違規|嚴禁|擋下|攔下"
)
LIST_GAP = "^(?:" + _S + "|[、,，/]|" + _L + "(?:or|and)" + _R + "|或|和|及|與)*$"
CLAUSE_BREAK = "[，,：:]"
SENTENCE_SPLIT = "[。；！？\n.!?;]"
LATIN_WORD = "[A-Za-z0-9'’]+"
HAN = "[一-鿿]"

MAX_LATIN_WORDS_BETWEEN = 3
MAX_HAN_BETWEEN = 2

_F = re.I | re.A
_CLAIM, _PERF = re.compile(CLAIM, _F), re.compile(PERF, _F)
_GOVERN, _NOT_GOVERNING = re.compile(GOVERN, _F), re.compile(NOT_GOVERNING, _F)
_MENTION, _PROHIBIT = re.compile(MENTION, _F), re.compile(PROHIBIT, _F)
_LIST_GAP, _CLAUSE_BREAK = re.compile(LIST_GAP, _F), re.compile(CLAUSE_BREAK)
_LATIN_WORD, _HAN = re.compile(LATIN_WORD), re.compile(HAN)


def _groups(sentence, matches):
    """Split sorted matches into lists joined only by separators and or/and."""
    groups = []
    for m in matches:
        if groups:
            last_end = max(x[1] for x in groups[-1])
            gap = sentence[last_end:m[0]] if m[0] > last_end else ""
            if _LIST_GAP.match(gap):
                groups[-1].append(m)
                continue
        groups.append([m])
    return groups


def _governed(sentence, start, matches):
    for g in _GOVERN.finditer(sentence):
        if g.end() > start:
            break
        if any(g.start() < m[1] and g.end() > m[0] for m in matches):
            continue  # the 不 inside 穩賺不賠 is part of the claim
        if _NOT_GOVERNING.match(sentence, g.start()):
            continue
        between = sentence[g.end():start]
        if _CLAUSE_BREAK.search(between):
            continue
        if (len(_LATIN_WORD.findall(between)) <= MAX_LATIN_WORDS_BETWEEN
                and len(_HAN.findall(between)) <= MAX_HAN_BETWEEN):
            return True
    return False


def _named_not_asserted(sentence, end):
    rest = sentence[end:]
    m = _MENTION.match(rest)
    if not m:
        return False
    clause = _CLAUSE_BREAK.split(rest[m.end():], 1)[0]
    return _PROHIBIT.search(clause) is not None


def _kinds(sentence):
    """Kinds ('claim', 'performance') asserted in one sentence."""
    matches = sorted([(m.start(), m.end(), "claim") for m in _CLAIM.finditer(sentence)]
                     + [(m.start(), m.end(), "performance") for m in _PERF.finditer(sentence)])
    kinds = set()
    for group in _groups(sentence, matches):
        end = max(m[1] for m in group)
        if _governed(sentence, group[0][0], matches) or _named_not_asserted(sentence, end):
            continue
        kinds.update(m[2] for m in group)
    return kinds


def check(text):
    """Return a list of (kind, sentence) for affirmative claims only."""
    hits = []
    for sentence in re.split(SENTENCE_SPLIT, text):
        s = sentence.strip(WS)
        if not s:
            continue
        kinds = _kinds(s)
        for kind in ("claim", "performance"):
            if kind in kinds:
                hits.append((kind, s[:120]))
    return hits
