/**
 * SSE keep-alive 의 회귀 테스트.
 * Vercel rewrites 로 다른 서버에 넘기면, 프록시는 120초 동안 바이트가 안 오면 연결을 끊는다.
 * 정독 교정은 그보다 오래 걸리고 그 사이 mcp-handler 는 아무것도 보내지 않는다 — 그래서 주석 줄을 끼운다.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { KEEPALIVE_COMMENT, withSseKeepalive } from "../lib/keepalive";

const enc = new TextEncoder();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 손으로 조종하는 SSE 응답. push 로 바이트를 흘리고 end 로 닫는다. */
function controlledSse(contentType = "text/event-stream") {
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    res: new Response(body, { status: 200, headers: { "content-type": contentType, "mcp-session-id": "s1" } }),
    push: (s: string) => ctrl.enqueue(enc.encode(s)),
    end: () => ctrl.close(),
    wasCancelled: () => cancelled,
  };
}

const EVENT = 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{}}\n\n';

test("조용한 동안 주석을 끼우고, 원래 이벤트는 그대로 전달한다", async () => {
  const src = controlledSse();
  const out = withSseKeepalive(src.res, 20);
  const text = out.text();
  await sleep(70);
  src.push(EVENT);
  src.end();
  const body = await text;

  assert.ok(body.endsWith(EVENT), "원래 이벤트가 끝에 온전히 있어야 한다");
  const pings = body.slice(0, -EVENT.length);
  assert.ok(pings.length > 0, "70ms 동안 20ms 간격이면 주석이 몇 번은 들어가야 한다");
  assert.equal(pings.replaceAll(KEEPALIVE_COMMENT, ""), "", "주석 말고 다른 것이 섞이면 안 된다");
});

// 청크가 이벤트 한가운데서 잘려 올 수 있다. 그 사이에 주석이 끼면 data 줄이 망가진다.
test("이벤트가 반쯤 온 상태에서는 주석을 끼우지 않는다", async () => {
  const src = controlledSse();
  const out = withSseKeepalive(src.res, 10);
  const text = out.text();
  src.push('event: message\ndata: {"jsonrpc":');
  await sleep(60);
  src.push('"2.0","id":2,"result":{}}\n\n');
  src.end();
  const body = await text;

  const start = body.indexOf("event: message");
  assert.equal(body.slice(start), EVENT, "이벤트 안쪽에 아무것도 끼어들면 안 된다");
});

test("SSE 가 아닌 응답은 손대지 않는다", async () => {
  const json = new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
  assert.equal(withSseKeepalive(json, 10), json);
});

test("상태와 헤더를 유지한다", () => {
  const src = controlledSse();
  const out = withSseKeepalive(src.res, 1000);
  assert.equal(out.status, 200);
  assert.equal(out.headers.get("content-type"), "text/event-stream");
  assert.equal(out.headers.get("mcp-session-id"), "s1");
  src.end();
});

// 클라이언트가 끊으면 도구 실행 쪽 스트림도 닫혀야 한다. 안 그러면 타이머가 영원히 돈다.
test("클라이언트가 끊으면 원래 스트림을 취소한다", async () => {
  const src = controlledSse();
  const out = withSseKeepalive(src.res, 10);
  await out.body!.cancel();
  assert.ok(src.wasCancelled());
});
