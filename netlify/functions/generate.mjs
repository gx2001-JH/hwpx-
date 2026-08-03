// 사용자 요청에 따라 수학 문제+해설을 새로 짓거나, 기존 문제(context)를 변형해
// LaTeX가 섞인 텍스트로 돌려준다. OCR과 마찬가지로 결과는 자동 변환되지 않고
// textarea에 채워져 사용자가 검토한 뒤 직접 변환하도록 한다.

function buildPrompt(instruction, context) {
  const contextBlock = context && context.trim()
    ? `\n다음은 참고할 기존 문제(스타일 참고용이거나 변형 대상)야:\n"""\n${context.trim()}\n"""\n`
    : "";

  return `너는 한국 수학 문제 출제 전문가야. 아래 사용자 요청에 따라 수학 문제와 해설을 작성해줘.

규칙:
- 수식은 반드시 LaTeX 문법으로 작성하고 $...$ 로 감싸줘 (여러 줄/블록 수식은 $$...$$).
- 문제 번호, 문제 본문, [해설] 형식을 갖춰서 작성해줘.
- 마크다운 문법(**굵게**, - 목록, # 제목 등)을 쓰지 말고 일반 텍스트로만 작성해줘.
- 설명이나 코드블록 없이, 문제와 해설 텍스트만 출력해줘.
${contextBlock}
사용자 요청: ${instruction}`;
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다. Netlify 환경 변수를 확인해주세요." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "잘못된 요청입니다." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const instruction = (body.instruction || "").trim();
  const context = body.context || "";
  if (!instruction) {
    return new Response(JSON.stringify({ error: "생성/변형 요청 내용을 입력해주세요." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildPrompt(instruction, context) }],
            },
          ],
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error?.message || `Gemini API 오류 (${res.status})`;
      return new Response(JSON.stringify({ error: msg }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: "문제를 생성하지 못했습니다." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ text: text.trim() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `생성 처리 중 오류: ${e.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/generate",
};
