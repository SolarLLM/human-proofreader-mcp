/**
 * 무료 티어 — 하루 100콜까지 서버 키로 처리하고, 넘으면 BYOK로 넘긴다.
 *
 * 세는 단위는 "Solar 호출 1회"다. proofread 한 번이 통독·교정·대조로 두세 번
 * 부르면 그만큼 차감된다. 도구 호출 단위로 세면 같은 무료 한도가 사람마다
 * 10배씩 차이 나서, 쓰는 쪽도 내는 쪽도 예측할 수 없다.
 *
 * 하루 경계는 KST 자정. 저장소는 Upstash Redis(REST)이며, 환경변수가 없으면
 * 인스턴스 메모리로 물러난다 — 서버리스에서는 인스턴스가 여럿이라 이 경우
 * 한도가 느슨해질 수 있고, 그 사실을 응답에 표시한다.
 */

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";

export const FREE_DAILY_LIMIT = Number(process.env.FREE_DAILY_LIMIT ?? 100);

let redis: Redis | null = null;
let redisChecked = false;

function getRedis(): Redis | null {
  if (redisChecked) return redis;
  redisChecked = true;
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

const memory = new Map<string, { count: number; expires: number }>();

/** KST 기준 오늘 날짜 키 (YYYY-MM-DD). */
export function kstDay(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/** KST 자정까지 남은 초. */
export function secondsUntilKstMidnight(now = new Date()): number {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const endOfDay = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() + 1,
    0,
    0,
    0,
  );
  return Math.max(60, Math.ceil((endOfDay - kst.getTime()) / 1000));
}

/** IP·클라이언트 식별자를 그대로 저장하지 않는다. 해시만 남긴다. */
export function clientKeyFrom(headers: Headers): string {
  const explicit = headers.get("x-client-id");
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown";
  const salt = process.env.QUOTA_SALT ?? "solar-human-proofreader";
  return createHash("sha256").update(`${salt}:${explicit ?? ip}`).digest("hex").slice(0, 24);
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  resetsAt: string;
  /** Redis 없이 메모리로 셌다면 true — 한도가 인스턴스별로 느슨하다. */
  bestEffort: boolean;
}

async function read(key: string): Promise<number> {
  const r = getRedis();
  if (r) return Number((await r.get<number>(key)) ?? 0);
  const hit = memory.get(key);
  if (!hit || hit.expires < Date.now()) return 0;
  return hit.count;
}

async function bump(key: string, by: number, ttl: number): Promise<number> {
  const r = getRedis();
  if (r) {
    const next = await r.incrby(key, by);
    if (next === by) await r.expire(key, ttl);
    return next;
  }
  const hit = memory.get(key);
  const base = !hit || hit.expires < Date.now() ? 0 : hit.count;
  const next = base + by;
  memory.set(key, { count: next, expires: Date.now() + ttl * 1000 });
  return next;
}

function state(used: number): QuotaState {
  return {
    used,
    limit: FREE_DAILY_LIMIT,
    remaining: Math.max(0, FREE_DAILY_LIMIT - used),
    resetsAt: `${kstDay()} 24:00 KST`,
    bestEffort: getRedis() === null,
  };
}

export async function peekQuota(clientKey: string): Promise<QuotaState> {
  return state(await read(`shp:quota:${kstDay()}:${clientKey}`));
}

/** 호출 전 확인 — 남은 한도가 요청한 콜 수보다 적으면 거절 사유를 돌려준다. */
export async function reserveQuota(
  clientKey: string,
  calls: number,
): Promise<{ allowed: boolean; state: QuotaState }> {
  const used = await read(`shp:quota:${kstDay()}:${clientKey}`);
  const s = state(used);
  return { allowed: s.remaining >= calls, state: s };
}

/** 실제로 쓴 만큼만 차감한다 — 호출이 실패하면 부르지 않는다. */
export async function consumeQuota(clientKey: string, calls: number): Promise<QuotaState> {
  if (calls <= 0) return peekQuota(clientKey);
  const used = await bump(
    `shp:quota:${kstDay()}:${clientKey}`,
    calls,
    secondsUntilKstMidnight(),
  );
  return state(used);
}
