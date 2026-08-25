/**
 * 교정 파이프라인 — 사람 편집자의 작업 순서를 그대로 옮긴 것.
 *
 *   통독(코드) → 소견(Solar) → 교정(Solar) → 원고 대조(코드) → 국소 보정(Solar)
 *
 * 판단이 필요한 자리만 Solar가 맡고, 재는 일과 판정은 전부 코드가 한다.
 * 모델에게 "네가 얼마나 고쳤는지 말해봐"라고 묻지 않는 이유는 간단하다 —
 * 자기가 방금 쓴 글을 자기가 채점하면 언제나 후하기 때문이다.
 */

import { checkFidelity, type FidelityReport } from "./fidelity";
import {
  chat,
  resolveProvider,
  type ChatResult,
  type Provider,
  ProviderError,
} from "./provider";
import {
  diagnosePrompt,
  finalizePrompt,
  parsePolished,
  polishPrompt,
  type Genre,
  type Strength,
} from "./prompts";
import { analyze, recommendDepth, type ReadabilityReport } from "./readability";
import {
  consumeQuota,
  FREE_DAILY_LIMIT,
  reserveQuota,
  type QuotaState,
} from "./quota";
import { getRequestContext } from "./context";

export type Depth = "light" | "standard" | "deep" | "auto";

export const MAX_INPUT_CHARS = Number(process.env.MAX_INPUT_CHARS ?? 20000);

export class QuotaExceededError extends Error {
  constructor(readonly state: QuotaState, readonly needed: number) {
    super("무료 한도 초과");
  }
}

/** 이번 요청에서 실제로 쓴 Solar 호출을 센다. 실패한 호출은 세지 않는다. */
class Budget {
  calls = 0;
  promptTokens = 0;
  completionTokens = 0;

  record(r: ChatResult) {
    this.calls += 1;
    this.promptTokens += r.usage?.prompt_tokens ?? 0;
    this.completionTokens += r.usage?.completion_tokens ?? 0;
  }
}

function plannedCalls(depth: Exclude<Depth, "auto">): number {
  return depth === "light" ? 1 : depth === "standard" ? 2 : 3;
}

export interface ProofreadOptions {
  text: string;
  genre?: Genre;
  strength?: Strength;
  depth?: Depth;
  audience?: string;
  instructions?: string;
  preserve?: string[];
}

export interface ProofreadResult {
  polished: string;
  depth: Exclude<Depth, "auto">;
  strength: Strength;
  before: ReadabilityReport;
  after: ReadabilityReport;
  fidelity: FidelityReport;
  diagnosis?: string;
  editorNotes: string[];
  finalizeNotes: string[];
  retried: boolean;
  finalized: boolean;
  provider: Provider;
  usage: { calls: number; promptTokens: number; completionTokens: number };
  quota?: QuotaState;
}

async function precheck(provider: Provider, needed: number) {
  if (!provider.metered) return;
  const ctx = getRequestContext();
  if (!ctx) return;
  const { allowed, state } = await reserveQuota(ctx.clientKey, needed);
  if (!allowed) throw new QuotaExceededError(state, needed);
}

async function settle(provider: Provider, budget: Budget): Promise<QuotaState | undefined> {
  const ctx = getRequestContext();
  if (!ctx) return undefined;
  if (!provider.metered) return undefined;
  return consumeQuota(ctx.clientKey, budget.calls);
}

/** 남은 무료 한도 안에서만 추가 호출을 허용한다. BYOK면 언제나 허용. */
async function canSpendMore(provider: Provider, budget: Budget, extra: number) {
  if (!provider.metered) return true;
  const ctx = getRequestContext();
  if (!ctx) return true;
  const { allowed } = await reserveQuota(ctx.clientKey, budget.calls + extra);
  return allowed;
}

export async function proofread(opts: ProofreadOptions): Promise<ProofreadResult> {
  const text = opts.text.trim();
  if (!text) throw new Error("교정할 원고가 비어 있습니다.");
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(
      `원고가 ${text.length}자입니다. 한 번에 ${MAX_INPUT_CHARS}자까지 처리합니다. ` +
        `장을 나눠 보내시면 각 장의 문체가 더 고르게 유지됩니다.`,
    );
  }

  const provider = resolveProvider();
  const before = analyze(text);
  const depth: Exclude<Depth, "auto"> =
    !opts.depth || opts.depth === "auto" ? recommendDepth(before) : opts.depth;
  const strength: Strength =
    opts.strength ?? (depth === "light" ? "보수" : depth === "deep" ? "적극" : "기본");
  const genre: Genre = opts.genre ?? "자동";
  // deep은 통독·교정·롤백·보정으로 콜을 최대 네 번 쓴다. 호출당 120초 타임아웃에
  // 재시도까지 붙으면 함수 상한(800초)을 넘긴다. 120초를 넘긴 호출은 다시 불러도
  // 대개 또 넘기므로, 깊은 교정에서는 재시도를 끄고 상한 안에 가둔다.
  const retries = depth === "deep" ? 0 : 1;

  await precheck(provider, plannedCalls(depth));

  const budget = new Budget();

  // --- 1. 통독 소견 (standard·deep) ---------------------------------------
  let diagnosis: string | undefined;
  if (depth !== "light") {
    const p = diagnosePrompt(text, genre, before);
    const res = await chat(
      provider,
      [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
      { temperature: 0.3, maxTokens: 2500, retries },
    );
    budget.record(res);
    diagnosis = res.text.trim();
  }

  // --- 2. 교정 -------------------------------------------------------------
  const runPolish = async (s: Strength) => {
    const p = polishPrompt({
      text,
      genre,
      strength: s,
      audience: opts.audience,
      instructions: opts.instructions,
      preserve: opts.preserve,
      report: before,
      diagnosis,
    });
    const res = await chat(
      provider,
      [
        { role: "system", content: p.system },
        { role: "user", content: p.user },
      ],
      { temperature: 0.4, maxTokens: Math.min(32000, Math.ceil(text.length * 1.6) + 2000), retries },
    );
    budget.record(res);
    return parsePolished(res.text);
  };

  let { text: polished, notes: editorNotes } = await runPolish(strength);
  let finalizeNotes: string[] = [];
  let fidelity = checkFidelity({ before: text, after: polished, preserve: opts.preserve });

  // --- 3. 과교정 롤백 — 한 번만 -------------------------------------------
  let retried = false;
  const overEdited = fidelity.issues.some(
    (i) => i.severity === "abort" && (i.code === "over_edited" || i.code === "empty_output"),
  );
  if (overEdited && (await canSpendMore(provider, budget, 1))) {
    retried = true;
    const second = await runPolish("보수");
    const secondFidelity = checkFidelity({
      before: text,
      after: second.text,
      preserve: opts.preserve,
    });
    // 재시도가 더 나쁘면 첫 결과를 쓴다. 무조건 덮어쓰면 두 번 실패한다.
    if (secondFidelity.changeRate < fidelity.changeRate) {
      polished = second.text;
      editorNotes = second.notes;
      fidelity = secondFidelity;
    }
  }

  // --- 4. 국소 보정 — deep이거나 대조에서 걸린 게 있을 때 ------------------
  //
  // "많이 고쳤다"는 것만으로는 부르지 않는다. D등급 원고를 제대로 손보면
  // 변경률은 당연히 높고, 거기에 매번 콜을 하나 더 쓰면 정작 필요한 곳에
  // 쓸 한도가 없다. 잘 쓰인 원고(A·B)를 크게 고친 경우는 이야기가 다르다 —
  // 그건 편집자가 선을 넘은 것이므로 다시 본다.
  let finalized = false;
  const FIDELITY_CODES = new Set([
    "content_injected",
    "number_injected",
    "quote_altered",
    "preserve_broken",
    "heading_lost",
    "register_raised",
    "register_switched",
    "colloquial_erased",
    "cliche_injected",
    "length_grown",
  ]);
  const needsFix = fidelity.issues.some(
    (i) =>
      FIDELITY_CODES.has(i.code) ||
      (i.code === "heavy_edit" && (before.grade === "A" || before.grade === "B")),
  );
  // abort라고 무조건 손 떼지 않는다. 지어낸 문장·주입된 수치·뒤집힌 문체는
  // 그 자리만 되돌리면 살아나는 원고다. 반대로 전면 재작성(over_edited)이나
  // 빈 출력은 국소 보정으로 못 고친다 — 그때만 보정을 건너뛴다.
  const unfixable = fidelity.issues.some(
    (i) => i.severity === "abort" && (i.code === "over_edited" || i.code === "empty_output"),
  );
  if (
    (depth === "deep" || needsFix) &&
    !unfixable &&
    (await canSpendMore(provider, budget, 1))
  ) {
    const issues = fidelity.issues
      .filter((i) => i.severity !== "note" && i.code !== "heavy_edit")
      .map((i) => i.message);
    if (issues.length > 0 || depth === "deep") {
      const p = finalizePrompt(
        text,
        polished,
        issues.length > 0 ? issues : ["대조에서 걸린 지점은 없습니다. 필자의 목소리가 깎이지 않았는지만 확인하세요."],
      );
      const res = await chat(
        provider,
        [
          { role: "system", content: p.system },
          { role: "user", content: p.user },
        ],
        { temperature: 0.25, maxTokens: Math.min(32000, Math.ceil(text.length * 1.6) + 2000), retries },
      );
      budget.record(res);
      const fixed = parsePolished(res.text);
      const fixedFidelity = checkFidelity({
        before: text,
        after: fixed.text,
        preserve: opts.preserve,
      });
      // 보정이 상황을 악화시키면 버린다.
      const severity = (f: typeof fixedFidelity) =>
        f.issues.filter((i) => i.severity === "abort").length;
      if (fixed.text && severity(fixedFidelity) <= severity(fidelity)) {
        polished = fixed.text;
        finalizeNotes = fixed.notes;
        fidelity = fixedFidelity;
        finalized = true;
      }
    }
  }

  const after = analyze(polished);
  const quota = await settle(provider, budget);

  return {
    polished,
    depth,
    strength,
    before,
    after,
    fidelity,
    diagnosis,
    editorNotes,
    finalizeNotes,
    retried,
    finalized,
    provider,
    usage: {
      calls: budget.calls,
      promptTokens: budget.promptTokens,
      completionTokens: budget.completionTokens,
    },
    quota,
  };
}

/** 통독 소견만 — 원고를 고치지 않는다. */
export async function readThrough(text: string, genre: Genre = "자동") {
  const provider = resolveProvider();
  const report = analyze(text);
  await precheck(provider, 1);
  const p = diagnosePrompt(text, genre, report);
  const res = await chat(
    provider,
    [
      { role: "system", content: p.system },
      { role: "user", content: p.user },
    ],
    { temperature: 0.3, maxTokens: 2500 },
  );
  const budget = new Budget();
  budget.record(res);
  const quota = await settle(provider, budget);
  return { report, diagnosis: res.text.trim(), provider, quota, usage: { calls: 1 } };
}

/** 한 대목의 대안 여러 개 — 여백에 적어 주는 제안. */
export async function suggestVariants(
  text: string,
  context: string | undefined,
  count: number,
) {
  const provider = resolveProvider();
  await precheck(provider, 1);
  const { variantsPrompt } = await import("./prompts");
  const p = variantsPrompt(text, context, count);
  const res = await chat(
    provider,
    [
      { role: "system", content: p.system },
      { role: "user", content: p.user },
    ],
    { temperature: 0.9, maxTokens: 2000 },
  );
  const budget = new Budget();
  budget.record(res);
  const quota = await settle(provider, budget);
  return { suggestions: res.text.trim(), provider, quota };
}

export function quotaHelpText(state: QuotaState, needed: number): string {
  return [
    `무료 한도를 다 쓰셨습니다. (오늘 ${state.used}/${state.limit}회 · 이번 요청에 ${needed}회 필요)`,
    `한도는 ${state.resetsAt}에 초기화됩니다.`,
    "",
    "계속 쓰시려면 본인 키를 헤더에 넣어 주세요 — 이때는 한도가 없습니다.",
    "",
    '  "solar-human-proofreader": {',
    '    "url": "<이 서버 주소>/api/mcp",',
    '    "headers": { "X-Upstage-Api-Key": "up_..." }',
    "  }",
    "",
    "  · Upstage 키: https://console.upstage.ai  (헤더 X-Upstage-Api-Key)",
    "  · OpenRouter 키: https://openrouter.ai/keys  (헤더 X-OpenRouter-Api-Key)",
    "",
    `무료 한도는 Solar 호출 1회 단위로 셉니다 (하루 ${FREE_DAILY_LIMIT}회).`,
    "통독 소견 1회 + 교정 1회 = 2회처럼 계산됩니다.",
  ].join("\n");
}

export function providerErrorText(err: ProviderError): string {
  if (err.code === "no_key") return err.message;
  return `Solar 호출 중 문제가 있었습니다.\n${err.message}`;
}
