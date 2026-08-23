import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Solar Human Proofreader",
  description:
    "한국어 원고를 사람 편집자가 손본 것처럼 교정하는 MCP 서버. Upstage Solar Pro 4 기반.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0, background: "#ffffff" }}>{children}</body>
    </html>
  );
}
