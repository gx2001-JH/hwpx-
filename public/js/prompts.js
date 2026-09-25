// prompts.js — AI 에게 줄 지시문과 응답 파싱.
// 서버 함수(netlify/functions)에 있던 것을 브라우저로 그대로 옮겼다.
// 이제 세 회사 중 어느 것을 쓰든 같은 지시문을 쓴다.

export const OCR_PROMPT = `다음 이미지에 있는 수학 문제 텍스트를 그대로 옮겨 적어줘.

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

const TYPE_INSTRUCTIONS = {
  객관식: "문제 유형은 객관식으로 작성해줘. 보기는 ①, ②, ③, ④, ⑤ 기호를 사용하고, [해설] 마지막에 정답 번호를 명시해줘.",
  단답형: "문제 유형은 단답형으로 작성해줘. 정수이거나 간단한 형태의 값이 답으로 나오도록 하고, 문제 끝을 '...값을 구하시오.' 형식으로 마무리해줘.",
  서술형: "문제 유형은 서술형으로 작성해줘. 최종 답만이 아니라 풀이 과정을 요구하는 형식으로 작성하고, [해설]에 전체 풀이 과정을 단계별로 자세히 서술해줘.",
};

export function buildGeneratePrompt(instruction, context, type) {
  const contextBlock = context && context.trim()
    ? `\n다음은 참고할 기존 문제(스타일 참고용이거나 변형 대상)야:\n"""\n${context.trim()}\n"""\n`
    : "";
  const typeBlock = TYPE_INSTRUCTIONS[type] ? `\n${TYPE_INSTRUCTIONS[type]}\n` : "";

  return `너는 대한민국 수능(대학수학능력시험)/모의고사 스타일 수학 문제를 출제하는 전문가야.
아래 사용자 요청에 따라 수학 문제와 해설을 작성해줘.

형식 규칙:
- 수식은 반드시 LaTeX 문법으로 작성하고 $...$ 로 감싸줘 (여러 줄/블록 수식은 $$...$$). 문장 중간에
  단독으로 나오는 숫자나 변수 하나(예: 답이 "5이다"라고 쓸 때의 5)도 예외 없이 $5$처럼 LaTeX로
  감싸줘 — 감싸지 않은 일반 텍스트 숫자로 남겨두지 마.
- 객관식 보기 번호는 항상 ①, ②, ③, ④, ⑤ 기호만 사용해. "(1)", "(2)", "1)", "1." 같은 형태는
  절대 쓰지 마 (문제 유형을 명시적으로 지정받지 않고 네가 알아서 객관식으로 판단해 만드는
  경우에도 반드시 지켜야 하는 규칙이야).
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

// 가끔 모델이 problems 배열의 원소 하나에 {"problems": [...]} JSON 문자열
// 전체를 그대로 한 번 더 넣어버린다(자기 자신이 출력해야 할 형식 설명을
// 내용으로 착각하는 경우). 그 결과가 그대로 박스에 노출되던 버그라, 원소가
// 다시 그 형태처럼 보이면 한 번 더 풀어서 실제 문제 텍스트까지 내려간다.
function unwrapNested(str) {
  const trimmed = String(str).trim();
  if (trimmed.startsWith("{") && trimmed.includes('"problems"')) {
    try {
      const inner = JSON.parse(stripCodeFence(trimmed));
      if (Array.isArray(inner.problems) && inner.problems.length) {
        return inner.problems.flatMap((p) => unwrapNested(p));
      }
    } catch {
      // 풀리지 않으면 원문을 그대로 둔다
    }
  }
  return [trimmed];
}

export function parseProblems(text) {
  try {
    const parsed = JSON.parse(stripCodeFence(text));
    if (Array.isArray(parsed.problems) && parsed.problems.length) {
      return parsed.problems.flatMap((p) => unwrapNested(p)).map((p) => p.trim()).filter(Boolean);
    }
  } catch {
    // JSON 파싱 실패 시 아래에서 원문 그대로 폴백
  }
  return unwrapNested(text).map((p) => p.trim()).filter(Boolean);
}
