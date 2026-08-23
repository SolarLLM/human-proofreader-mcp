import type { Metadata } from "next";
import type { ReactNode } from "react";

import { getBaseUrl } from "@/lib/site";

const DESCRIPTION =
  "한국어 원고를 사람 편집자가 손본 것처럼 교정하는 MCP 서버. Upstage Solar Pro 4가 문장을 손보고, 사실·인용·말투가 그대로인지는 코드가 판정합니다. 하루 100콜 무료.";

/**
 * 메타데이터를 정적 객체가 아니라 함수로 만드는 이유는 metadataBase 때문이다.
 * 이 값이 배포본의 실제 주소여야 OG 이미지·canonical이 절대 URL로 나가고,
 * 링크를 공유했을 때 미리보기가 제대로 뜬다.
 */
export async function generateMetadata(): Promise<Metadata> {
  const base = await getBaseUrl();

  return {
    metadataBase: new URL(base),
    title: {
      default: "Solar Human Proofreader — 한국어 윤문 MCP 서버",
      template: "%s · Solar Human Proofreader",
    },
    description: DESCRIPTION,
    applicationName: "Solar Human Proofreader",
    keywords: [
      "MCP",
      "Model Context Protocol",
      "한국어 윤문",
      "교정",
      "가독성",
      "Solar Pro 4",
      "Upstage",
      "번역투",
      "AI 글쓰기",
    ],
    authors: [{ name: "SolarLLM", url: "https://github.com/SolarLLM" }],
    alternates: { canonical: base },
    openGraph: {
      type: "website",
      siteName: "Solar Human Proofreader",
      locale: "ko_KR",
      url: base,
      title: "사람 편집자가 빨간 펜으로 손본 원고를 돌려드립니다",
      description: DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: "사람 편집자가 빨간 펜으로 손본 원고를 돌려드립니다",
      description: DESCRIPTION,
    },
    robots: { index: true, follow: true },
    other: {
      // 이 페이지를 읽는 AI가 설치 정보를 어디서 찾을지 바로 알게 한다.
      "mcp:endpoint": `${base}/api/mcp`,
      "mcp:manifest": `${base}/mcp.json`,
      "mcp:transport": "streamable-http",
    },
  };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#ffffff" }}>{children}</body>
    </html>
  );
}
