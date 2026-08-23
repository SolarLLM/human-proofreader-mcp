/**
 * 원고 대조 — 교정본을 원본 옆에 놓고 한 줄씩 맞춰 보는 단계.
 *
 * 사람 편집자가 교정을 끝낸 뒤 반드시 하는 일이고, 이 서버에서 가장 중요한
 * 안전장치다. 모델이 "더 좋게 쓰려다" 사실을 바꾸거나 원고를 새로 쓰는 사고를
 * 여기서 결정적으로 잡는다. LLM 호출 없음 — 판정은 언제나 코드가 한다.
 */

import {
  charChangeRate,
  eojeols,
  lcsLength,
  normalizeWs,
  round,
  stripMetaBlock,
} from "./text";

export interface FidelityIssue {
  code: string;
  severity: "abort" | "warn" | "note";
  message: string;
}

export interface FidelityReport {
  verdict: "ok" | "warn" | "abort";
  /** 문자 단위 변경률 — 판정의 기준값. */
  changeRate: number;
  /** 어절 단위 변경률 — 조사·어미까지 손댄 정도. 참고 지표. */
  eojeolChangeRate: number;
  lengthDelta: number;
  sentenceTouchRate: number;
  issues: FidelityIssue[];
  summary: string;
}

/**
 * 교정 강도의 상한. 이 선을 넘으면 교정이 아니라 재집필이다.
 * 문자 단위 기준이다 — 어절 단위로 재면 같은 교정이 두 배로 나와 정상적인
 * 교정까지 과교정으로 잡힌다(실측: 문자 22.8% = 어절 46.9%).
 */
export const CHANGE_WARN = 0.3;
export const CHANGE_ABORT = 0.5;

const NUM_TOKEN = /\d[\d,]*(?:\.\d+)?/g;
const KO_UNIT: Record<string, number> = { 만: 1e4, 억: 1e8, 조: 1e12, 천: 1e3, 백: 1e2 };

function numberValues(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(NUM_TOKEN)) {
    const tok = m[0].replace(/,/g, "");
    const next = text[m.index! + m[0].length];
    const mult = next ? KO_UNIT[next] : undefined;
    if (mult) {
      const v = Number(tok) * mult;
      if (Number.isFinite(v)) {
        out.add(Number.isInteger(v) ? String(v) : String(v));
        continue;
      }
    }
    out.add(tok);
  }
  return out;
}

/**
 * 인용으로 볼 최소 길이.
 *
 * 8자로 잡았더니 「운이 좋았다」(6자)가 통째로 다른 말로 바뀌었는데도 통과했다.
 * 한국어는 조밀해서 6~7자면 이미 한 문장이다. 5자로 낮춰 짧은 실제 인용을
 * 잡되, 강조용 따옴표("혁신적" 같은 두세 글자)는 계속 제외한다.
 */
function extractQuotes(text: string, minLen = 5): string[] {
  const quotes: string[] = [];
  for (const [op, cl] of [
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
  ]) {
    const re = new RegExp(`${op}([^${cl}]+)${cl}`, "g");
    for (const m of text.matchAll(re)) quotes.push(m[1]);
  }
  const parts = text.split('"');
  if (parts.length % 2 === 1) {
    for (let i = 1; i < parts.length; i += 2) quotes.push(parts[i]);
  }
  return quotes.filter((q) => q.trim().length >= minLen);
}

function extractHeadings(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => /^\s*#{1,6}\s+\S/.test(l))
    .map((l) => normalizeWs(l.replace(/^\s*#{1,6}\s+/, "")));
}

/**
 * 내용 주입 검사 — 원고에 없던 문장이 교정본에 생겼는지 본다.
 *
 * 실측에서 Solar가 블로그 초안 끝에 "다음 글에서 더 자세히 살펴보겠습니다"를
 * 통째로 지어 붙였다. 앞뒤 문장이 압축돼 분량은 +1%였고 인용·수치도 멀쩡해서
 * 다른 검사는 전부 통과했다. 이 서버의 약속이 "내용은 더하지도 빼지도 않는다"인
 * 이상 이건 반드시 잡아야 한다.
 *
 * 문장을 통째로 비교하지 않는다 — 교정은 원래 문장을 크게 바꾸므로 표면
 * 유사도로는 '다시 쓴 문장'과 '지어낸 문장'을 못 가른다. 대신 **내용어가
 * 원고에 있었는지**를 본다. 다시 쓴 문장은 명사를 그대로 쓰고, 지어낸 문장은
 * 원고에 없던 명사를 데려온다.
 */
const FUNCTION_WORDS = new Set([
  "그리고", "그러나", "하지만", "또한", "따라서", "그래서", "즉", "다만", "물론",
  "이런", "저런", "그런", "이러한", "그러한", "때문에", "위해", "통해", "대한",
  "있다", "없다", "한다", "된다", "합니다", "됩니다", "입니다", "이다", "같은",
  "많은", "여러", "모든", "매우", "너무", "정말", "가장", "다시", "더욱", "훨씬",
]);

/** 어절에서 조사·어미를 대충 떼어낸 표층 어간. 형태소 분석기 없이 쓰는 근사치. */
function contentStem(token: string): string | null {
  const t = token.replace(PUNCT_ALL, "");
  if (t.length < 2) return null;
  if (FUNCTION_WORDS.has(t)) return null;
  if (!/[가-힣A-Za-z0-9]/.test(t)) return null;
  // 뒤쪽 60%만 남기면 조사·어미가 대부분 떨어져 나간다.
  return t.slice(0, Math.max(2, Math.ceil(t.length * 0.6)));
}

const PUNCT_ALL = /[.,!?;:()[\]{}"'`~、。“”‘’\-—…·]/g;

/**
 * 문장 통째가 아니라 **낱말 몇 개**가 새로 들어온 경우를 위한 관찰 목록.
 *
 * 실측: "기존 대비"가 "동일 규모 베이스라인 대비"로 바뀌었다. 문장의 나머지가
 * 원고 그대로라 위의 문장 단위 검사는 통과한다. 이런 건 게이트로 막으면 오탐이
 * 쏟아진다 — 교정은 원래 낱말을 바꾸는 일이기 때문이다. 그래서 막지 않고
 * 목록만 보여 준다. 눈으로 훑는 데 몇 초면 되고, 그 몇 초가 필요한 자리다.
 */
function findNewTerms(before: string, after: string): string[] {
  const haystack = before.replace(/\s+/g, "");
  const seen = new Set<string>();
  for (const token of after.split(/\s+/)) {
    const bare = token.replace(PUNCT_ALL, "");
    // 짧은 낱말은 조사·어미와 구분이 안 되고, 용언은 교정에서 늘 바뀐다.
    if (bare.length < 3) continue;
    if (/(?:다|고|며|서|은|는|이|가|을|를|의|에|로|와|과|도|만)$/.test(bare)) continue;
    const stem = contentStem(bare);
    if (!stem || haystack.includes(stem)) continue;
    // 활용형은 어간 두 글자가 원고에 남는다("느껴지는" → "느껴졌기").
    // 이걸 걸러야 목록이 '정말 새로 들어온 말'만 남는다.
    if (haystack.includes(bare.slice(0, 2))) continue;
    seen.add(bare);
    if (seen.size >= 6) break;
  }
  return [...seen];
}

function findInjectedContent(before: string, after: string): string[] {
  const haystack = before.replace(/\s+/g, "");
  const flagged: string[] = [];

  for (const sentence of splitForTouch(after)) {
    const stems = sentence
      .split(/\s+/)
      .map(contentStem)
      .filter((x): x is string => x !== null);
    // 내용어가 서넛도 안 되는 짧은 문장은 판단 근거가 부족하다.
    if (stems.length < 4) continue;

    const unknown = stems.filter((stem) => !haystack.includes(stem));
    const coverage = 1 - unknown.length / stems.length;
    // 내용어의 절반 이상이 원고에 없다면 그 문장은 다시 쓴 것이 아니라 지어낸 것이다.
    if (coverage < 0.5 && unknown.length >= 3) flagged.push(sentence);
  }
  return flagged;
}

const HAYEOT = /하였/g;
const YO_ENDING = /요\s*(?:[.?!…]|$)/gm;

/**
 * 새로 심으면 안 되는 상투구.
 *
 * "의미가 크다", "~할 때다"는 일부러 뺐다. 원고의 "매우 중요한 의미를 가지고
 * 있다고 볼 수 있다"를 "의미가 크다"로 줄이는 것은 상투구 주입이 아니라
 * 정상적인 압축이고, 그걸 위반으로 잡으면 게이트가 양치기 소년이 된다.
 * 그 표현들은 가독성 점수(readability)에서 감점 요인으로만 남는다.
 * 여기 남은 것들은 원고에 없던 칭찬·과장을 덧붙이는 경우뿐이다.
 */
const CLICHE_GUARD: Array<[string, RegExp]> = [
  ["기록적인 성과", /기록적인\s*성과/g],
  ["괄목할 만한", /괄목할\s*만한/g],
  ["~로 평가된다", /(?:로|으로)\s*평가(?:된다|받|되)/g],
  ["주목받-", /주목받/g],
  ["크게 기여", /크게\s*기여/g],
  ["시사하는 바가 크다", /시사하는\s*바가\s*크/g],
  ["중요한 역할을 한다", /중요한\s*역할을\s*(?:한다|했다|할)/g],
  ["전례 없는", /전례\s*없는/g],
];

/**
 * 문체 등급 판정 — 원고가 '한다체'였는데 교정본이 '합쇼체'로 올라오는 사고를
 * 잡는다. 실측에서 실제로 났다. 모델은 정중하게 쓰는 것이 친절이라고 여기지만,
 * 필자가 정한 말투를 편집자가 바꾸는 것은 교정이 아니라 개작이다.
 */
export type Register = "합쇼체" | "해요체" | "한다체" | "음슴체";

export function registerProfile(text: string): { dominant: Register | null; share: number } {
  const sentences = text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tally: Record<Register, number> = { 합쇼체: 0, 해요체: 0, 한다체: 0, 음슴체: 0 };
  let counted = 0;
  for (const s of sentences) {
    const tail = s.replace(/["'”’」』)\]]*[.!?…]*$/, "");
    if (/(?:습니다|ㅂ니다|입니다|습니까|ㅂ니까|니다)$/.test(tail)) tally.합쇼체 += 1;
    else if (/요$/.test(tail)) tally.해요체 += 1;
    else if (/(?:다|까|라|자)$/.test(tail)) tally.한다체 += 1;
    else if (/(?:음|함|됨|임)$/.test(tail)) tally.음슴체 += 1;
    else continue;
    counted += 1;
  }
  if (counted < 3) return { dominant: null, share: 0 };
  const [dominant, n] = (Object.entries(tally) as Array<[Register, number]>).sort(
    (a, b) => b[1] - a[1],
  )[0];
  return { dominant, share: n / counted };
}

function count(text: string, re: RegExp): number {
  return (text.match(new RegExp(re.source, re.flags)) ?? []).length;
}

function splitForTouch(text: string): string[] {
  return text
    .split(/(?<=[.!?。…])\s+|\n+/)
    .map(normalizeWs)
    .filter(Boolean);
}

export interface FidelityInput {
  before: string;
  after: string;
  /** 한 글자도 바뀌면 안 되는 줄 — 사용자가 지정한 인용·법조문·슬로건 등. */
  preserve?: string[];
}

export function checkFidelity({ before, after, preserve = [] }: FidelityInput): FidelityReport {
  const a = stripMetaBlock(before);
  const b = stripMetaBlock(after);
  const issues: FidelityIssue[] = [];

  if (!b.trim()) {
    return {
      verdict: "abort",
      changeRate: 1,
      eojeolChangeRate: 1,
      lengthDelta: -1,
      sentenceTouchRate: 1,
      issues: [{ code: "empty_output", severity: "abort", message: "교정본이 비어 있습니다." }],
      summary: "교정본이 비어 있어 채택할 수 없습니다.",
    };
  }

  // --- 변경량 -------------------------------------------------------------
  const wa = eojeols(a);
  const wb = eojeols(b);
  const changeRate = charChangeRate(a, b);
  const eojeolChangeRate =
    1 - (2 * lcsLength(wa, wb)) / Math.max(1, wa.length + wb.length);
  const lengthDelta = (b.length - a.length) / Math.max(1, a.length);

  if (changeRate >= CHANGE_ABORT) {
    issues.push({
      code: "over_edited",
      severity: "abort",
      message: `변경률 ${Math.round(changeRate * 100)}% — 교정이 아니라 재집필입니다. 채택하지 마세요.`,
    });
  } else if (changeRate >= CHANGE_WARN) {
    issues.push({
      code: "heavy_edit",
      severity: "warn",
      message: `변경률 ${Math.round(changeRate * 100)}% — 손이 많이 갔습니다. 원본과 대조해 확인하세요.`,
    });
  }

  if (lengthDelta > 0.15) {
    issues.push({
      code: "length_grown",
      severity: "warn",
      message: `분량이 ${Math.round(lengthDelta * 100)}% 늘었습니다. 교정은 덜어내는 작업입니다 — 내용이 새로 붙지 않았는지 보세요.`,
    });
  }

  // --- 사실 보존 ----------------------------------------------------------
  const numsA = numberValues(a);
  const numsB = numberValues(b);
  const injected = [...numsB].filter((n) => !numsA.has(n));
  const dropped = [...numsA].filter((n) => !numsB.has(n));
  if (injected.length > 0) {
    issues.push({
      code: "number_injected",
      severity: "abort",
      message: `원본에 없던 수치가 생겼습니다: ${injected.slice(0, 8).join(", ")}`,
    });
  }
  if (dropped.length > 0) {
    issues.push({
      code: "number_dropped",
      severity: "note",
      message: `원본 수치가 교정본에 없습니다: ${dropped.slice(0, 8).join(", ")} (문장 병합의 정상 부산물일 수 있으니 눈으로 확인하세요.)`,
    });
  }

  for (const injected of findInjectedContent(a, b)) {
    issues.push({
      code: "content_injected",
      severity: "abort",
      message: `원고에 없던 문장이 교정본에 생겼습니다: 「${injected.slice(0, 45)}${injected.length > 45 ? "…" : ""}」 — 교정은 없던 내용을 지어내는 작업이 아닙니다.`,
    });
  }

  const newTerms = findNewTerms(a, b);
  if (newTerms.length > 0) {
    issues.push({
      code: "new_terms",
      severity: "note",
      message: `원고에 없던 낱말이 교정본에 있습니다: ${newTerms.join(", ")} (같은 뜻의 다른 표현이면 정상입니다. 없던 사실을 덧붙인 것은 아닌지만 확인하세요.)`,
    });
  }

  for (const q of extractQuotes(a)) {
    if (!b.includes(q)) {
      issues.push({
        code: "quote_altered",
        severity: "abort",
        message: `직접 인용이 그대로 남지 않았습니다: 「${q.slice(0, 30)}…」`,
      });
      break;
    }
  }

  const headA = extractHeadings(a);
  const headB = new Set(extractHeadings(b));
  const lostHeadings = headA.filter((h) => !headB.has(h));
  if (lostHeadings.length > 0) {
    issues.push({
      code: "heading_lost",
      severity: "warn",
      message: `소제목이 사라졌거나 바뀌었습니다: ${lostHeadings.slice(0, 3).join(" / ")}`,
    });
  }

  for (const line of preserve) {
    const needle = normalizeWs(line);
    if (needle && !normalizeWs(b).includes(needle)) {
      issues.push({
        code: "preserve_broken",
        severity: "abort",
        message: `보존 지정한 문장이 원형 그대로 남지 않았습니다: 「${needle.slice(0, 40)}…」`,
      });
    }
  }

  // --- 문체 역주행 --------------------------------------------------------
  const hayeotA = count(a, HAYEOT);
  const hayeotB = count(b, HAYEOT);
  if (hayeotB > hayeotA) {
    issues.push({
      code: "register_raised",
      severity: "warn",
      message: `'하였-' 계열이 ${hayeotA}→${hayeotB}회로 늘었습니다. 격식을 올리는 것도 문체 변경입니다.`,
    });
  }

  const regA = registerProfile(a);
  const regB = registerProfile(b);
  if (
    regA.dominant &&
    regB.dominant &&
    regA.dominant !== regB.dominant &&
    regA.share >= 0.5 &&
    regB.share >= 0.5
  ) {
    issues.push({
      code: "register_switched",
      severity: "abort",
      message: `문체가 ${regA.dominant}에서 ${regB.dominant}로 바뀌었습니다. 말투는 필자가 정하는 것이지 교정에서 바꾸는 것이 아닙니다.`,
    });
  }

  const yoA = count(a, YO_ENDING);
  const yoB = count(b, YO_ENDING);
  if (yoA >= 3 && yoB < yoA * 0.5) {
    issues.push({
      code: "colloquial_erased",
      severity: "warn",
      message: `구어 종결('~요')이 ${yoA}→${yoB}회로 격감했습니다. 말맛이 깎였는지 보세요.`,
    });
  }

  for (const [name, re] of CLICHE_GUARD) {
    const ca = count(a, re);
    const cb = count(b, re);
    if (cb > ca) {
      issues.push({
        code: "cliche_injected",
        severity: "warn",
        message: `상투구 '${name}'이 ${ca}→${cb}회로 늘었습니다. 교정은 상투구를 심는 작업이 아닙니다.`,
      });
    }
  }

  // --- 구조 관찰(게이트 아님) ---------------------------------------------
  const sentsA = splitForTouch(a);
  const setB = new Set(splitForTouch(b));
  const touched = sentsA.filter((s) => !setB.has(s)).length;
  const sentenceTouchRate = touched / Math.max(1, sentsA.length);

  const verdict: FidelityReport["verdict"] = issues.some((i) => i.severity === "abort")
    ? "abort"
    : issues.some((i) => i.severity === "warn")
      ? "warn"
      : "ok";

  const summary =
    verdict === "abort"
      ? "채택 불가 — 원본의 사실이나 구조가 훼손됐습니다."
      : verdict === "warn"
        ? "채택 가능하지만 확인이 필요한 지점이 있습니다."
        : "원본의 사실·인용·구조가 그대로입니다. 문장만 손봤습니다.";

  return {
    verdict,
    changeRate: round(changeRate, 4),
    eojeolChangeRate: round(eojeolChangeRate, 4),
    lengthDelta: round(lengthDelta, 4),
    sentenceTouchRate: round(sentenceTouchRate, 4),
    issues,
    summary,
  };
}
