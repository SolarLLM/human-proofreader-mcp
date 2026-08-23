/**
 * OG 이미지용 한글 폰트.
 *
 * ImageResponse에는 CJK 글리프가 없어서, 폰트를 주지 않으면 한글이 전부 두부(□)로
 * 나온다. Google Fonts의 `text=` 서브셋 기능으로 **실제로 그릴 글자만** 받아
 * 폰트 용량을 수십 KB로 줄인다. 전체 Noto Sans KR은 수 MB라 그대로는 못 쓴다.
 */

const cache = new Map<string, ArrayBuffer>();

export async function loadKoreanFont(
  text: string,
  weight: 400 | 700 | 900,
): Promise<ArrayBuffer | null> {
  const glyphs = [...new Set(text)].join("");
  const key = `${weight}:${glyphs}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const cssUrl =
    `https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}` +
    `&text=${encodeURIComponent(glyphs)}`;

  try {
    // User-Agent를 주지 않으면 구형 포맷(ttf) CSS가 오거나 woff2가 섞여 온다.
    // ImageResponse는 woff2를 못 읽으므로 ttf/otf를 받아야 한다.
    const css = await fetch(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SolarHumanProofreader/1.0)" },
    }).then((r) => r.text());

    const url = css.match(/src:\s*url\((https:[^)]+)\)\s*format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;

    const font = await fetch(url).then((r) => r.arrayBuffer());
    cache.set(key, font);
    return font;
  } catch {
    // 폰트를 못 받으면 이미지 생성을 포기하는 대신 라틴 문자로라도 그린다.
    return null;
  }
}
