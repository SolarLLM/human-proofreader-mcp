import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 상위 디렉터리의 lock 파일을 루트로 잡지 않게 고정한다.
  turbopack: { root: import.meta.dirname },
  // MCP 핸들러는 Node 런타임 전용(AsyncLocalStorage·crypto 사용).
  serverExternalPackages: ["@modelcontextprotocol/server"],
};

export default nextConfig;
