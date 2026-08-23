import { EXAMPLES } from "./examples";
import { getBaseUrl, SERVER_NAME } from "@/lib/site";

const TOOLS: Array<[string, string, string]> = [
  ["proofread", "원고를 통독하고 교정본을 돌려준다. 이 서버의 본체.", "1~3콜"],
  ["read_through", "고치지 않고, 왜 안 읽히는지 소견만 준다.", "1콜"],
  ["readability", "문장 길이·번역투·피동·리듬을 0~100점으로 잰다.", "무료"],
  ["compare", "원본과 교정본을 대조해 사실·인용·문체 훼손을 잡는다.", "무료"],
  ["suggest", "한 대목을 결이 다른 여러 안으로 다시 써 준다.", "1콜"],
  ["usage", "오늘 남은 무료 한도를 확인한다.", "무료"],
];

const STEPS: Array<[string, string, string]> = [
  ["1. 통독", "코드", "문장 길이 분포, 만연체, 번역투·피동·상투구를 먼저 센다. 모델에게 세라고 시키지 않는다."],
  ["2. 소견", "Solar", "수치가 못 보는 것을 읽는다 — 끊긴 논지, 겹치는 문단, 죽은 리듬."],
  ["3. 교정", "Solar", "소견에서 짚은 자리만 겨냥해 손본다. 고칠 이유를 한 줄로 못 대면 손대지 않는다."],
  ["4. 대조", "코드", "원본 옆에 놓고 맞춰 본다. 없던 수치·문장, 바뀐 인용, 뒤집힌 말투를 잡는다."],
  ["5. 보정", "Solar", "대조에서 걸린 자리만 국소 수정. 전체를 다시 쓰지 않는다."],
];

const C = {
  ink: "#1a1a1a",
  muted: "#525252",
  faint: "#737373",
  line: "#e5e5e5",
  paper: "#fafaf9",
  accent: "#c2410c",
};

export default async function Home() {
  // 자리표시자 URL을 보여 주면 이 페이지를 AI에게 넘겨도 설치가 안 된다.
  // 배포본이 자기 주소를 알고 스니펫에 박아야 "이 링크 붙여 줘"가 한 번에 끝난다.
  const base = await getBaseUrl();
  const endpoint = `${base}/api/mcp`;

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "64px 24px 96px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif",
        lineHeight: 1.75,
        color: C.ink,
      }}
    >
      <p style={{ color: C.accent, fontWeight: 600, letterSpacing: "0.02em", margin: 0 }}>
        Solar Human Proofreader
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.25, margin: "12px 0 8px", letterSpacing: "-0.02em" }}>
        사람 편집자가 빨간 펜으로
        <br />
        손본 원고를 돌려드립니다.
      </h1>
      <p style={{ fontSize: 18, color: C.muted, marginTop: 0 }}>
        한국어 원고를 읽기 쉽게 교정하는 MCP 서버입니다.{" "}
        <a
          href="https://www.upstage.ai"
          target="_blank"
          rel="noreferrer"
          style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 }}
        >
          Upstage <strong>Solar Pro 4</strong>
        </a>
        가 문장을 손보고, 사실·인용·말투가 그대로인지는 코드가 판정합니다. 내용은 더하지도 빼지도
        않습니다.
      </p>

      {/* ── 연결하기 ─────────────────────────────────────────────── */}
      <Section title="MCP 연결하기">
        <p style={{ fontSize: 15, color: C.muted, marginTop: 0 }}>
          설치할 것도, 키를 발급받을 것도 없습니다. 클라이언트 설정에 URL 한 줄을 넣으면 끝입니다.
        </p>

        <Step n={1} title="설정 파일에 서버를 추가합니다">
          <Code>{`{
  "mcpServers": {
    "${SERVER_NAME}": {
      "url": "${endpoint}"
    }
  }
}`}</Code>
          <p style={{ fontSize: 14, color: C.faint, margin: "8px 0 0" }}>
            Claude Code는 <Mono>~/.claude.json</Mono>, Cursor는 <Mono>~/.cursor/mcp.json</Mono>입니다.
            Claude Code에서는 명령 한 줄로도 됩니다.
          </p>
          <div style={{ marginTop: 8 }}>
            <Code>{`claude mcp add --transport http ${SERVER_NAME} ${endpoint}`}</Code>
          </div>
        </Step>

        <Step n={2} title="클라이언트를 다시 시작하고 그냥 말합니다">
          <Quote>
            이 글 좀 읽기 쉽게 다듬어 줘 <span style={{ color: C.faint }}>(원고를 붙여넣고)</span>
          </Quote>
          <p style={{ fontSize: 14, color: C.faint, margin: "8px 0 0" }}>
            도구 이름을 외울 필요는 없습니다. 다듬어 달라면 <Mono>proofread</Mono>,
            고치지 말고 문제만 짚어 달라면 <Mono>read_through</Mono>가 자동으로 불립니다.
          </p>
        </Step>

        <Step n={3} title="하루 100콜을 넘겨 쓸 때만 본인 키를 답니다">
          <Code>{`{
  "mcpServers": {
    "${SERVER_NAME}": {
      "url": "${endpoint}",
      "headers": { "X-Upstage-Api-Key": "up_..." }
    }
  }
}`}</Code>
          <p style={{ fontSize: 14, color: C.faint, margin: "8px 0 0" }}>
            <Mono>X-Upstage-Api-Key</Mono> 또는 <Mono>X-OpenRouter-Api-Key</Mono>. 본인 키로 붙으면
            한도가 없습니다. 키를 도구 인자가 아니라 헤더로 받는 이유는, 인자로 받으면 키가 대화
            기록에 평문으로 남기 때문입니다.
          </p>
        </Step>

        <p style={{ fontSize: 14, color: C.faint }}>
          stdio만 지원하는 클라이언트는 <Mono>npx -y mcp-remote {endpoint}</Mono>를 씁니다.
        </p>
      </Section>

      {/* ── Before / After ───────────────────────────────────────── */}
      <Section title="붙이기 전과 후">
        <p style={{ fontSize: 15, color: C.muted, marginTop: 0 }}>
          아래는 전부 이 서버에 실제로 돌린 결과입니다. 점수와 변경률도 서버가 뱉은 값 그대로고,
          손으로 고치지 않았습니다.
        </p>
        {EXAMPLES.map((ex) => (
          <article
            key={ex.label}
            style={{
              border: `1px solid ${C.line}`,
              borderRadius: 10,
              padding: "18px 20px",
              marginTop: 20,
            }}
          >
            <header
              style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}
            >
              <strong style={{ fontSize: 16 }}>{ex.label}</strong>
              <Tag tone="slate">{ex.register}</Tag>
              <span style={{ marginLeft: "auto", fontSize: 13.5, color: C.faint }}>
                가독성{" "}
                <strong style={{ color: C.muted }}>{ex.scoreBefore}</strong> →{" "}
                <strong style={{ color: C.accent }}>{ex.scoreAfter}</strong> · 변경률{" "}
                {ex.changeRate}%
              </span>
            </header>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 16,
                marginTop: 14,
              }}
            >
              <Panel title="없이 — 원고 그대로" tone="plain">
                {ex.before}
              </Panel>
              <Panel title="붙이고 — 교정본" tone="accent">
                {ex.after}
              </Panel>
            </div>

            <p style={{ fontSize: 13.5, color: C.faint, margin: "12px 0 0" }}>{ex.note}</p>
          </article>
        ))}
      </Section>

      {/* ── 작업 순서 ────────────────────────────────────────────── */}
      <Section title="편집자의 작업 순서를 그대로">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <tbody>
            {STEPS.map(([step, who, what]) => (
              <tr key={step} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "10px 12px 10px 0", whiteSpace: "nowrap", fontWeight: 600 }}>
                  {step}
                </td>
                <td style={{ padding: "10px 12px 10px 0", whiteSpace: "nowrap" }}>
                  <Tag tone={who === "코드" ? "slate" : "orange"}>{who}</Tag>
                </td>
                <td style={{ padding: "10px 0", color: C.muted }}>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 14, color: C.faint }}>
          모델에게 “네가 얼마나 고쳤는지 말해봐”라고 묻지 않습니다. 자기가 방금 쓴 글을 자기가
          채점하면 언제나 후하기 때문입니다. 변경률·수치 보존·인용 대조·말투 판정은 전부 코드가
          셉니다. 원본에 없던 문장이 하나라도 생기면 그 교정본은 <strong>채택 불가</strong>입니다.
        </p>
      </Section>

      {/* ── 도구 ────────────────────────────────────────────────── */}
      <Section title="도구">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
          <tbody>
            {TOOLS.map(([name, desc, cost]) => (
              <tr key={name} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "10px 12px 10px 0", whiteSpace: "nowrap" }}>
                  <Mono>{name}</Mono>
                </td>
                <td style={{ padding: "10px 12px 10px 0", color: C.muted }}>{desc}</td>
                <td style={{ padding: "10px 0", whiteSpace: "nowrap" }}>
                  <Tag tone={cost === "무료" ? "green" : "slate"}>{cost}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 14, color: C.faint }}>
          무료 한도는 <strong>Solar 호출 1회 단위</strong>로 셉니다 (KST 자정 초기화). 통독 1회 +
          교정 1회면 2회입니다. <Mono>readability</Mono>와 <Mono>compare</Mono>는 Solar를 부르지
          않아 차감되지 않습니다.
        </p>
      </Section>

      {/* ── AI에게 넘기기 ────────────────────────────────────────── */}
      <Section title="AI에게 이 페이지를 넘기면 설치까지 끝납니다">
        <p style={{ fontSize: 15, color: C.muted, marginTop: 0 }}>
          쓰시는 AI 코딩 도구에 아래 한 줄만 던지세요. 이 페이지에 설치에 필요한 정보가
          전부 들어 있고, 기계가 읽기 좋은 형태로도 함께 제공합니다.
        </p>
        <Quote>
          {`이 MCP 서버 설치해 줘 — ${base}`}
        </Quote>

        <div style={{ marginTop: 18 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 15.5 }}>
            AI가 참고하는 것
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14.5 }}>
            <tbody>
              <tr style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "9px 12px 9px 0", whiteSpace: "nowrap" }}>
                  <Mono>/llms.txt</Mono>
                </td>
                <td style={{ padding: "9px 0", color: C.muted }}>
                  클라이언트별 설치 명령, 도구 목록, 무료 한도·BYOK 규칙, 결과를 사용자에게
                  전달하는 방법까지 담은 산문 안내서.
                </td>
              </tr>
              <tr style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: "9px 12px 9px 0", whiteSpace: "nowrap" }}>
                  <Mono>/mcp.json</Mono>
                </td>
                <td style={{ padding: "9px 0", color: C.muted }}>
                  같은 내용을 구조화한 매니페스트. 설정에 바로 꽂을 수 있는 완성형 조각이
                  클라이언트별로 들어 있습니다.
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 14, color: C.faint, marginTop: 14 }}>
          두 파일에는 이 서버의 주소(<Mono>{endpoint}</Mono>)와 설치 명령이 실제 값으로 들어
          있습니다. AI가 따로 물어볼 것도, 추측할 것도 없습니다.
        </p>
      </Section>

      <hr style={{ border: 0, borderTop: `1px solid ${C.line}`, margin: "56px 0 20px" }} />

      <p style={{ fontSize: 13.5, color: C.faint, margin: 0 }}>
        한국어 글의 “AI 티”를 알아보는 문제의식과 문체 분류 체계는{" "}
        <a
          href="https://github.com/epoko77-ai/im-not-ai"
          style={{ color: C.muted }}
          target="_blank"
          rel="noreferrer"
        >
          epoko77-ai/im-not-ai
        </a>
        에서 가져왔습니다. 코드는 가져오지 않고 새로 썼습니다. 이 서버는 “AI 티 제거”가 아니라
        “읽기 쉬운 글”에 초점을 맞춘 별개의 설계입니다.
      </p>

      <p style={{ marginTop: 20, fontSize: 13, color: "#a3a3a3" }}>
        Solar Pro 4 · 524K 컨텍스트 · 한국어 원어민 감각. 긴 원고도 쪼개지 않고 한 번에 읽습니다.
        <br />
        <a href="/llms.txt" style={{ color: C.faint }}>
          llms.txt
        </a>{" · "}
        <a href="/mcp.json" style={{ color: C.faint }}>
          mcp.json
        </a>{" · "}
        <a href="https://github.com/SolarLLM/human-proofreader-mcp" style={{ color: C.faint }}>
          GitHub
        </a>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 52 }}>
      <h2 style={{ fontSize: 21, margin: "0 0 14px", letterSpacing: "-0.01em" }}>{title}</h2>
      {children}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 18 }}>
      <div
        style={{
          flex: "0 0 26px",
          height: 26,
          borderRadius: "50%",
          background: C.accent,
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 3,
        }}
      >
        {n}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 15.5 }}>{title}</p>
        {children}
      </div>
    </div>
  );
}

function Panel({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "plain" | "accent";
  children: string;
}) {
  const accent = tone === "accent";
  return (
    <div
      style={{
        background: accent ? "#fffbf7" : C.paper,
        border: `1px solid ${accent ? "#fed7aa" : C.line}`,
        borderRadius: 8,
        padding: "12px 14px",
        minWidth: 0,
      }}
    >
      <p
        style={{
          margin: "0 0 8px",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.03em",
          color: accent ? C.accent : C.faint,
        }}
      >
        {title}
      </p>
      <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
        {children}
      </p>
    </div>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        padding: "10px 14px",
        background: C.paper,
        borderLeft: `3px solid ${C.accent}`,
        borderRadius: 4,
        fontSize: 15,
      }}
    >
      {children}
    </p>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: C.paper,
        border: `1px solid #e7e5e4`,
        borderRadius: 8,
        padding: "14px 16px",
        overflowX: "auto",
        fontSize: 13.5,
        lineHeight: 1.6,
        margin: 0,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {children}
    </pre>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code
      style={{
        background: "#f5f5f4",
        borderRadius: 4,
        padding: "1px 5px",
        fontSize: "0.92em",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      {children}
    </code>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "green" | "slate" | "orange" }) {
  const colors = {
    green: { bg: "#ecfdf5", fg: "#047857" },
    slate: { bg: "#f1f5f9", fg: "#475569" },
    orange: { bg: "#fff7ed", fg: C.accent },
  }[tone];
  return (
    <span
      style={{
        background: colors.bg,
        color: colors.fg,
        borderRadius: 999,
        padding: "2px 9px",
        fontSize: 12.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
