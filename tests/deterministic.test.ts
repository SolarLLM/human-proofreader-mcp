/**
 * 결정적 계층(LLM 없는 부분)의 회귀 테스트.
 * 여기가 무너지면 게이트가 조용히 통과해 버리므로, 판정이 뒤집히는 경계만 고정한다.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { analyze, recommendDepth } from "../lib/readability";
import { checkFidelity } from "../lib/fidelity";
import { parsePolished, POLISHED_MARK, NOTES_MARK } from "../lib/prompts";
import { kstDay, secondsUntilKstMidnight } from "../lib/quota";

const CLEAN = `봄이 왔다. 마당의 목련이 먼저 피었다.
아이는 그 앞에 한참 서 있었다. 나는 사진을 몇 장 찍었다.
꽃은 사흘 만에 졌고, 아이는 그 사실을 오래 기억했다.`;

const TANGLED = `이번 프로젝트에 대해 논의함에 있어서 중요한 것은, 우리가 가지고 있는 리소스를 통해 어떠한 방식으로 목표를 달성할 수 있을 것인가에 대한 전략적 접근이 요구된다는 점이며, 이는 조직의 구조적 특수성에 기반하여 판단되어져야 할 사안이라고 볼 수 있다. 또한 이러한 관점에서 볼 때, 각 팀에 의해 수행되는 업무의 효율성 제고를 위해 필요한 것은 혁신적인 접근이라고 할 수 있으며, 이는 시사하는 바가 크다고 판단된다. 따라서 결론적으로 지금이야말로 우리가 변화를 모색해야 할 때이다.`;

test("잘 읽히는 글은 높은 점수를 받는다", () => {
  const r = analyze(CLEAN);
  assert.ok(r.score >= 85, `기대 >=85, 실제 ${r.score}`);
  assert.equal(r.grade, "A");
  assert.equal(recommendDepth(r), "light");
});

test("만연체·번역투 글은 낮은 점수와 구체적 지적을 받는다", () => {
  const r = analyze(TANGLED);
  assert.ok(r.score < 70, `기대 <70, 실제 ${r.score}`);
  assert.ok(r.friction.translationese >= 3, "번역투를 잡아야 한다");
  assert.ok(r.friction.passive >= 1, "이중 피동을 잡아야 한다");
  assert.ok(r.friction.cliche >= 1, "상투구를 잡아야 한다");
  assert.ok(r.hardSentences.length >= 1, "빨간 줄 그을 문장이 나와야 한다");
  assert.ok(r.notes.length >= 1);
});

test("같은 글은 항상 같은 점수를 받는다", () => {
  assert.equal(analyze(TANGLED).score, analyze(TANGLED).score);
});

test("손대지 않은 원고는 대조에서 ok", () => {
  const f = checkFidelity({ before: CLEAN, after: CLEAN });
  assert.equal(f.verdict, "ok");
  assert.equal(f.changeRate, 0);
});

test("없던 수치가 생기면 채택 불가", () => {
  const f = checkFidelity({
    before: "매출이 늘었다.",
    after: "매출이 32% 늘었다.",
  });
  assert.equal(f.verdict, "abort");
  assert.ok(f.issues.some((i) => i.code === "number_injected"));
});

test("직접 인용이 바뀌면 채택 불가", () => {
  const f = checkFidelity({
    before: '그는 "천천히 가도 괜찮다"고 말했다.',
    after: '그는 "느리게 가도 된다"고 말했다.',
  });
  assert.equal(f.verdict, "abort");
  assert.ok(f.issues.some((i) => i.code === "quote_altered"));
});

test("보존 지정 문장이 사라지면 채택 불가", () => {
  const f = checkFidelity({
    before: "첫 문장이다.\n\n우리는 끝까지 간다.",
    after: "첫 문장입니다.\n\n우리는 계속 갑니다.",
    preserve: ["우리는 끝까지 간다."],
  });
  assert.ok(f.issues.some((i) => i.code === "preserve_broken"));
});

test("전면 재작성은 과교정으로 중단된다", () => {
  const f = checkFidelity({
    before: TANGLED,
    after: "전략을 다시 짜야 한다. 팀마다 사정이 다르다. 지금이 그 시점이다.",
  });
  assert.equal(f.verdict, "abort");
  assert.ok(f.issues.some((i) => i.code === "over_edited"));
});

test("격식 상향은 경고로 잡힌다", () => {
  const f = checkFidelity({
    before: "그렇게 했다. 결과가 좋았다. 팀이 애썼다. 다음에도 그렇게 한다.",
    after: "그렇게 하였다. 결과가 좋았다. 팀이 애썼다. 다음에도 그렇게 한다.",
  });
  assert.equal(f.verdict, "warn");
  assert.ok(f.issues.some((i) => i.code === "register_raised"));
});

test("델리미터를 지킨 응답을 본문과 노트로 가른다", () => {
  const { text, notes } = parsePolished(
    `${POLISHED_MARK}\n다듬은 본문이다.\n두 번째 줄.\n${NOTES_MARK}\n- 가지고 있다 → 강하다 :: 번역투`,
  );
  assert.equal(text, "다듬은 본문이다.\n두 번째 줄.");
  assert.deepEqual(notes, ["가지고 있다 → 강하다 :: 번역투"]);
});

test("델리미터를 어긴 응답도 본문을 잃지 않는다", () => {
  const { text, notes } = parsePolished("그냥 본문만 돌려줬다.");
  assert.equal(text, "그냥 본문만 돌려줬다.");
  assert.deepEqual(notes, []);
});

test("하루 경계는 KST 자정", () => {
  // 2026-08-23T15:30Z = 2026-08-24 00:30 KST → 이미 다음 날이다.
  assert.equal(kstDay(new Date("2026-08-23T15:30:00Z")), "2026-08-24");
  assert.equal(kstDay(new Date("2026-08-23T14:30:00Z")), "2026-08-23");
  assert.ok(secondsUntilKstMidnight(new Date("2026-08-23T14:00:00Z")) <= 3600);
});

test("변경률은 문자 기준이다 — 어절 기준의 절반쯤 나온다", () => {
  const before =
    "최근 많은 기업들에 있어서 AI 도입은 더 이상 선택이 아닌 필수적인 사안으로 인식되고 있으며, 이는 조직의 경쟁력 확보라는 측면에서 매우 중요한 의미를 가지고 있다고 볼 수 있다.";
  const after =
    "최근 많은 기업에 AI는 더 이상 선택이 아닌 필수다. 조직의 경쟁력을 확보하는 측면에서도 중요하다.";
  const f = checkFidelity({ before, after });
  assert.ok(f.changeRate < f.eojeolChangeRate, "문자 기준이 어절 기준보다 낮아야 한다");
  assert.ok(f.changeRate < 0.5, `정상적인 교정이 중단 판정을 받으면 안 된다 (${f.changeRate})`);
});

test("문장을 쪼개고 붙이는 것은 과교정이 아니다", () => {
  // 좋은 한국어 교정은 긴 문장을 쪼갠다. 문장을 1:1로 맞추는 방식이면 이게
  // 전부 '대응 실패'로 잡혀 정상 교정이 재작성으로 오판된다.
  const before = "이번 분기의 매출은 전년 대비 12% 증가하였는데, 이는 신규 채널의 기여가 컸기 때문이며, 특히 해외 비중이 처음으로 30%를 넘어섰다는 점에서 의미가 있다.";
  const after = "이번 분기 매출은 전년보다 12% 늘었다. 신규 채널이 컸다. 해외 비중은 처음으로 30%를 넘었다.";
  const f = checkFidelity({ before, after });
  assert.ok(f.changeRate < 0.5, `문장 분리가 중단 판정을 받으면 안 된다 (${f.changeRate})`);
  assert.notEqual(f.verdict, "abort");
});

test("완전히 다른 글은 0.65~0.70 부근이 바닥이다", () => {
  // 한국어는 조사·어미 음절이 겹쳐서, 내용이 전혀 달라도 문자 변경률이
  // 1.0까지 가지 않는다. 중단 임계 0.50은 이 바닥값(≈0.68)보다 낮고
  // 정상적인 강한 교정(0.25~0.45)보다는 높게 잡은 것이다.
  const f = checkFidelity({
    before: "봄이 왔다. 마당의 목련이 먼저 피었다.",
    after: "회의는 목요일로 미뤘다. 자료는 수요일까지 보낸다.",
  });
  assert.ok(f.changeRate > 0.6, `기대 >0.6, 실제 ${f.changeRate}`);
  assert.equal(f.verdict, "abort");
});

test("한 문단을 여러 문단으로 나눠도 과교정이 아니다", () => {
  // 실측 사고: 문단 단위로 1:1 대응시키던 구현이 이 경우를 75%로 읽어
  // 정상 교정을 채택 불가로 막았다. 실제 값은 27%다.
  const before =
    "당사는 고객 여러분께 보다 향상된 서비스를 제공해 드리기 위한 목적으로 개인정보 처리방침의 일부 내용에 대한 개정을 진행하게 되었음을 안내해 드리고자 하며, 이와 관련하여 변경되는 사항에 대해서는 아래의 내용을 참고해 주시기 바랍니다. 이번 개정에 있어서 가장 중요한 변경 사항은 마케팅 정보 수신 동의와 관련된 부분으로서, 기존에는 서비스 가입 시 일괄적으로 동의를 받는 방식이 채택되어 왔으나, 앞으로는 항목별로 개별 동의를 받는 방식으로 변경될 예정입니다.";
  const after =
    "당사는 개인정보 처리방침의 일부 내용을 개정합니다. 고객 여러분께 보다 향상된 서비스를 제공하기 위한 조치입니다. 변경되는 사항은 아래 내용을 참고해 주시기 바랍니다.\n\n이번 개정에서 가장 중요한 변경 사항은 마케팅 정보 수신 동의입니다. 기존에는 서비스 가입 시 일괄적으로 동의를 받았으나, 앞으로는 항목별로 개별 동의를 받는 방식으로 변경됩니다.";
  const f = checkFidelity({ before, after });
  assert.ok(f.changeRate < 0.4, `기대 <0.4, 실제 ${f.changeRate}`);
  assert.notEqual(f.verdict, "abort");
});

test("2만 자 원고도 제때 판정한다", () => {
  const unit = "이번 분기의 매출은 전년 대비 12% 증가하였는데, 이는 신규 채널의 기여가 컸기 때문이다.\n\n";
  const before = unit.repeat(150);
  const after = "이번 분기 매출은 전년보다 12% 늘었다. 신규 채널이 컸다.\n\n".repeat(150);
  const started = Date.now();
  const f = checkFidelity({ before, after });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `대조가 ${elapsed}ms 걸렸습니다 — 너무 느립니다`);
  assert.ok(f.changeRate > 0 && f.changeRate < 1);
});

test("한다체를 합쇼체로 올리면 채택 불가", () => {
  const f = checkFidelity({
    before: "봄이 왔다. 목련이 먼저 피었다. 아이는 그 앞에 오래 서 있었다. 꽃은 사흘 만에 졌다.",
    after: "봄이 왔습니다. 목련이 먼저 피었습니다. 아이는 그 앞에 오래 서 있었습니다. 꽃은 사흘 만에 졌습니다.",
  });
  assert.equal(f.verdict, "abort");
  assert.ok(f.issues.some((i) => i.code === "register_switched"));
});

test("같은 문체 안에서 다듬는 것은 통과한다", () => {
  const f = checkFidelity({
    before: "봄이 왔다. 목련이 먼저 피었다. 아이는 그 앞에 한참을 서 있었다. 꽃은 사흘 만에 졌다.",
    after: "봄이 왔다. 목련이 먼저 피었다. 아이는 그 앞에 오래 서 있었다. 꽃은 사흘 만에 졌다.",
  });
  assert.ok(!f.issues.some((i) => i.code === "register_switched"));
});

test("긴 표현을 짧게 압축한 것은 상투구 주입이 아니다", () => {
  // "매우 중요한 의미를 가지고 있다고 볼 수 있다" → "의미가 크다"는 정상 압축이다.
  // 이걸 위반으로 잡으면 게이트가 양치기 소년이 된다.
  const f = checkFidelity({
    before: "이 변화는 매우 중요한 의미를 가지고 있다고 볼 수 있다. 팀이 애썼다. 결과도 좋았다.",
    after: "이 변화는 의미가 크다. 팀이 애썼다. 결과도 좋았다.",
  });
  assert.ok(!f.issues.some((i) => i.code === "cliche_injected"));
});

test("없던 칭찬을 덧붙이면 상투구 주입으로 잡힌다", () => {
  // 상투구 가드와 내용 주입 검사가 같은 자리를 서로 다른 각도에서 잡는다.
  const f = checkFidelity({
    before: "매출은 늘었다. 팀이 애썼다. 다음 분기도 같은 방식으로 간다.",
    after: "매출은 늘었다. 팀이 괄목할 만한 성과로 크게 기여했다. 다음 분기도 같은 방식으로 간다.",
  });
  assert.ok(f.issues.some((i) => i.code === "cliche_injected"));
  assert.equal(f.verdict, "abort");
});

test("원고에 없던 문장을 지어 붙이면 채택 불가", () => {
  // 실측 사고: 앞뒤를 압축한 덕에 분량은 +1%였고 수치·인용도 멀쩡해서
  // 다른 검사가 전부 통과했다. 내용어가 원고에 있었는지를 봐야 잡힌다.
  const before =
    "오늘은 최근에 써 본 노트 앱을 이야기해 보려고 합니다. 대부분의 앱은 기능이 너무 많아 오히려 복잡했습니다. 이 앱은 검색이 빠르고 동기화도 우수합니다.";
  const after =
    "오늘은 최근에 써 본 노트 앱을 이야기해 보려고 합니다. 대부분의 앱은 기능이 너무 많아 오히려 복잡했습니다. 이 앱은 검색이 빠르고 동기화도 우수합니다. 구독자 여러분의 소중한 의견을 댓글로 남겨 주시면 다음 연재에 반영하겠습니다.";
  const f = checkFidelity({ before, after });
  assert.equal(f.verdict, "abort");
  assert.ok(f.issues.some((i) => i.code === "content_injected"));
});

test("문장을 크게 다시 써도 주입으로 오인하지 않는다", () => {
  // 다시 쓴 문장은 원고의 명사를 그대로 쓴다. 지어낸 문장만 새 명사를 데려온다.
  const before =
    "기존 연구들에 있어서는 모델의 파라미터 수를 증가시키는 것을 통해 성능 개선을 도모하는 방식이 주로 채택되어 왔다.";
  const after =
    "기존 연구는 주로 모델 파라미터 수를 늘려 성능을 높이는 방식을 채택해 왔다.";
  const f = checkFidelity({ before, after });
  assert.ok(!f.issues.some((i) => i.code === "content_injected"));
});
