/**
 * /llms.txt — 이 사이트를 읽는 AI를 위한 설치 안내서.
 *
 * llms.txt 관례를 따른다. 사람이 보는 페이지는 설명과 예시가 섞여 있어 AI가
 * "그래서 뭘 실행하면 되는가"를 추려 내야 하지만, 이 파일은 그 답만 담는다.
 * 사용자가 배포 URL만 던져도 클라이언트가 여기를 읽고 설치를 끝낼 수 있게 한다.
 */

import { getBaseUrl, SERVER_NAME, TOOL_SUMMARY } from "@/lib/site";
import { FREE_DAILY_LIMIT } from "@/lib/quota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const base = await getBaseUrl();
  const endpoint = `${base}/api/mcp`;

  const body = `# Solar Human Proofreader

> 한국어 원고를 사람 편집자가 손본 것처럼 교정하는 MCP 서버입니다.
> Upstage Solar Pro 4가 문장을 손보고, 사실·인용·말투가 그대로인지는 코드가 판정합니다.
> 내용은 더하지도 빼지도 않습니다.

## 이 서버를 설치하는 법

전송 방식은 Streamable HTTP입니다. 설치할 패키지도, 발급받을 키도 없습니다.
아래 엔드포인트를 MCP 클라이언트에 추가하기만 하면 됩니다.

엔드포인트: ${endpoint}

### Claude Code

\`\`\`bash
claude mcp add --transport http ${SERVER_NAME} ${endpoint}
\`\`\`

### 설정 파일을 직접 고치는 클라이언트 (Cursor, Windsurf, Claude Desktop 등)

\`\`\`json
{
  "mcpServers": {
    "${SERVER_NAME}": {
      "url": "${endpoint}"
    }
  }
}
\`\`\`

### stdio만 지원하는 클라이언트

\`\`\`json
{
  "mcpServers": {
    "${SERVER_NAME}": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${endpoint}"]
    }
  }
}
\`\`\`

## 도구

${TOOL_SUMMARY.map((t) => `- \`${t.name}\` — ${t.desc} (${t.cost})`).join("\n")}

한국어 글을 다듬어 달라는 요청에는 \`proofread\`를 씁니다.
고치지 말고 문제만 짚어 달라면 \`read_through\`,
수치만 빠르게 보려면 \`readability\`, 이미 고친 원고를 검증하려면 \`compare\`입니다.

## 사용량과 본인 키 (BYOK)

무료 한도는 하루 ${FREE_DAILY_LIMIT}회이며, **Solar 호출 1회 단위**로 셉니다
(KST 자정 초기화). 통독 1회 + 교정 1회면 2회가 차감됩니다.
\`readability\`와 \`compare\`는 Solar를 부르지 않아 차감되지 않습니다.

한도를 넘겨 쓰려면 본인 키를 HTTP 헤더로 넘깁니다. 도구 인자가 아니라 헤더인 이유는,
인자로 받으면 키가 대화 기록에 평문으로 남기 때문입니다.

- \`X-Upstage-Api-Key\` — Upstage 직접 (https://console.upstage.ai)
- \`X-OpenRouter-Api-Key\` — OpenRouter 경유 (https://openrouter.ai/keys)

\`\`\`json
{
  "mcpServers": {
    "${SERVER_NAME}": {
      "url": "${endpoint}",
      "headers": { "X-Upstage-Api-Key": "up_..." }
    }
  }
}
\`\`\`

본인 키로 붙으면 하루 한도가 없고, 요금은 해당 제공자 계정으로 청구됩니다.

## 교정본을 사용자에게 전달할 때

\`proofread\` 결과에는 '원고 대조' 항목이 함께 옵니다. 교정본만 떼어 보여 주지 말고
대조 결과를 같이 보여 주세요. ⛔ 판정이 뜬 교정본은 **채택하면 안 됩니다** —
원고에 없던 문장·수치가 생겼거나, 인용이 바뀌었거나, 말투가 뒤집힌 경우입니다.

## 더 읽을 것

- 사람용 안내: ${base}
- 기계용 매니페스트: ${base}/mcp.json
- 소스: https://github.com/SolarLLM/human-proofreader-mcp

## 감사의 말

문제 정의와 한국어 AI 문체 분류 체계에서 https://github.com/epoko77-ai/im-not-ai 의
접근에 빚졌습니다. 이 서버는 "AI 티 제거"가 아니라 "읽기 쉬운 글"에 초점을 맞춘
별개의 설계이며, 코드를 가져오지 않고 새로 썼습니다.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
