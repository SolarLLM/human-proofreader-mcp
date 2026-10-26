/**
 * SSE 응답에 keep-alive 주석을 끼운다.
 *
 * 정독 교정은 Solar 를 여러 번 불러 수 분이 걸리는데, 그동안 mcp-handler 는 헤더만 보내고
 * 본문은 결과가 나올 때까지 비워 둔다. 앞단 프록시(Vercel rewrites 는 120초)는 바이트가
 * 끊기면 연결을 닫는다. SSE 규격상 `:` 로 시작하는 줄은 모든 클라이언트가 무시하므로,
 * 조용한 동안 그 줄을 흘려 연결만 살려 둔다.
 */

export const KEEPALIVE_COMMENT = ": keepalive\n\n";

/** 프록시 한도(120초)보다 넉넉히 짧게. */
const DEFAULT_INTERVAL_MS = 25_000;

export function withSseKeepalive(res: Response, intervalMs = DEFAULT_INTERVAL_MS): Response {
  const type = res.headers.get("content-type") ?? "";
  if (!res.body || !type.includes("text/event-stream")) return res;

  const ping = new TextEncoder().encode(KEEPALIVE_COMMENT);
  const reader = res.body.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  // 이벤트 경계(빈 줄) 위에 있을 때만 끼운다. 청크가 이벤트 중간에서 잘려 올 수 있다.
  let atBoundary = true;
  let quiet = true;

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setInterval(() => {
        if (quiet && atBoundary) {
          try {
            controller.enqueue(ping);
          } catch {
            clearInterval(timer);
          }
        }
        quiet = true;
      }, intervalMs);
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          clearInterval(timer);
          controller.close();
          return;
        }
        quiet = false;
        if (value.length > 0) atBoundary = endsWithBlankLine(value);
        controller.enqueue(value);
      } catch (err) {
        clearInterval(timer);
        controller.error(err);
      }
    },
    cancel(reason) {
      clearInterval(timer);
      return reader.cancel(reason);
    },
  });

  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** "\n\n" 또는 "\r\n\r\n" 로 끝나는가. */
function endsWithBlankLine(chunk: Uint8Array): boolean {
  const n = chunk.length;
  const LF = 0x0a;
  const CR = 0x0d;
  if (n >= 2 && chunk[n - 1] === LF && chunk[n - 2] === LF) return true;
  return n >= 4 && chunk[n - 1] === LF && chunk[n - 2] === CR && chunk[n - 3] === LF && chunk[n - 4] === CR;
}
