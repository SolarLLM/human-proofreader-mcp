/**
 * MCP 도구 등록 — 편집자에게 원고를 맡기는 네 가지 방식.
 *
 *   proofread  : 원고를 넘기고 교정본을 받는다 (통독→교정→대조)
 *   read_through: 고치지 말고 뭐가 문제인지만 말해 달라
 *   readability : 수치만 빠르게 (Solar 호출 없음 · 무료)
 *   compare     : 내가 고친 원고를 원본과 대조해 달라 (Solar 호출 없음 · 무료)
 *   suggest     : 이 한 대목, 다르게 쓸 방법 몇 가지
 *   usage       : 오늘 무료 한도가 얼마나 남았나
 */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { getRequestContext } from "./context";
import { checkFidelity } from "./fidelity";
import { fidelityCard, proofreadReport, quotaLine, readabilityCard } from "./format";
import {
  MAX_INPUT_CHARS,
  proofread,
  providerErrorText,
  quotaHelpText,
  QuotaExceededError,
  readThrough,
  suggestVariants,
} from "./pipeline";
import { ProviderError, resolveProvider } from "./provider";
import { analyze } from "./readability";
import { FREE_DAILY_LIMIT, peekQuota } from "./quota";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const failure = (s: string) => ({ content: [{ type: "text" as const, text: s }], isError: true });

async function guard<T>(fn: () => Promise<T>, render: (v: T) => string) {
  try {
    return text(render(await fn()));
  } catch (err) {
    if (err instanceof QuotaExceededError) return failure(quotaHelpText(err.state, err.needed));
    if (err instanceof ProviderError) return failure(providerErrorText(err));
    return failure(`처리하지 못했습니다: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const GENRE = z
  .enum(["칼럼", "리포트", "블로그", "뉴스레터", "공적", "에세이", "자동"])
  .default("자동")
  .describe("원고의 장르. 편집자가 유지할 격(格)을 정한다. 생략하면 원고를 보고 판단한다.");

const STRENGTH = z
  .enum(["보수", "기본", "적극"])
  .optional()
  .describe(
    "교정 강도. 보수=확실히 이상한 곳만 (변경 10% 안팎), 기본=걸리는 자리 전부 (15~25%), 적극=문장 단위로 다듬기 (~35%). 생략하면 원고 상태에 맞춰 정한다.",
  );

export function registerTools(server: McpServer) {
  server.registerTool(
    "proofread",
    {
      title: "원고 교정 — 사람 편집자처럼",
      description:
        "한국어 원고를 사람 편집자가 손본 것처럼 교정한다. 원고를 통독해 걸리는 지점을 짚고(Solar), 그 지점만 겨냥해 문장을 손본 뒤(Solar), 원본과 대조해 사실·인용·수치·문체가 그대로인지 코드로 검증한다. 내용은 더하지도 빼지도 않고 문장만 읽기 쉽게 만든다. 한국어 글을 다듬어 달라·윤문해 달라·자연스럽게 만들어 달라는 요청에 쓴다.",
      inputSchema: z.object({
        text: z.string().min(1).max(MAX_INPUT_CHARS).describe("교정할 한국어 원고 전문."),
        genre: GENRE,
        strength: STRENGTH,
        depth: z
          .enum(["light", "standard", "deep", "auto"])
          .default("auto")
          .describe(
            "작업 깊이. light=교정 1콜, standard=통독+교정 2콜, deep=통독+교정+대조보정 3콜. auto면 원고 상태를 보고 정한다. 무료 한도는 콜 수만큼 차감된다.",
          ),
        audience: z
          .string()
          .optional()
          .describe("읽는 사람. 예: '비전공 임원', '개발자', '뉴스레터 구독자'."),
        instructions: z
          .string()
          .optional()
          .describe("필자가 따로 부탁할 것. 예: '마지막 문단은 짧게', '존댓말 유지'."),
        preserve: z
          .array(z.string())
          .optional()
          .describe("한 글자도 바뀌면 안 되는 문장들. 인용·슬로건·법조문 등. 대조 단계에서 강제한다."),
      }),
    },
    async (args) =>
      guard(
        () =>
          proofread({
            text: args.text,
            genre: args.genre,
            strength: args.strength,
            depth: args.depth,
            audience: args.audience,
            instructions: args.instructions,
            preserve: args.preserve,
          }),
        proofreadReport,
      ),
  );

  server.registerTool(
    "read_through",
    {
      title: "통독 소견 — 고치지 않고 짚어만 준다",
      description:
        "원고를 한 글자도 고치지 않고, 이 글이 잘 안 읽히는 이유만 편집자 소견서로 돌려준다. 논지가 끊기는 자리, 같은 말을 두 번 하는 문단, 리듬이 죽은 대목처럼 수치로 안 잡히는 것까지 본다. 교정 전에 방향을 잡거나, 필자가 직접 고치고 싶을 때 쓴다.",
      inputSchema: z.object({
        text: z.string().min(1).max(MAX_INPUT_CHARS).describe("통독할 한국어 원고."),
        genre: GENRE,
      }),
    },
    async (args) =>
      guard(
        () => readThrough(args.text, args.genre),
        (r) =>
          [
            readabilityCard(r.report, "원고 가독성"),
            "",
            "---",
            "",
            r.diagnosis,
            "",
            quotaLine(r.quota, r.provider.label),
          ].join("\n"),
      ),
  );

  server.registerTool(
    "readability",
    {
      title: "가독성 측정 (Solar 호출 없음 · 무료)",
      description:
        "한국어 원고의 읽기 난이도를 결정적 규칙으로만 잰다. 문장 길이 분포, 만연체 비율, 번역투·피동·명사화·완곡·상투구 빈도, 리듬 편차를 0~100점으로 요약하고, 빨간 줄을 그을 문장을 짚어 준다. LLM을 부르지 않으므로 무료 한도를 쓰지 않고 즉시 답한다. 교정 전후 비교나 여러 원고 훑기에 쓴다.",
      inputSchema: z.object({
        text: z.string().min(1).describe("측정할 한국어 원고."),
      }),
    },
    async (args) => {
      const r = analyze(args.text);
      const lines = [readabilityCard(r)];
      if (r.notes.length > 0) lines.push("", "**걸리는 지점**", ...r.notes.map((n) => `- ${n}`));
      if (r.hardSentences.length > 0) {
        lines.push(
          "",
          "**빨간 줄 그을 문장**",
          ...r.hardSentences.slice(0, 6).map((h) => `- (${h.reason})\n  > ${h.text}`),
        );
      }
      lines.push("", "_Solar 호출 없이 계산했습니다. 무료 한도를 쓰지 않았습니다._");
      return text(lines.join("\n"));
    },
  );

  server.registerTool(
    "compare",
    {
      title: "원고 대조 (Solar 호출 없음 · 무료)",
      description:
        "원본과 고친 원고를 나란히 놓고 대조한다. 변경률, 없던 수치가 생겼는지, 직접 인용이 그대로인지, 소제목이 사라졌는지, 문체 등급이 오르내렸는지, 상투구가 새로 심겼는지를 코드로 판정한다. 이 서버가 교정한 결과든, 다른 모델이나 사람이 고친 원고든 똑같이 검증할 수 있다.",
      inputSchema: z.object({
        before: z.string().min(1).describe("원본 원고."),
        after: z.string().min(1).describe("고친 원고."),
        preserve: z.array(z.string()).optional().describe("원형 그대로 남아야 하는 문장들."),
      }),
    },
    async (args) => {
      const f = checkFidelity({ before: args.before, after: args.after, preserve: args.preserve });
      const b = analyze(args.before);
      const a = analyze(args.after);
      return text(
        [
          fidelityCard(f),
          "",
          `**가독성 ${b.score} (${b.grade}) → ${a.score} (${a.grade})**`,
          `- 평균 문장 ${b.flow.avgSentenceChars}자 → ${a.flow.avgSentenceChars}자`,
          `- 번역투 ${b.friction.translationese} → ${a.friction.translationese} · 피동 ${b.friction.passive} → ${a.friction.passive} · 상투구 ${b.friction.cliche} → ${a.friction.cliche}`,
          "",
          "_Solar 호출 없이 계산했습니다. 무료 한도를 쓰지 않았습니다._",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "suggest",
    {
      title: "이 대목, 다르게 쓴다면",
      description:
        "문장 하나나 짧은 문단을 놓고 서로 다른 방향의 대안을 여러 개 제안한다. 짧게 끊은 안, 원문의 호흡을 살린 안, 어순을 바꿔 힘을 준 안처럼 결이 다르게 낸다. 뜻과 사실은 그대로 두고 표현만 바꾼다. 제목·리드·마지막 문장처럼 한 줄이 중요한 자리에 쓴다.",
      inputSchema: z.object({
        text: z.string().min(1).max(2000).describe("고칠 문장 또는 짧은 문단."),
        context: z.string().max(4000).optional().describe("앞뒤 맥락. 있으면 결이 맞는 안이 나온다."),
        count: z.number().int().min(2).max(5).default(3).describe("받을 대안 개수."),
      }),
    },
    async (args) =>
      guard(
        () => suggestVariants(args.text, args.context, args.count),
        (r) => [r.suggestions, "", quotaLine(r.quota, r.provider.label)].join("\n"),
      ),
  );

  server.registerTool(
    "usage",
    {
      title: "오늘 남은 무료 한도",
      description:
        "오늘 쓴 Solar 호출 수와 남은 무료 한도, 지금 어떤 키로 붙어 있는지를 보여 준다. 본인 키(BYOK)로 붙어 있으면 한도가 없다는 것도 여기서 확인한다.",
      inputSchema: z.object({}),
    },
    async () => {
      const ctx = getRequestContext();
      let providerLabel = "provider 미설정";
      let metered = true;
      try {
        const p = resolveProvider();
        providerLabel = p.label;
        metered = p.metered;
      } catch (err) {
        if (err instanceof ProviderError) providerLabel = err.message;
      }

      if (!metered) {
        return text(
          [
            `**${providerLabel}**`,
            "본인 키로 붙어 있어 하루 한도가 없습니다. 요금은 해당 제공자 계정으로 청구됩니다.",
          ].join("\n"),
        );
      }

      const quota = ctx ? await peekQuota(ctx.clientKey) : undefined;
      return text(
        [
          `**${providerLabel}**`,
          quota
            ? `오늘 ${quota.used}/${quota.limit}회 사용 · ${quota.remaining}회 남음 (${quota.resetsAt} 초기화)`
            : `무료 한도 하루 ${FREE_DAILY_LIMIT}회`,
          quota?.bestEffort
            ? "\n_이 서버에 Redis가 연결돼 있지 않아 집계가 인스턴스별 근사치입니다._"
            : null,
          "",
          "한도를 넘겨 쓰시려면 요청 헤더에 본인 키를 넣으세요:",
          "  · `X-Upstage-Api-Key` — Upstage 직접 (https://console.upstage.ai)",
          "  · `X-OpenRouter-Api-Key` — OpenRouter 경유 (https://openrouter.ai/keys)",
          "",
          "한도는 Solar 호출 1회 단위로 셉니다. `readability`와 `compare`는 Solar를 부르지 않아 차감되지 않습니다.",
        ]
          .filter((line) => line !== null)
          .join("\n"),
      );
    },
  );
}
