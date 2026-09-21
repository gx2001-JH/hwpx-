// 이미지에 있는 문제 텍스트+수식을 Gemini Vision으로 읽어 LaTeX 텍스트로 반환한다.
// 반환된 텍스트는 그대로 hwpx로 변환하지 않고, 사용자가 검토/수정할 수 있도록
// textarea에 채워 넣는 용도로만 쓴다 (OCR은 완벽하지 않으므로).

import { callGemini, errorMessageOf, serverApiKey } from "./geminiClient.mjs";

const PROMPT = `다음 이미지에 있는 수학 문제 텍스트를 그대로 옮겨 적어줘.

규칙:
- 수식 부분은 LaTeX 문법으로 작성하고 반드시 $...$ 로 감싸줘. 여러 줄에 걸치거나 별도 줄로 강조해야 하는 블록 수식은 $$...$$ 로 감싸줘.
- 점·선분·각·삼각형의 이름으로 쓰인 라틴 대문자와, 수학적인 값으로 쓰인 숫자·변수는 한 글자여도 예외 없이 $...$ 로 감싸줘.
  (예: "삼각형 ABC" -> "삼각형 $ABC$", "점 A를 중심으로" -> "점 $A$를 중심으로", "길이가 3" -> "길이가 $3$", "$2 : 1$로 내분")
  이렇게 감싼 것만 한글 수식으로 변환되면서 대문자 정자체(rm) 서식이 적용되므로, 맨 텍스트로 남겨두지 마.
- 다만 문제 번호("14.")나 배점("[4점]")처럼 수학적 값이 아닌 것은 감싸지 마.
- 선분·직선 위에 줄이 그어져 있으면 \\overline{AB} 로, 벡터 화살표는 \\vec{AB} 로 옮겨줘.
- 객관식 보기 번호는 이미지에 있는 그대로 ①, ②, ③, ④, ⑤ 기호를 써줘.
- 수식이 아닌 일반 텍스트(설명, 보기 등)는 이미지에 있는 그대로 옮기고, 문단/줄바꿈 구조도 최대한 유지해줘.
- 이미지에 없는 내용을 추가하거나 문제를 풀지 마. 오직 옮겨 적기만 해.
- 설명이나 코드블록 없이, 옮겨 적은 텍스트만 출력해줘.`;

export default async (req, ctx) => {
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
  const apiKey = (body.apiKey || "").trim() || serverApiKey(ctx);
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
    const requestBody = {
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: imageBase64 } },
          ],
        },
      ],
    };

    const result = await callGemini(apiKey, requestBody);

    if (!result || !result.ok) {
      return new Response(JSON.stringify({ error: errorMessageOf(result) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return new Response(JSON.stringify({ error: "이미지에서 텍스트를 추출하지 못했습니다." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 실제로 어떤 모델이 응답했는지 함께 돌려준다(문제 생길 때 원인 파악용).
    return new Response(JSON.stringify({ text: text.trim(), model: result.model }), {
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
