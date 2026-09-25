// ai.js — 세 회사(Gemini · OpenAI GPT · Anthropic Claude)를 한 가지 방법으로 부른다.
//
// providers.js 는 도형 생성기(suneung-figure-generator)에서 그대로 가져온 파일이라
// 손대지 않는다. 그쪽이 고쳐지면 통째로 다시 복사해 오면 된다.
// 그 파일의 generateText 는 OpenAI·Claude 만 다루고 Gemini 는 별도 경로(스트리밍)를
// 쓰는데, 이 앱은 스트리밍이 필요 없으므로 Gemini 호출만 여기서 채워 넣는다.
//
// 키는 브라우저(localStorage)에만 두고 각 회사 API 로만 전송된다. 이 앱 서버는
// 키를 보지도, 갖지도 않는다.
import {
  PROVIDERS, CURATED, PROVIDER_META, DEFAULT_MODELS_BY_PROVIDER,
  generateText as generateOther, listProviderModels, recordUsage,
  tierOf, isFreeTier, sortCatalog, priceOf, costOf, fmtCost,
} from './providers.js';

export { PROVIDERS, CURATED, PROVIDER_META, DEFAULT_MODELS_BY_PROVIDER, tierOf, isFreeTier, sortCatalog, priceOf, costOf, fmtCost };

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function geminiError(status, message) {
  const e = new Error(
    status === 401 || status === 403 ? 'Google Gemini API 키가 올바르지 않거나 권한이 없습니다.'
      : status === 429 ? `Google Gemini 요청 한도를 넘었습니다 (429): ${message}`
      : status === 404 ? `이 키로는 쓸 수 없는 모델입니다: ${message}`
      : `Google Gemini 오류 (${status}): ${message}`
  );
  const m = String(message || '');
  e.kind = (status === 401 || status === 403) ? 'key'
    : status === 429 ? 'minute'
    : status === 404 ? 'model'
    : (status === 503 || /overloaded/i.test(m)) ? 'busy'
    : status >= 500 ? 'server' : 'other';
  e.invalidKey = status === 401 || status === 403;
  e.status = status; e.rawMessage = m; e.provider = 'gemini';
  return e;
}

async function geminiText({ key, model, system, user, image, maxTokens, temperature, json, signal }) {
  const parts = [{ text: user }];
  const img = image && /^data:([^;]+);base64,(.+)$/s.exec(image);
  if (img) parts.push({ inline_data: { mime_type: img[1], data: img[2] } });

  const body = { contents: [{ parts }] };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  body.generationConfig = { temperature, maxOutputTokens: maxTokens };
  if (json) body.generationConfig.responseMimeType = 'application/json';

  const res = await fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw geminiError(res.status, (data.error && data.error.message) || res.statusText);

  const cand = (data.candidates || [])[0];
  const text = ((cand && cand.content && cand.content.parts) || []).map((p) => p.text || '').join('');
  if (!text) {
    // 빈 응답은 대개 안전 필터에 걸렸거나 출력 한도에서 잘린 것이다. 원인을 그대로 알려 준다.
    const why = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || 'EMPTY';
    const e = new Error(`Google Gemini 가 빈 응답을 돌려줬습니다 (${why}).`);
    e.kind = /SAFETY|BLOCK/i.test(String(why)) ? 'blocked' : 'cutoff';
    throw e;
  }
  const u = data.usageMetadata || {};
  const usage = { input: u.promptTokenCount || 0, cached: u.cachedContentTokenCount || 0, output: u.candidatesTokenCount || 0 };
  recordUsage('gemini', model, usage);
  return { text, usage, model };
}

/**
 * 세 회사 공통 호출.
 * json:true 는 Gemini 에서만 강제되고, 나머지는 프롬프트로 JSON 을 요구한다.
 */
export async function generateText(provider, opts) {
  if (!opts.key) throw new Error(`${PROVIDERS[provider].name} API 키를 먼저 설정하세요`);
  if (!opts.model) throw new Error('모델을 고르세요');
  if (provider === 'gemini') {
    return geminiText({ maxTokens: 16384, temperature: 0.4, ...opts });
  }
  return generateOther(provider, opts);
}

/** 이 키로 실제 쓸 수 있는 모델 목록 */
export async function listModelsFor(provider, key) {
  if (provider !== 'gemini') return listProviderModels(provider, key);
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw geminiError(res.status, (data.error && data.error.message) || res.statusText);
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !/embedding|aqa|image|tts|live/.test(id));
}

/** 메뉴에 보여 줄 기본 목록 (키가 없을 때) */
export function curatedFor(provider) {
  return CURATED[provider] || [];
}
