/**
 * 결과를 사람이 읽는 형태로 옮긴다.
 *
 * MCP 클라이언트는 이 텍스트를 그대로 사용자에게 보여 준다. 그래서 지표를
 * 늘어놓기보다 "편집자가 원고를 돌려주며 하는 말"의 순서로 쓴다 —
 * 무엇을 했는지, 무엇이 나아졌는지, 무엇을 확인해야 하는지.
 */

import type { FidelityReport } from "./fidelity";
import type { ProofreadResult } from "./pipeline";
import type { QuotaState } from "./quota";
import type { ReadabilityReport } from "./readability";

function bar(score: number): string {
  const filled = Math.round(score / 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

export function quotaLine(quota: QuotaState | undefined, providerLabel: string): string {
  if (!quota) return `_${providerLabel} — 본인 키로 호출했습니다. 무료 한도를 쓰지 않습니다._`;
  const warn = quota.remaining <= 10 ? " ⚠️ 곧 소진됩니다" : "";
  const loose = quota.bestEffort ? " (집계는 인스턴스별 근사치입니다)" : "";
  return `_${providerLabel} · 오늘 ${quota.used}/${quota.limit}회 사용, ${quota.remaining}회 남음 — ${quota.resetsAt} 초기화${warn}${loose}_`;
}

export function readabilityCard(r: ReadabilityReport, title = "가독성"): string {
  const lines = [
    `**${title} ${r.score}/100 (${r.grade})**  \`${bar(r.score)}\``,
    r.verdict,
    "",
    `- 분량 ${r.size.chars}자 · 문장 ${r.size.sentences}개 · 문단 ${r.size.paragraphs}개`,
    `- 평균 문장 ${r.flow.avgSentenceChars}자 · 최장 ${r.flow.longestSentenceChars}자 · 90자 초과 ${Math.round(r.flow.longSentenceRate * 100)}%`,
    `- 만연체 ${Math.round(r.flow.clauseChainRate * 100)}% · 리듬 편차 ${r.flow.sentenceLengthCv} · 같은 어미 최대 ${r.flow.endingRepeatMax}연속`,
    `- 번역투 ${r.friction.translationese} · 피동 ${r.friction.passive} · 명사화 ${r.friction.nominalization} · 완곡 ${r.friction.hedge} · 상투구 ${r.friction.cliche}`,
  ];
  return lines.join("\n");
}

export function fidelityCard(f: FidelityReport): string {
  const icon = f.verdict === "ok" ? "✅" : f.verdict === "warn" ? "⚠️" : "⛔";
  const lines = [
    `${icon} **원고 대조 — ${f.summary}**`,
    `- 변경률 ${Math.round(f.changeRate * 100)}% (어절 기준 ${Math.round(f.eojeolChangeRate * 100)}%) · 손댄 문장 ${Math.round(f.sentenceTouchRate * 100)}% · 분량 ${f.lengthDelta >= 0 ? "+" : ""}${Math.round(f.lengthDelta * 100)}%`,
  ];
  if (f.issues.length > 0) {
    lines.push("");
    for (const i of f.issues) {
      const mark = i.severity === "abort" ? "⛔" : i.severity === "warn" ? "⚠️" : "ℹ️";
      lines.push(`  ${mark} ${i.message}`);
    }
  }
  return lines.join("\n");
}

const DEPTH_LABEL: Record<string, string> = {
  light: "가볍게 훑기 (1콜)",
  standard: "표준 교정 (통독 + 교정)",
  deep: "정독 교정 (통독 + 교정 + 대조 보정)",
};

export function proofreadReport(r: ProofreadResult): string {
  const delta = r.after.score - r.before.score;
  const deltaText = delta > 0 ? `+${delta}` : String(delta);

  const head =
    r.fidelity.verdict === "abort"
      ? `⛔ **이 교정본은 채택하지 마세요.** 원고의 사실이나 구조가 어긋났습니다. 아래 대조 결과를 먼저 보세요.`
      : `✅ **교정을 마쳤습니다.** 가독성 ${r.before.score} → ${r.after.score} (${deltaText}), 변경률 ${Math.round(r.fidelity.changeRate * 100)}%`;

  const parts: string[] = [
    head,
    `_${DEPTH_LABEL[r.depth]} · 강도 ${r.strength}${r.retried ? " · 과교정으로 한 번 되돌림" : ""}${r.finalized ? " · 대조 후 국소 보정" : ""}_`,
    "",
    "---",
    "",
    "## 교정본",
    "",
    r.polished,
    "",
    "---",
    "",
  ];

  // 모델이 노트에 혼잣말을 길게 적는 일이 있다. 원고 옆 여백에 적히는
  // 메모의 분량을 넘기면 잘라 낸다 — 읽히지 않는 노트는 노트가 아니다.
  const trim = (notes: string[], max: number) =>
    notes.slice(0, max).map((n) => (n.length > 200 ? `${n.slice(0, 197)}…` : n));

  if (r.editorNotes.length > 0) {
    parts.push("## 교정 노트", "", ...trim(r.editorNotes, 7).map((n) => `- ${n}`), "");
  }
  if (r.finalizeNotes.length > 0) {
    parts.push(
      "## 대조 후 되돌린 것",
      "",
      ...trim(r.finalizeNotes, 5).map((n) => `- ${n}`),
      "",
    );
  }

  parts.push(fidelityCard(r.fidelity), "");

  if (r.before.notes.length > 0) {
    parts.push(
      "## 통독하며 걸렸던 지점",
      "",
      ...r.before.notes.map((n) => `- ${n}`),
      "",
    );
  }

  parts.push(
    "## 전후 비교",
    "",
    `| | 원고 | 교정본 |`,
    `|---|---|---|`,
    `| 가독성 | ${r.before.score} (${r.before.grade}) | ${r.after.score} (${r.after.grade}) |`,
    `| 평균 문장 | ${r.before.flow.avgSentenceChars}자 | ${r.after.flow.avgSentenceChars}자 |`,
    `| 90자 초과 문장 | ${Math.round(r.before.flow.longSentenceRate * 100)}% | ${Math.round(r.after.flow.longSentenceRate * 100)}% |`,
    `| 번역투 | ${r.before.friction.translationese} | ${r.after.friction.translationese} |`,
    `| 피동 | ${r.before.friction.passive} | ${r.after.friction.passive} |`,
    `| 상투구 | ${r.before.friction.cliche} | ${r.after.friction.cliche} |`,
    "",
    quotaLine(r.quota, r.provider.label) +
      ` · Solar 호출 ${r.usage.calls}회 (${r.usage.promptTokens + r.usage.completionTokens} 토큰)`,
  );

  if (r.after.score < r.before.score) {
    parts.push(
      "",
      "⚠️ 교정 뒤 가독성 점수가 떨어졌습니다. `strength: \"보수\"`로 다시 부르거나, 원고를 그대로 두는 편이 나을 수 있습니다.",
    );
  }

  return parts.join("\n");
}
