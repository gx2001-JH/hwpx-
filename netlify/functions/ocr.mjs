// 이미지에 있는 문제 텍스트+수식을 Gemini Vision으로 읽어 LaTeX 텍스트로 반환한다.
// 반환된 텍스트는 그대로 hwpx로 변환하지 않고, 사용자가 검토/수정할 수 있도록
// textarea에 채워 넣는 용도로만 쓴다 (OCR은 완벽하지 않으므로).

const PROMPT = `다음 이미지에 있는 수학 문제 텍스트를 그대로 옮겨 적어줘.

규칙:
- 수식 부분은 LaTeX 문법으로 작성하고 반드시 $...$ 로 감싸줘. 여러 줄에 걸치거나 별도 줄로 강조해야 하는 블록 수식은 $$...$$ 로 감싸줘.
- 수식이 아닌 일반 텍스트(문제 번호, 설명, 보기 등)는 이미지에 있는 그대로 옮기고, 문단/줄바꿈 구조도 최대한 유지해줘.
- 이미지에 없는 내용을 추가하거나 문제를 풀지 마. 오직 옮겨 적기만 해.
- 설명이나 코드블록 없이, 옮겨 적은 텍스트만 출력해줘.`;

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
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

  // 사용자가 자기 API 키를 등록했으면 그 키를 우선 쓰고, 없으면(관리자가 설정해둔 경우)
  // 서버 환경 변수로 폴백한다.
  const apiKey = (body.apiKey || "").trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "API 키가 없습니다. 상단의 'API 키 설정'에서 본인의 Gemini API 키를 등록해주세요." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64 || !mimeType) {
    return new Response(JSON.stringify({ error: "이미지 데이터가 없습니다." }), {
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
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
              ],
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
      return new Response(JSON.stringify({ error: "이미지에서 텍스트를 추출하지 못했습니다." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ text: text.trim() }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `OCR 처리 중 오류: ${e.message}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config = {
  path: "/ocr",
};
