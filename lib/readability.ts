/**
 * 가독성 진단 — "사람 편집자가 원고를 통독하며 걸리는 지점"을 수치로 옮긴 것.
 *
 * 여기서 재는 것은 AI가 썼는지 여부가 아니다. 독자가 한 번에 읽어내는지다.
 * 편집자가 원고에 빨간 줄을 긋는 실제 이유 — 문장이 길어 숨이 찬다, 주어와
 * 서술어가 멀다, 번역기 문장 같다, 같은 어미가 반복돼 지루하다 — 를 결정적
 * 규칙으로 근사한다. LLM 호출이 없으므로 언제나 같은 입력에 같은 점수가 나온다.
 */

import {
  eojeols,
  mean,
  percentile,
  round,
  splitParagraphs,
  splitSentences,
  stdev,
  stripPunct,
} from "./text";

// --- 편집자가 걸려 넘어지는 표현들 ------------------------------------------

/** 번역투 — 영어 구문을 그대로 옮겨 한국어 어순이 깨진 자리. */
const TRANSLATIONESE: Array<[string, RegExp]> = [
  ["~에 대해(서)", /에\s*대(?:해|하여|한)\b/g],
  ["~에 있어(서)", /에\s*있어(?:서)?/g],
  ["~를 통해", /(?:을|를)\s*통(?:해|하여)/g],
  ["~와 관련하여", /와\s*관련(?:하여|해|된|하여서)/g],
  ["~에 기반하여", /에\s*기반(?:하여|한|해)|을\s*바탕으로/g],
  ["가지고 있다", /(?:가지고|갖고)\s*있(?:다|는|었|으)/g],
  ["~을 위해", /(?:을|를)\s*위(?:해|하여|한)/g],
  ["이중 조사", /(?:에서의|에로의|으로의|에의|으로부터의|로부터의)/g],
  ["~라는 점에서", /라는\s*점에서/g],
];

/** 피동 — 능동으로 되돌리면 문장이 짧고 또렷해지는 자리. */
const PASSIVE: Array<[string, RegExp]> = [
  ["이중 피동", /(?:되어진|되어져|여진|여져|잊혀진|보여진|쓰여진|불려진|놓여진|열려진|닫혀진)/g],
  ["~에 의해 피동", /에\s*의(?:해|하여)\s*\S{0,12}?(?:되|받|당하|지)(?:다|었|어|ㄴ다|는다|는|ㄹ|을)/g],
];

/** 명사화 — 동사로 풀면 살아나는 자리. */
const NOMINALIZATION: Array<[string, RegExp]> = [
  ["~것이다/~것", /(?:하는|되는|이라는|다는)\s*것(?:이다|은|을|이|입니다)/g],
  ["~에 다름 아니다", /에\s*다름\s*아니/g],
];

/** 완곡 — 단언할 수 있는데 뒤로 물러선 자리. */
const HEDGE: Array<[string, RegExp]> = [
  ["~로 보인다/판단된다", /(?:로|으로)\s*(?:보인다|보입니다|판단된다|여겨진다|생각된다)/g],
  ["~인 듯하다", /인\s*듯(?:하다|합니다|하며)/g],
  ["이중 완곡", /(?:할|될|일)\s*(?:가능성이\s*있을\s*수|수도\s*있을\s*것)/g],
];

/** 문두 접속사 — 서너 개는 흐름이지만, 다섯 개가 넘으면 목발이 된다. */
const OPENING_CONNECTIVES =
  /^(?:또한|따라서|그러나|하지만|그리고|즉|나아가|아울러|게다가|더욱이|한편|이는|이러한|이와\s*같이|결론적으로|그러므로|무엇보다)/;

/** 상투구 — 사람 편집자가 가장 먼저 지우는 말들. */
const CLICHES: Array<[string, RegExp]> = [
  ["기록적인 성과", /기록적인\s*성과/g],
  ["괄목할 만한", /괄목할\s*만한/g],
  ["~로 평가된다", /(?:로|으로)\s*평가(?:된다|받|되)/g],
  ["주목받-", /주목(?:받|을\s*끌)/g],
  ["시사하는 바가 크다", /시사하는\s*바가\s*크/g],
  ["의미가 크다", /의미가\s*크(?:다|며)/g],
  ["중요한 역할", /중요한\s*역할을\s*(?:한다|했다|할|하고)/g],
  ["혁신적/획기적/전례 없는", /(?:혁신적|획기적|압도적|파격적|폭발적|전례\s*없는)/g],
  ["~할 때다", /(?:할|해야\s*할)\s*(?:때|시점|순간)(?:이다|입니다)/g],
];

/** 연결어미 뒤 쉼표 — 만연체의 가장 뚜렷한 표지. */
const ENDING_COMMA = /(?:고|며|지만|면서|아서|어서)\s*,/g;
const ENDING_BOUNDARY = /(?:고|며|지만|면서|아서|어서)(?=[\s,.!?、。]|$)/g;

/** 한 문장 안의 연결어미 개수 — 3개 이상이면 숨이 찬다. */
const CLAUSE_CONNECTIVE =
  /(?:하고|되고|이고|있고|없고|하며|되며|이며|으며|있으며|지만|면서|아서|어서|는데|은데|므로|니까|자면|거나|하여|되어|도록)(?=[\s,])/g;

const HANJA_SUFFIX = ["성", "적", "화"];

function countAll(text: string, rules: Array<[string, RegExp]>) {
  const hits: Record<string, number> = {};
  let total = 0;
  for (const [name, re] of rules) {
    const n = (text.match(new RegExp(re.source, re.flags)) ?? []).length;
    if (n > 0) hits[name] = n;
    total += n;
  }
  return { total, hits };
}

export interface HardSentence {
  index: number;
  length: number;
  reason: string;
  text: string;
}

export interface ReadabilityReport {
  /** 0~100. 높을수록 술술 읽힌다. 편집자에게 넘기기 전 원고의 체온계. */
  score: number;
  grade: "A" | "B" | "C" | "D";
  verdict: string;
  size: {
    chars: number;
    sentences: number;
    paragraphs: number;
    eojeols: number;
  };
  flow: {
    avgSentenceChars: number;
    longestSentenceChars: number;
    p90SentenceChars: number;
    longSentenceRate: number;
    sentenceLengthCv: number;
    avgParagraphChars: number;
    clauseChainRate: number;
    endingCommaRate: number;
    endingRepeatMax: number;
    openingConnectiveRate: number;
  };
  friction: {
    translationese: number;
    passive: number;
    nominalization: number;
    hedge: number;
    cliche: number;
    hanjaSuffixDensity: number;
    details: Record<string, Record<string, number>>;
  };
  /** 편집자가 실제로 빨간 줄을 그을 문장들. */
  hardSentences: HardSentence[];
  /** 사람 말로 옮긴 지적 사항 — 그대로 사용자에게 보여줄 수 있다. */
  notes: string[];
}

/** 종결어미 표층(마지막 두 음절) 최대 연속 반복 수. */
function endingRepeatMax(sentences: string[]): number {
  let max = 1;
  let run = 1;
  let prev: string | null = null;
  for (const s of sentences) {
    const m = s.match(/([가-힣]{2})[.!?]?\s*$/);
    const key = m ? m[1] : null;
    if (key && key === prev) {
      run += 1;
      max = Math.max(max, run);
    } else {
      run = 1;
    }
    prev = key;
  }
  return max;
}

export function analyze(text: string): ReadabilityReport {
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  const toks = eojeols(text);
  const lens = sentences.map((s) => s.length);

  const chars = text.length;
  const longSentences = lens.filter((n) => n > 90).length;
  const avgSentence = mean(lens);
  const cv = avgSentence > 0 ? stdev(lens) / avgSentence : 0;

  const clauseHeavy = sentences.filter(
    (s) => (s.match(CLAUSE_CONNECTIVE) ?? []).length >= 3,
  ).length;

  const endingCommaHits = (text.match(ENDING_COMMA) ?? []).length;
  const endingBoundary = (text.match(ENDING_BOUNDARY) ?? []).length;
  const endingCommaRate = endingBoundary > 0 ? endingCommaHits / endingBoundary : 0;

  const openers = sentences.filter((s) => OPENING_CONNECTIVES.test(s)).length;

  const trans = countAll(text, TRANSLATIONESE);
  const pass = countAll(text, PASSIVE);
  const nomi = countAll(text, NOMINALIZATION);
  const hedge = countAll(text, HEDGE);
  const cliche = countAll(text, CLICHES);

  const cleanToks = toks.map(stripPunct).filter((t) => t.length >= 2);
  const hanjaHits = cleanToks.filter((t) => HANJA_SUFFIX.includes(t[t.length - 1])).length;
  const hanjaDensity = cleanToks.length > 0 ? hanjaHits / cleanToks.length : 0;

  const per1k = (n: number) => (chars > 0 ? (n / chars) * 1000 : 0);

  // --- 감점표 ------------------------------------------------------------
  // 편집자가 "이건 독자가 두 번 읽게 된다"고 판단하는 강도에 비례해 깎는다.
  // 각 항목의 상한을 둬서 한 지표가 점수를 독식하지 않게 한다.
  const penalties: Array<[string, number]> = [
    ["긴 문장", Math.min(22, (longSentences / Math.max(1, sentences.length)) * 90)],
    ["평균 문장 길이", Math.min(14, Math.max(0, avgSentence - 62) * 0.45)],
    ["리듬 단조로움", cv < 0.35 ? Math.min(10, (0.35 - cv) * 40) : 0],
    ["만연체", Math.min(14, (clauseHeavy / Math.max(1, sentences.length)) * 70)],
    ["연결어미 뒤 쉼표", Math.min(8, endingCommaRate * 40)],
    ["문두 접속사", Math.min(8, Math.max(0, openers / Math.max(1, sentences.length) - 0.15) * 45)],
    ["종결어미 반복", Math.min(6, Math.max(0, endingRepeatMax(sentences) - 3) * 2.5)],
    ["번역투", Math.min(14, per1k(trans.total) * 2.2)],
    ["피동", Math.min(8, per1k(pass.total) * 6)],
    ["명사화", Math.min(6, per1k(nomi.total) * 4)],
    ["완곡", Math.min(6, per1k(hedge.total) * 4)],
    ["상투구", Math.min(10, per1k(cliche.total) * 6)],
    ["한자어 명사화 밀도", Math.min(8, Math.max(0, hanjaDensity - 0.07) * 120)],
    [
      "문단 길이",
      Math.min(6, Math.max(0, mean(paragraphs.map((p) => p.length)) - 420) * 0.012),
    ],
  ];

  const deduction = penalties.reduce((a, [, v]) => a + v, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - deduction)));
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";

  // --- 빨간 줄 그을 문장 --------------------------------------------------
  const hardSentences: HardSentence[] = [];
  sentences.forEach((s, i) => {
    const clauses = (s.match(CLAUSE_CONNECTIVE) ?? []).length;
    const reasons: string[] = [];
    if (s.length > 110) reasons.push(`${s.length}자 — 한 호흡에 안 읽힘`);
    else if (s.length > 90) reasons.push(`${s.length}자 — 끊어 읽어야 함`);
    if (clauses >= 3) reasons.push(`연결어미 ${clauses}개 — 만연체`);
    if (PASSIVE.some(([, re]) => new RegExp(re.source).test(s))) reasons.push("피동");
    const t = TRANSLATIONESE.filter(([, re]) => new RegExp(re.source).test(s));
    if (t.length >= 2) reasons.push(`번역투 ${t.length}종`);
    if (reasons.length > 0) {
      hardSentences.push({
        index: i + 1,
        length: s.length,
        reason: reasons.join(" · "),
        text: s.length > 160 ? s.slice(0, 157) + "…" : s,
      });
    }
  });
  hardSentences.sort((a, b) => b.reason.length + b.length - (a.reason.length + a.length));

  // --- 사람 말로 옮긴 지적 -------------------------------------------------
  const notes: string[] = [];
  const top = [...penalties].filter(([, v]) => v >= 3).sort((a, b) => b[1] - a[1]);
  const phrasing: Record<string, string> = {
    "긴 문장": `90자 넘는 문장이 ${longSentences}개입니다. 독자가 중간에 앞으로 되돌아갑니다.`,
    "평균 문장 길이": `평균 ${Math.round(avgSentence)}자입니다. 55~65자면 눈이 편합니다.`,
    "리듬 단조로움": "문장 길이가 다 비슷합니다. 단문 하나를 끼워 넣으면 숨통이 트입니다.",
    만연체: `한 문장에 절이 셋 이상 물린 문장이 ${clauseHeavy}개입니다.`,
    "연결어미 뒤 쉼표": `'~하고,' '~지만,' 식 쉼표가 ${endingCommaHits}번입니다. 대부분 없어도 됩니다.`,
    "문두 접속사": `문장을 접속사로 여는 곳이 ${openers}군데입니다. 절반은 빼도 흐름이 남습니다.`,
    "종결어미 반복": "같은 종결어미가 내리 이어집니다. 한둘만 바꿔도 지루함이 걷힙니다.",
    번역투: `번역투가 ${trans.total}곳입니다 (${Object.keys(trans.hits).slice(0, 3).join(", ")}).`,
    피동: `피동이 ${pass.total}곳입니다. 행위자를 주어로 세우면 문장이 짧아집니다.`,
    명사화: `'~하는 것이다' 류가 ${nomi.total}곳입니다. 동사로 끝내면 또렷해집니다.`,
    완곡: `단언을 피한 자리가 ${hedge.total}곳입니다.`,
    상투구: `상투구가 ${cliche.total}곳입니다 (${Object.keys(cliche.hits).slice(0, 3).join(", ")}).`,
    "한자어 명사화 밀도": `-성/-적/-화 어절이 ${Math.round(hanjaDensity * 100)}%입니다. 7% 안쪽이 편합니다.`,
    "문단 길이": "문단이 깁니다. 한 문단 한 메시지로 끊어 주세요.",
  };
  for (const [name] of top.slice(0, 6)) {
    if (phrasing[name]) notes.push(phrasing[name]);
  }
  if (notes.length === 0) notes.push("눈에 걸리는 지점이 없습니다. 손대지 않아도 읽힙니다.");

  const verdict =
    grade === "A"
      ? "이미 사람이 다듬은 원고처럼 읽힙니다. 손댈 곳이 거의 없습니다."
      : grade === "B"
        ? "대체로 읽힙니다. 몇 군데만 손보면 매끄러워집니다."
        : grade === "C"
          ? "독자가 두 번 읽게 되는 문장이 꽤 있습니다. 교정이 필요합니다."
          : "문장 구조부터 손봐야 읽힙니다. 정독 교정을 권합니다.";

  return {
    score,
    grade,
    verdict,
    size: {
      chars,
      sentences: sentences.length,
      paragraphs: paragraphs.length,
      eojeols: toks.length,
    },
    flow: {
      avgSentenceChars: round(avgSentence, 1),
      longestSentenceChars: lens.length ? Math.max(...lens) : 0,
      p90SentenceChars: percentile(lens, 0.9),
      longSentenceRate: round(longSentences / Math.max(1, sentences.length), 3),
      sentenceLengthCv: round(cv, 3),
      avgParagraphChars: round(mean(paragraphs.map((p) => p.length)), 1),
      clauseChainRate: round(clauseHeavy / Math.max(1, sentences.length), 3),
      endingCommaRate: round(endingCommaRate, 3),
      endingRepeatMax: endingRepeatMax(sentences),
      openingConnectiveRate: round(openers / Math.max(1, sentences.length), 3),
    },
    friction: {
      translationese: trans.total,
      passive: pass.total,
      nominalization: nomi.total,
      hedge: hedge.total,
      cliche: cliche.total,
      hanjaSuffixDensity: round(hanjaDensity, 4),
      details: {
        translationese: trans.hits,
        passive: pass.hits,
        nominalization: nomi.hits,
        hedge: hedge.hits,
        cliche: cliche.hits,
      },
    },
    hardSentences: hardSentences.slice(0, 12),
    notes,
  };
}

/** 원고 상태에 맞는 교정 강도를 고른다 — 편집자가 통독 후 정하는 그 판단. */
export function recommendDepth(r: ReadabilityReport): "light" | "standard" | "deep" {
  if (r.size.chars > 12000) return "deep";
  if (r.grade === "A") return "light";
  if (r.grade === "D") return "deep";
  return "standard";
}
