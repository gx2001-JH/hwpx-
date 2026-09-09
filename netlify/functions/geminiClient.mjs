// Gemini 호출을 한곳에서 관리한다.
//
// 무료 티어에서 쓸 수 있는 최신 모델부터 차례로 시도하고, 그 키로 막혀 있거나
// (404 - 구글은 새로 발급된 키에 옛 모델을 막아둔다) 무료 한도를 다 썼거나
// (429) 일시적으로 과부하면(5xx) 다음 모델로 자동으로 넘어간다. 사용자는
// 자기 키만 넣으면 되고, 어떤 모델이 열려 있는지는 신경 쓸 필요가 없다.
export const MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-2.5-flash",
  // 위 ID들이 언젠가 모두 정리되더라도 최소 하나는 살아 있도록 하는 안전망.
  // 구글이 "현재 사용 가능한 flash 모델"을 항상 가리키도록 유지하는 별칭이다.
  "gemini-flash-latest",
];

function endpoint(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

// 키 자체가 잘못된 경우엔 어떤 모델로 바꿔도 똑같이 실패하므로, 남은 모델을
// 헛되이 다 두드리지 말고 즉시 중단한다.
function isInvalidKeyError(status, data) {
  const msg = (data && data.error && data.error.message) || "";
  return (
    (status === 400 || status === 403) &&
    /api[\s_-]?key not valid|API_KEY_INVALID|api key expired/i.test(msg)
  );
}

/**
 * MODELS 순서대로 시도해 처음 성공한 응답을 돌려준다.
 * 성공: { ok: true, data, model }
 * 실패: { ok: false, status, data, model }  (마지막으로 시도한 모델의 오류)
 */
export async function callGemini(apiKey, requestBody) {
  let last = null;
  for (const model of MODELS) {
    const res = await fetch(endpoint(model, apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    // 오류 응답이 JSON이 아닐 수도 있어서(게이트웨이 HTML 등) 방어적으로 읽는다.
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data, model };
    last = { ok: false, status: res.status, data, model };
    if (isInvalidKeyError(res.status, data)) break;
  }
  return last;
}

export function errorMessageOf(result) {
  const msg = result && result.data && result.data.error && result.data.error.message;
  if (msg) return msg;
  const status = result && result.status ? result.status : "알 수 없음";
  return `Gemini API 오류 (${status})`;
}
