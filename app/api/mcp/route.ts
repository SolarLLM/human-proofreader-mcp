/**
 * MCP 엔드포인트 — Streamable HTTP, 무상태.
 *
 * 세션을 두지 않는 이유는 서버리스라서다. 요청마다 다른 인스턴스가 받을 수
 * 있으니 세션 상태를 서버에 쌓지 않고, 필요한 컨텍스트(헤더·클라이언트 식별)는
 * AsyncLocalStorage로 그 요청 안에서만 흐르게 한다.
 */

import { createMcpHandler } from "mcp-handler";

import { clientKeyFrom } from "@/lib/quota";
import { registerTools } from "@/lib/tools";
import { withRequestContext } from "@/lib/context";

export const runtime = "nodejs";
// 정독 교정은 Solar를 세 번 부른다. Vercel Hobby는 60초로 잘리므로 그 경우
// depth를 standard 이하로 쓰거나 Pro(최대 300초)로 올려야 한다.
export const maxDuration = 300;

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  {
    serverInfo: { name: "solar-human-proofreader", version: "0.1.0" },
    instructions: [
      "Solar Human Proofreader — 한국어 원고를 사람 편집자가 손본 것처럼 교정하는 서버입니다.",
      "",
      "글을 다듬어 달라는 요청에는 proofread를 씁니다. 고치지 말고 문제만 짚어 달라면 read_through,",
      "수치만 빠르게 보려면 readability(무료), 이미 고친 원고를 검증하려면 compare(무료)를 씁니다.",
      "",
      "원칙: 내용은 더하지도 빼지도 않습니다. 수치·인용·고유명사·문체 등급은 그대로 두고 문장만 손봅니다.",
      "교정본을 사용자에게 전달할 때는 함께 나온 '원고 대조' 결과를 반드시 같이 보여 주세요 —",
      "⛔ 판정이 뜬 교정본은 채택하면 안 됩니다.",
    ].join("\n"),
    verboseLogs: process.env.NODE_ENV !== "production",
  },
);

async function route(request: Request): Promise<Response> {
  const ctx = { headers: request.headers, clientKey: clientKeyFrom(request.headers) };
  return withRequestContext(ctx, () => handler(request));
}

export { route as GET, route as POST, route as DELETE };
