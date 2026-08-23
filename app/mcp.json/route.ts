/**
 * /mcp.json — 기계가 읽는 설치 매니페스트.
 *
 * llms.txt가 산문이라면 이쪽은 구조화된 같은 내용이다. 클라이언트나 스크립트가
 * 파싱해서 바로 설정에 꽂을 수 있게 클라이언트별 설정 조각까지 완성형으로 담는다.
 */

import { getBaseUrl, SERVER_NAME, TOOL_SUMMARY } from "@/lib/site";
import { FREE_DAILY_LIMIT } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = await getBaseUrl();
  const endpoint = `${base}/api/mcp`;

  return Response.json(
    {
      name: SERVER_NAME,
      displayName: "Solar Human Proofreader",
      description:
        "한국어 원고를 사람 편집자가 손본 것처럼 교정하는 MCP 서버. Solar Pro 4가 문장을 손보고, 사실·인용·말투 보존은 코드가 판정한다.",
      version: "0.1.0",
      transport: "streamable-http",
      url: endpoint,
      documentation: `${base}/llms.txt`,
      repository: "https://github.com/SolarLLM/human-proofreader-mcp",
      install: {
        claudeCode: `claude mcp add --transport http ${SERVER_NAME} ${endpoint}`,
        mcpServersEntry: { [SERVER_NAME]: { url: endpoint } },
        stdioBridge: {
          [SERVER_NAME]: { command: "npx", args: ["-y", "mcp-remote", endpoint] },
        },
      },
      auth: {
        required: false,
        freeTier: {
          dailyLimit: FREE_DAILY_LIMIT,
          unit: "solar_llm_call",
          resets: "00:00 Asia/Seoul",
          note: "readability와 compare는 LLM을 호출하지 않아 차감되지 않는다.",
        },
        bringYourOwnKey: {
          transport: "http-header",
          headers: {
            "X-Upstage-Api-Key": "https://console.upstage.ai",
            "X-OpenRouter-Api-Key": "https://openrouter.ai/keys",
          },
          note: "키는 헤더로만 받는다. 도구 인자로 받으면 대화 기록에 평문으로 남는다.",
        },
      },
      tools: TOOL_SUMMARY.map((t) => ({
        name: t.name,
        description: t.desc,
        cost: t.cost === "무료" ? "free" : t.cost,
      })),
      usageNotes: [
        "한국어 글을 다듬어 달라는 요청에는 proofread를 쓴다.",
        "proofread 결과의 '원고 대조'를 교정본과 함께 사용자에게 보여 준다.",
        "대조가 ⛔로 판정한 교정본은 채택하지 않는다.",
      ],
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
