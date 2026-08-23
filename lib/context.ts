/**
 * 요청 컨텍스트 — 도구 콜백 안에서 원래 HTTP 요청의 헤더를 읽기 위한 통로.
 *
 * BYOK 키는 도구 인자가 아니라 헤더로 받는다. 인자로 받으면 클라이언트의
 * 대화 기록·로그에 평문으로 남기 때문이다. MCP 도구 콜백은 핸들러 호출의
 * 하위 async 컨텍스트에서 실행되므로 AsyncLocalStorage로 안전하게 잇는다.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  headers: Headers;
  /** 무료 티어 사용량을 세는 단위. 익명화된 해시. */
  clientKey: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function header(name: string): string | undefined {
  return getRequestContext()?.headers.get(name)?.trim() || undefined;
}
