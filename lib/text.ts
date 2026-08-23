/**
 * 한국어 텍스트 유틸 — 형태소 분석기 없이 정규식·표층형만 사용한다.
 *
 * 서버리스 환경에서 konlpy/mecab 류를 쓸 수 없기도 하고, 여기서 필요한 건
 * "정밀한 품사"가 아니라 "읽기 난이도의 결정적 근사값"이기 때문이다.
 * 정밀 판단은 Solar가 하고, 이 파일은 게이트·점수의 재현 가능한 눈금만 만든다.
 */

const SENTENCE_END = /(?<=[.!?。…])\s+/;

/** 마크다운 장식만 있는 줄(코드펜스·수평선·표 구분선). */
const MARKUP_ONLY_LINE = /^\s*(?:```.*|~~~.*|-{3,}|\*{3,}|={3,}|\|[\s:|-]*)\s*$/;

/** 줄머리 장식(헤딩·불릿·번호·인용) — 내용은 남기고 장식만 벗긴다. */
const MARKUP_PREFIX = /^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,3}[.)]\s+)/;

export function stripMarkup(text: string): string {
  return text
    .split("\n")
    .filter((line) => !MARKUP_ONLY_LINE.test(line))
    .map((line) => line.replace(MARKUP_PREFIX, ""))
    .join("\n");
}

/** 문장 분리. 마침표가 없는 줄(헤딩·불릿)도 한 문장으로 센다. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n+/)) {
    const line = block.trim();
    if (!line) continue;
    for (const part of line.split(SENTENCE_END)) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 어절 = 공백 분리 토큰. */
export function eojeols(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const PUNCT = /[.,!?;:()[\]{}"'`~、。“”‘’\-—…]+/g;

export function stripPunct(token: string): string {
  return token.replace(PUNCT, "");
}

export function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** final.md 관례를 따라 붙는 메타 주석 블록을 떼어낸다. */
export function stripMetaBlock(text: string): string {
  return text.replace(/<!--\s*SOLAR-POLISH\b[\s\S]*/, "").trim();
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

export function round(x: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/**
 * 어절 단위 LCS 길이. 두 줄짜리 DP라 1만 어절까지도 메모리가 상수다.
 * 순서를 보기 때문에 문장 재배치를 "변경 없음"으로 오판하지 않는다.
 */
export function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ai = a[i - 1];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ai === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  return prev[b.length];
}

/** 문자 bigram Dice 유사도 — 어절 LCS의 보조 지표(표기·조사 변화에 둔감). */
export function charDice(a: string, b: string): number {
  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    const t = s.replace(/\s+/g, "");
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let totalA = 0;
  let totalB = 0;
  for (const n of A.values()) totalA += n;
  for (const n of B.values()) totalB += n;
  if (totalA === 0 && totalB === 0) return 1;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (totalA + totalB);
}

/**
 * 문자 단위 변경률 — 교정을 얼마나 했는지의 단일 진실값.
 *
 * 어절 단위로 세면 조사 하나만 바뀌어도 그 어절이 통째로 "바뀐 것"이 되어
 * 실제의 두 배가 나온다(실측: 문자 22.8% → 어절 46.9%). 그래서 문자 단위로 센다.
 *
 * 문장이나 문단을 먼저 대응시키는 방식은 전부 버렸다. 좋은 교정은 긴 문장을
 * 쪼개고 짧은 문장을 붙이고 문단을 나눈다. 무엇을 단위로 잡든 1:1 대응은 그
 * 쪼개기·합치기를 "대응 실패"로 읽어 정상 교정을 재작성으로 오판한다
 * (실측: 한 문단을 넷으로 나눈 공지문이 75%로 나왔다 — 실제로는 24%).
 *
 * 전문에 그대로 LCS를 돌리는 것이 정확하고, 비용도 감당된다 — 2만 자 대 2만 자가
 * 1.1초다. Solar 호출 한 번이 20초를 넘는 마당에 이 정도는 싸다.
 */
export function charChangeRate(before: string, after: string): number {
  const a = before.replace(/\s+/g, " ").trim();
  const b = after.replace(/\s+/g, " ").trim();
  if (!a && !b) return 0;
  if (!a || !b) return 1;

  // 입력 상한(MAX_INPUT_CHARS)을 감안하면 닿지 않는 크기지만, 무한정 커지는
  // 입력에 서버가 멈추지는 않게 한다. 이 경우만 bigram 근사로 물러난다.
  if (a.length * b.length > 1e9) return Math.max(0, 1 - charDice(a, b));

  return Math.max(0, 1 - (2 * charLcs(a, b)) / (a.length + b.length));
}

/** 두 문자열의 LCS 길이. 두 줄 DP라 메모리는 길이에 비례한다. */
function charLcs(a: string, b: string): number {
  let prev = new Int32Array(b.length + 1);
  let cur = new Int32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ai === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  return prev[b.length];
}
