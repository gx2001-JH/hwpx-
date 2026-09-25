// /script — 텍스트 안의 수식을 한/글 수식편집기 문법으로 바꿔 돌려준다.
//
// hwpx 파일을 만들지 않고 문법만 보고 싶을 때가 있다. 이미 만든 문서에 수식 하나만
// 끼워 넣을 때가 그렇다: 한/글에서 Ctrl+N,M 으로 수식 편집기를 열고 여기서 복사한
// 문법을 그대로 붙여 넣으면 된다.
//
// 변환 로직은 /convert 와 한 줄도 나누지 않는다 — 같은 converter.mjs·hwpxBuilder.mjs 를
// 부른다. 여기서 하는 일은 수식 자리를 찾아 하나씩 변환해 늘어놓는 것뿐이다.
import { splitSegments } from "./hwpxBuilder.mjs";
import { latexToHwp } from "./converter.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const params = new URLSearchParams(await req.text());
  const text = params.get("text") || "";

  if (!text.trim()) {
    return new Response(JSON.stringify({ error: "변환할 텍스트를 입력해주세요." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const items = [];
    for (const [isMath, body] of splitSegments(text)) {
      if (!isMath) continue;
      const script = latexToHwp(body);
      if (script) items.push({ latex: body.trim(), script });
    }
    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `변환 중 오류가 발생했습니다: ${e.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/script",
};
