// 사용자 요청에 따라 수학 문제+해설을 새로 짓거나, 기존 문제(context)를 변형해
// 대한민국 수능 스타일의 LaTeX 텍스트로 돌려준다. 여러 문제를 요청하면 각각을
// problems 배열의 개별 원소로 나눠서 반환한다(프런트엔드에서 박스 하나씩으로 표시).
// OCR과 마찬가지로 결과는 자동 변환되지 않고 사용자가 검토한 뒤 직접 변환하도록 한다.

const TYPE_INSTRUCTIONS = {
  객관식: "문제 유형은 객관식으로 작성해줘. 보기는 ①, ②, ③, ④, ⑤ 기호를 사용하고, [해설] 마지막에 정답 번호를 명시해줘.",
  단답형: "문제 유형은 단답형으로 작성해줘. 정수이거나 간단한 형태의 값이 답으로 나오도록 하고, 문제 끝을 '...값을 구하시오.' 형식으로 마무리해줘.",
  서술형: "문제 유형은 서술형으로 작성해줘. 최종 답만이 아니라 풀이 과정을 요구하는 형식으로 작성하고, [해설]에 전체 풀이 과정을 단계별로 자세히 서술해줘.",
};

function buildPrompt(instruction, context, type) {
  const contextBlock = context && context.trim()
    ? `\n다음은 참고할 기존 문제(스타일 참고용이거나 변형 대상)야:\n"""\n${context.trim()}\n"""\n`
    : "";
  const typeBlock = TYPE_INSTRUCTIONS[type] ? `\n${TYPE_INSTRUCTIONS[type]}\n` : "";

  return `너는 대한민국 수능(대학수학능력시험)/모의고사 스타일 수학 문제를 출제하는 전문가야.
아래 사용자 요청에 따라 수학 문제와 해설을 작성해줘.

형식 규칙:
- 수식은 반드시 LaTeX 문법으로 작성하고 $...$ 로 감싸줘 (여러 줄/블록 수식은 $$...$$).
- 마크다운 문법(**굵게**, - 목록, # 제목 등)을 쓰지 말고 일반 텍스트로만 작성해줘.
- 각 문제는 문제 본문 다음 줄에 "[해설]"로 시작하는 해설을 붙여줘.
- 대한민국 수능/모의고사에서 실제로 쓰이는 어휘와 문장 형식을 따라줘 (예: "다음 중 옳은 것은?",
  "...의 값을 구하시오.", "...을 만족시키는 모든 ...의 값의 합은?" 등).
- 여러 문제를 요청받으면 하나로 합치지 말고 problems 배열의 개별 원소로 나눠서 작성해줘.
${typeBlock}${contextBlock}
사용자 요청: ${instruction}

반드시 다음 JSON 형식으로만 응답해: {"problems": ["문제1 전체 텍스트(문제+[해설])", "문제2 전체 텍스트", ...]}`;
}

function stripCodeFence(text) {
  const m = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m ? m[1] : text;
}

function parseProblems(text) {
  try {
    const parsed = JSON.parse(stripCodeFence(text));
    if (Array.isArray(parsed.problems) && parsed.problems.length) {
      return parsed.problems.map((p) => String(p).trim()).filter(Boolean);
    }
  } catch {
    // JSON 파싱 실패 시 아래에서 원문 그대로 폴백
  }
  return text.trim() ? [text.trim()] : [];
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
  const type = body.type || "";
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
          contents: [{ parts: [{ text: buildPrompt(instruction, context, type) }] }],
          generationConfig: { responseMimeType: "application/json" },
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
    const problems = text ? parseProblems(text) : [];
    if (!problems.length) {
      return new Response(JSON.stringify({ error: "문제를 생성하지 못했습니다." }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ problems }), {
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
