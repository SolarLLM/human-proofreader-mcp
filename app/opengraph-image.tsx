/**
 * 소셜 미리보기 이미지 (1200×630).
 *
 * 링크를 공유했을 때 무엇을 해 주는 서버인지 한눈에 보이게 한다. 설명을 늘어놓는
 * 대신 실제 교정 전후를 나란히 놓았다 — 이 서버가 하는 일이 정확히 그것이라서다.
 */

import { ImageResponse } from "next/og";
import { loadKoreanFont } from "@/lib/og-font";

export const runtime = "nodejs";
export const alt = "Solar Human Proofreader — 사람 편집자가 빨간 펜으로 손본 원고를 돌려드립니다";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const HEADLINE = "사람 편집자가 빨간 펜으로\n손본 원고를 돌려드립니다.";
const SUB = "한국어 원고를 읽기 쉽게 교정하는 MCP 서버 · Upstage Solar Pro 4";
const BADGES = ["하루 100콜 무료", "가입·카드 등록 없음", "설치 없이 URL 한 줄"];
const BEFORE = "기존 연구들에 있어서는 파라미터 수를 증가시키는 것을 통해 성능 개선을 도모하는 방식이 채택되어 왔으나…";
const AFTER = "기존 연구는 주로 모델 파라미터 수를 늘려 성능을 개선해 왔다. 그러나 이 방식은 연산 비용이 급격히 늘어난다.";

export default async function Image() {
  // 서브셋은 실제로 그리는 문자열에서 뽑는다. 손으로 적으면 반드시 빠뜨린다.
  const all = [
    HEADLINE,
    SUB,
    BEFORE,
    AFTER,
    "Solar Human Proofreader",
    "원고",
    "교정본",
    "가독성 53",
    "가독성 95",
    ...BADGES,
  ].join("");
  const [bold, regular] = await Promise.all([
    loadKoreanFont(all, 700),
    loadKoreanFont(all, 400),
  ]);

  const fonts = [
    ...(bold ? [{ name: "Noto", data: bold, weight: 700 as const, style: "normal" as const }] : []),
    ...(regular
      ? [{ name: "Noto", data: regular, weight: 400 as const, style: "normal" as const }]
      : []),
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#ffffff",
          padding: "62px 68px",
          fontFamily: "Noto",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* 교정 부호 캐럿. 글자로 찍으면 폰트 서브셋에 없어 두부가 되므로
                테두리를 45도 돌려 그린다. */}
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: "#1a1a1a",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderTop: "3px solid #f97316",
                  borderLeft: "3px solid #f97316",
                  transform: "rotate(45deg)",
                  marginTop: 5,
                }}
              />
            </div>
            <div style={{ fontSize: 25, fontWeight: 700, color: "#c2410c", letterSpacing: 0.5 }}>
              Solar Human Proofreader
            </div>
          </div>

          <div
            style={{
              marginTop: 26,
              fontSize: 60,
              fontWeight: 700,
              lineHeight: 1.28,
              color: "#1a1a1a",
              whiteSpace: "pre-wrap",
              letterSpacing: -1.5,
            }}
          >
            {HEADLINE}
          </div>

          <div style={{ marginTop: 20, fontSize: 26, color: "#525252" }}>{SUB}</div>

          <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
            {BADGES.map((b, i) => (
              <div
                key={b}
                style={{
                  display: "flex",
                  background: i === 0 ? "#fff7ed" : "#f7f7f6",
                  color: i === 0 ? "#c2410c" : "#525252",
                  border: `1px solid ${i === 0 ? "#fed7aa" : "#e5e5e5"}`,
                  borderRadius: 999,
                  padding: "7px 18px",
                  fontSize: 21,
                  fontWeight: i === 0 ? 700 : 400,
                }}
              >
                {b}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          <Panel label="원고" body={BEFORE} score="53" tone="plain" />
          <Panel label="교정본" body={AFTER} score="95" tone="accent" />
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length > 0 ? fonts : undefined },
  );
}

function Panel({
  label,
  body,
  score,
  tone,
}: {
  label: string;
  body: string;
  score: string;
  tone: "plain" | "accent";
}) {
  const accent = tone === "accent";
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        background: accent ? "#fffbf7" : "#fafaf9",
        border: `1px solid ${accent ? "#fed7aa" : "#e7e5e4"}`,
        borderRadius: 12,
        padding: "18px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: accent ? "#c2410c" : "#737373",
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, color: accent ? "#c2410c" : "#a3a3a3" }}>
          {`가독성 ${score}`}
        </div>
      </div>
      <div style={{ marginTop: 10, fontSize: 19, lineHeight: 1.55, color: "#404040" }}>{body}</div>
    </div>
  );
}
