// providers.js — AI 제공자(Google Gemini · OpenAI GPT · Anthropic Claude) 공통 인터페이스, 모델 목록, 요금표와 비용 추정
// 키는 브라우저(localStorage)에만 저장되고 각 회사의 API 로만 전송됩니다.

export const PROVIDERS = {
  gemini: { name: 'Google Gemini', short: 'Gemini', keyStore: 'geminiApiKey', placeholder: 'AIza 로 시작하는 API 키', keyUrl: 'https://aistudio.google.com/apikey', keyUrlName: 'Google AI Studio',
    free: '무료 한도가 있습니다(하루 요청 수 제한). 한도를 넘거나 결제를 켠 키는 사용량만큼 요금이 듭니다.' },
  openai: { name: 'OpenAI GPT', short: 'GPT', keyStore: 'openaiApiKey', placeholder: 'sk- 로 시작하는 API 키', keyUrl: 'https://platform.openai.com/api-keys', keyUrlName: 'OpenAI Platform',
    free: '무료 한도가 없습니다. 모든 요청이 유료(선불 크레딧 차감)입니다.' },
  anthropic: { name: 'Anthropic Claude', short: 'Claude', keyStore: 'anthropicApiKey', placeholder: 'sk-ant- 로 시작하는 API 키', keyUrl: 'https://console.anthropic.com/settings/keys', keyUrlName: 'Anthropic Console',
    free: '무료 한도가 없습니다. 모든 요청이 유료(크레딧 차감)입니다.' },
};
export const DEFAULT_MODELS_BY_PROVIDER = {   // 키가 없을 때의 기본 목록 (키를 저장하면 실제 목록으로 바뀐다)
  openai: ['gpt-6-sol', 'gpt-6-astra', 'gpt-5.6-terra', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-luna', 'gpt-6-pro', 'gpt-5.6-sol-pro'],   // 첫 번째 = 처음 고를 때 기본 (GPT-6 Sol: 권장). Pro 는 공식 두 개만
  anthropic: ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
};

// 요금표: 100만 토큰당 미국 달러 [입력, 출력]. 이름 패턴 순서대로 첫 일치. 회사 요금표가 바뀔 수 있어 '추정' 으로 안내한다 (2026년 기준 공개 요금)
// ---------- 공식 요금표 (100만 토큰당 USD, 표준 등급) ----------
// 확인한 곳 (2026-09-24): OpenAI API pricing · Gemini API pricing · Claude API pricing. 여기에 없는 모델은 금액을 계산하지 않는다(어림값을 쓰지 않음).
// in: 입력 · cached: 캐시에서 읽은 입력 · write: 캐시 쓰기(Claude 5분) · out: 출력(생각·추론 토큰 포함)
const OAI_LONG = { over: 272000, inX: 2, outX: 1.5 };   // OpenAI: 입력 272K 초과 요청은 요청 전체에 입력·캐시 2배, 출력 1.5배
const RATES = [
  { re: /^gpt-6-(astra|pro)(-pro)?$/, in: 10, cached: 1, out: 50, long: OAI_LONG },
  { re: /^gpt-6-sol(-pro)?$/, in: 2, cached: 0.2, out: 10, long: OAI_LONG },
  { re: /^gpt-6-luna(-pro)?$/, in: 0.1, cached: 0.01, out: 0.5, long: OAI_LONG },
  { re: /^gpt-5\.6-sol(-pro)?$/, in: 4, cached: 0.4, out: 20, long: OAI_LONG },
  { re: /^gpt-5\.6-terra(-pro)?$/, in: 2, cached: 0.2, out: 12, long: OAI_LONG },
  { re: /^gpt-5\.6-luna(-pro)?$/, in: 0.2, cached: 0.02, out: 1.2, long: OAI_LONG },
  // Gemini 유료 등급 (무료 등급 키는 한도 안에서 0원). 3.6·3.7·3.8 Flash 는 2027-01-01 부터 두 배
  { re: /^gemini-3\.[678]-flash$/, in: 0.75, cached: 0.075, out: 3.75, from: { date: '2027-01-01', in: 1.5, cached: 0.15, out: 7.5 } },
  { re: /^gemini-3\.5-flash$/, in: 1.5, cached: 0.15, out: 9 },
  { re: /^gemini-3-flash(-preview)?$/, in: 0.5, cached: 0.05, out: 3 },   // Gemini 3 Flash Preview (텍스트·이미지 입력 기준, 2026-09 공식 요금표)
  { re: /^gemini-3\.5-flash-lite$/, in: 0.3, cached: 0.03, out: 2.5 },
  { re: /^gemini-3\.1-pro-preview$/, in: 2, cached: 0.2, out: 12, long: { over: 200000, in: 4, cached: 0.4, out: 18 } },
  { re: /^gemini-3\.1-flash-lite$/, in: 0.25, cached: 0.025, out: 1.5 },
  { re: /^gemini-2\.5-flash$/, in: 0.3, cached: null, out: 2.5 },
  { re: /^gemini-2\.5-pro$/, in: 1.25, cached: null, out: 10, long: { over: 200000, in: 2.5, cached: null, out: 15 } },
  // Claude: 1M 문맥까지 같은 단가
  { re: /^claude-fable-5-1/, in: 10, cached: 0.25, write: 12.5, out: 50 },
  { re: /^claude-opus-5-5/, in: 4, cached: 0.2, write: 5, out: 20 },
  { re: /^claude-sonnet-5(?!-\d)/, in: 2, cached: 0.2, write: 2.5, out: 10 },
  { re: /^claude-haiku-4-5/, in: 1, cached: 0.1, write: 1.25, out: 5 },
];
/** 공식 요금표의 단가 (없으면 null) */
export function ratesOf(model, when = new Date()) {
  const m = String(model || ''); const r = RATES.find((x) => x.re.test(m)); if (!r) return null;
  const base = { in: r.in, cached: r.cached, write: r.write == null ? null : r.write, out: r.out, long: r.long || null };
  if (r.from && when.toISOString().slice(0, 10) >= r.from.date) Object.assign(base, { in: r.from.in, cached: r.from.cached, out: r.from.out });
  return base;
}
/** 실제 사용 토큰 → 정확한 비용(USD). u = { input(캐시 포함 전체 입력), cached, cacheWrite, output(생각 포함) }. 계산할 수 없으면 null */
export function costOf(model, u, when = new Date()) {
  const r = ratesOf(model, when); if (!r || !u) return null;
  const inp = +u.input || 0, cached = +u.cached || 0, write = +u.cacheWrite || 0, out = +u.output || 0;
  let R = { in: r.in, cached: r.cached, write: r.write, out: r.out };
  if (r.long && inp > r.long.over) R = r.long.inX ? { in: R.in * r.long.inX, cached: R.cached == null ? null : R.cached * r.long.inX, write: R.write, out: R.out * r.long.outX } : { in: r.long.in, cached: r.long.cached, write: R.write, out: r.long.out };
  if ((cached > 0 && R.cached == null) || (write > 0 && R.write == null)) return null;
  return ((inp - cached - write) * R.in + cached * R.cached + write * (R.write || 0) + out * R.out) / 1e6;
}
/** 옛 코드 호환: 단가 요약 */
export function priceOf(model) { const r = ratesOf(model); return r ? { input: r.in, output: r.out, cached: r.cached, known: true } : { input: null, output: null, known: false }; }
// 원화: 실시간 환율(하루 두 번 갱신). 못 받으면 원화는 표시하지 않는다
const FX_KEY = 'fx.usdkrw';
export function usdKrw() { try { const f = JSON.parse(localStorage.getItem(FX_KEY) || 'null'); return f && f.rate ? f : null; } catch { return null; } }
export async function refreshUsdKrw() {
  const f = usdKrw(); if (f && Date.now() - f.at < 12 * 3600e3) return f;
  try { const r = await fetch('https://open.er-api.com/v6/latest/USD'); const d = await r.json(); if (d && d.rates && d.rates.KRW) { const v = { rate: d.rates.KRW, date: (() => { const t = new Date(d.time_last_update_utc || Date.now()); return isNaN(t) ? '' : t.toISOString().slice(0, 10); })(), at: Date.now() }; localStorage.setItem(FX_KEY, JSON.stringify(v)); return v; } } catch {}
  return f;
}
export function fmtUSD(v) { return '$' + (v < 1 ? v.toFixed(4) : v.toFixed(2)); }   // 1달러 미만은 소수 넷째 자리까지
export function fmtKRW(v) { return '₩' + Math.round(v).toLocaleString('ko-KR'); }
/** "$0.0123 (₩17)" — 환율을 모르면 달러만 */
export function fmtCost(usd) { const f = usdKrw(); return fmtUSD(usd) + (f ? ` (${fmtKRW(usd * f.rate)})` : ''); }

function anthropicHeaders(key) { return { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }; }
async function readError(res) { const data = await res.json().catch(() => ({})); const msg = (data.error && (data.error.message || data.error.type)) || res.statusText || ('HTTP ' + res.status); return { status: res.status, message: msg, data }; }

/** 그 키로 쓸 수 있는 모델 목록 (최신순 정렬) */
export async function listProviderModels(provider, key) {
  if (!key) throw new Error('API 키를 먼저 입력하세요');
  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) { const e = await readError(res); throw new Error(res.status === 401 ? 'API 키가 올바르지 않습니다' : e.message); }
    const data = await res.json();
    const ids = (data.data || []).map((m) => m.id).filter((id) => /^(gpt-|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|embedding|moderation|search|image|instruct|codex|preview-\d{4})/.test(id));
    return ids.sort(cmpNewest);
  }
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', { headers: anthropicHeaders(key) });
    if (!res.ok) { const e = await readError(res); throw new Error(res.status === 401 ? 'API 키가 올바르지 않습니다' : e.message); }
    const data = await res.json();
    return (data.data || []).map((m) => m.id).sort(cmpNewest);
  }
  throw new Error('알 수 없는 제공자: ' + provider);
}
function cmpNewest(a, b) {   // 버전 숫자가 큰 것, 그다음 이름 순
  const va = verOf(a), vb = verOf(b); if (va !== vb) return vb - va; return a < b ? -1 : a > b ? 1 : 0;
}
function verOf(id) { const s = String(id).replace(/^(gpt|claude|gemini)-?/, '').replace(/^o(?=\d)/, ''); const m = /(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(s); return m ? (+m[1]) * 100 + (+(m[2] || 0)) : 0; }   // 5.6 → 506, opus-5-5 → 505, 날짜(20250514)는 소수 자리로 안 친다

/**
 * 한 번 묻고 답 받기 (스트리밍 없음). image 는 data URL.
 * @returns {Promise<{text:string, usage:{input_tokens?, output_tokens?}, model:string}>}
 */
/** GPT 의 Pro 모델은 별도 모델 ID 가 아니라 기반 모델에 reasoning.mode = "pro" 를 붙여 Responses API 로 부른다 (OpenAI 문서: Reasoning mode) */
export const OPENAI_PRO = { 'gpt-6-pro': 'gpt-6-astra', 'gpt-5.6-sol-pro': 'gpt-5.6-sol' };   // 공식 Pro 두 개: 기반 모델 + Pro 모드
export const openaiProBase = (model) => OPENAI_PRO[model] || null;
async function openaiResponses({ key, model, system, user, image, signal }) {
  const base = openaiProBase(model);
  const content = [{ type: 'input_text', text: user }].concat(image ? [{ type: 'input_image', image_url: image }] : []);
  const body = { model: base, reasoning: { mode: 'pro' }, input: [{ role: 'user', content }] };   // 최대 출력 토큰은 두지 않는다 (Pro 는 생각 토큰이 많아 제한하면 답이 비어 버림)
  if (system) body.instructions = system;
  const call = () => fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal });
  let res = await call();
  if (!res.ok) {
    const e = await readError(res);
    if (res.status === 400 && /mode/i.test(e.message)) { body.reasoning = { effort: 'high' }; res = await call(); if (!res.ok) { const e2 = await readError(res); throw apiError('openai', res.status, e2.message); } }   // 이 키·모델이 pro 모드를 못 받으면 가장 깊은 생각으로
    else throw apiError('openai', res.status, e.message);
  }
  const data = await res.json();
  const text = typeof data.output_text === 'string' ? data.output_text
    : (data.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  if (!text && data.status === 'incomplete') { const e = new Error(`OpenAI GPT(${model}) 응답이 중간에 끊겼습니다: ${(data.incomplete_details && data.incomplete_details.reason) || 'incomplete'}`); e.kind = /content_filter/.test(JSON.stringify(data.incomplete_details || {})) ? 'blocked' : 'cutoff'; throw e; }
  const du = data.usage || {}; const usage = { input: du.input_tokens || 0, cached: (du.input_tokens_details && du.input_tokens_details.cached_tokens) || 0, output: du.output_tokens || 0 };
  recordUsage('openai', model, usage);
  return { text, usage, model };
}
export async function generateText(provider, { key, model, system, user, image, maxTokens = 16384, temperature = 0.4, signal }) {
  if (!key) throw new Error(`${PROVIDERS[provider].name} API 키를 먼저 설정하세요`);
  if (!model) throw new Error('모델을 고르세요');
  const img = image && /^data:([^;]+);base64,(.+)$/s.exec(image);
  if (provider === 'openai' && openaiProBase(model)) return openaiResponses({ key, model, system, user, image, signal });
  if (provider === 'openai') {
    const content = img ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: image } }] : user;
    const body = { model, messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }], max_completion_tokens: maxTokens };
    if (!/^(o\d|gpt-5|gpt-6)/.test(model)) body.temperature = temperature;   // 추론 모델(o·GPT-5·GPT-6)은 temperature 를 받지 않는다
    let res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal });
    if (!res.ok) {
      const e = await readError(res);
      if (res.status === 400 && /temperature|max_completion_tokens|max_tokens/i.test(e.message)) {   // 옵션을 못 받는 모델이면 옵션 없이 한 번 더
        delete body.temperature; if (/max_completion_tokens/i.test(e.message)) { delete body.max_completion_tokens; body.max_tokens = maxTokens; }
        res = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal });
        if (!res.ok) { const e2 = await readError(res); throw apiError(provider, res.status, e2.message); }
      } else throw apiError(provider, res.status, e.message);
    }
    const data = await res.json(); const ch = (data.choices || [])[0];
    const text = ch && ch.message ? (typeof ch.message.content === 'string' ? ch.message.content : (ch.message.content || []).map((p) => p.text || '').join('')) : '';
    const du = data.usage || {}; const usage = { input: du.prompt_tokens || 0, cached: (du.prompt_tokens_details && du.prompt_tokens_details.cached_tokens) || 0, output: du.completion_tokens || 0 };   // completion 에 추론 토큰 포함
    recordUsage('openai', model, usage);
    return { text, usage, model: data.model || model };
  }
  if (provider === 'anthropic') {
    const content = img ? [{ type: 'image', source: { type: 'base64', media_type: img[1], data: img[2] } }, { type: 'text', text: user }] : [{ type: 'text', text: user }];
    const body = { model, max_tokens: maxTokens, temperature, messages: [{ role: 'user', content }] }; if (system) body.system = system;
    const res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: anthropicHeaders(key), body: JSON.stringify(body), signal });
    if (!res.ok) { const e = await readError(res); throw apiError(provider, res.status, e.message); }
    const data = await res.json();
    const text = (data.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('');
    const du = data.usage || {}; const cr = du.cache_read_input_tokens || 0, cw = du.cache_creation_input_tokens || 0;
    const usage = { input: (du.input_tokens || 0) + cr + cw, cached: cr, cacheWrite: cw, output: du.output_tokens || 0 };
    recordUsage('anthropic', model, usage);
    return { text, usage, model: data.model || model };
  }
  throw new Error('알 수 없는 제공자: ' + provider);
}
function apiError(provider, status, message) {
  const name = PROVIDERS[provider].name;
  const e = new Error(status === 401 ? `${name} API 키가 올바르지 않습니다. 키를 다시 확인하세요.` : status === 429 ? `${name} 요청 한도 또는 크레딧이 부족합니다 (429): ${message}` : status === 402 ? `${name} 결제(크레딧)가 필요합니다: ${message}` : `${name} 오류 (${status}): ${message}`);
  const m = String(message || '');
  e.kind = status === 401 ? 'key' : (status === 402 || /insufficient_quota|credit balance|billing|exceeded your current quota|payment/i.test(m)) ? 'credit' : status === 429 ? 'minute' : /unsupported_country|not supported in your (country|region)|location is not supported/i.test(m) ? 'location' : status === 403 ? 'perm' : status === 404 ? 'model' : (status === 529 || status === 503 || /overloaded/i.test(m)) ? 'busy' : status >= 500 ? 'server' : (status === 400 && /too long|context length|too large|maximum context/i.test(m)) ? 'toolong' : 'other';
  e.invalidKey = status === 401; e.status = status; e.rawMessage = m; e.provider = provider; return e;
}

/** 모델 등급: 고급(가장 똑똑, 느리고 비쌈) · 표준 · 빠름(가볍고 쌈) — 이름으로 가늠 */
export function tierOf(model) {
  const m = String(model || '').toLowerCase();
  if (/nano|lite|haiku|8b/.test(m)) return { k: 'fast', label: '빠름' };
  if (/mini|flash|sonnet/.test(m)) return { k: 'std', label: '표준' };
  return { k: 'pro', label: '고급' };
}
/** 무료 한도로 쓸 수 있나 (Gemini 만 무료 한도가 있다. 결제를 켠 Gemini 키는 한도를 넘으면 유료) */
export function isFreeTier(provider, model) { return provider === 'gemini'; }
/** 목록 정렬: 최신(버전 큰 것) → 같은 버전 안에서는 고급 → 표준 → 빠름 */
export function sortCatalog(list) {
  const rank = { pro: 0, std: 1, fast: 2 };
  return [...new Set(list)].sort((a, b) => { const va = verOf(a), vb = verOf(b); if (va !== vb) return vb - va; const ra = rank[tierOf(a).k], rb = rank[tierOf(b).k]; if (ra !== rb) return ra - rb; return a < b ? -1 : a > b ? 1 : 0; });
}

/** 메뉴에 보여 줄 엄선 목록: 회사마다 사람들이 가장 많이 쓰는 최신 고급·표준·빠름 모델. badge: free(무료 한도) · freeLow(무료 한도 적음) · paid(유료) */
export const PROVIDER_META = {
  openai: { title: 'ChatGPT', by: 'OpenAI', desc: '가장 널리 쓰이는 범용 모델. 수식·코드에 강하고 결과가 안정적', icon: 'gpt' },
  anthropic: { title: 'Claude', by: 'Anthropic', desc: '정교한 언어 이해와 긴 규격 준수에 강함. 복잡한 문제에 유리', icon: 'claude' },
  gemini: { title: 'Gemini', by: 'Google', desc: '무료 한도가 있고 빠름. 이미지(문제 캡처) 읽기에 좋음', icon: 'gemini' },
};
export const CURATED = {
  openai: [   // GPT 라인업: 세대(gen)별 급. 각 급은 메뉴에서 일반 / Pro(같은 모델 + reasoning.mode pro)를 따로 고른다. (OpenAI 문서 확인 2026-09)
    { id: 'gpt-6-astra', gen: 'GPT-6', name: 'GPT-6 Astra', tier: '최상위', badge: 'paid', desc: '가장 어려운 작업용 · 가장 똑똑함', pro: 'gpt-6-pro', proName: 'GPT-6 Pro', proDesc: 'Astra 기반 · 가장 어려운 작업용 Pro (느리고 토큰 많이 씀)' },
    { id: 'gpt-6-sol', gen: 'GPT-6', name: 'GPT-6 Sol', tier: '중상급', badge: 'paid', desc: '복잡한 추론·코딩 · 값 대비 성능 좋음' },
    { id: 'gpt-6-luna', gen: 'GPT-6', name: 'GPT-6 Luna', tier: '빠름', badge: 'paid', desc: '가장 빠르고 저렴 · 간단한 그림' },
    { id: 'gpt-5.6-sol', gen: 'GPT-5.6', name: 'GPT-5.6 Sol', tier: '플래그십', badge: 'paid', desc: '복잡한 추론 · 어려운 도형', pro: 'gpt-5.6-sol-pro', proName: 'GPT-5.6 Sol Pro', proDesc: '장시간 작업·고난도 문제에 특화 (느림)' },
    { id: 'gpt-5.6-terra', gen: 'GPT-5.6', name: 'GPT-5.6 Terra', tier: '중상급', badge: 'paid', desc: '성능·속도·비용 균형' },
    { id: 'gpt-5.6-luna', gen: 'GPT-5.6', name: 'GPT-5.6 Luna', tier: '빠름', badge: 'paid', desc: '빠르고 저렴 · 간단한 그림' },
  ],
  anthropic: [
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', tier: '고급', badge: 'paid', desc: '최신 · 가장 똑똑함' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tier: '고급', badge: 'paid', desc: '정교함 · 비쌈' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5', tier: '표준', badge: 'paid', desc: '성능·비용 균형' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: '빠름', badge: 'paid', desc: '가볍고 빠름' },
  ],
  gemini: [   // 성능순
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (preview)', tier: '고급', badge: 'paidOnly', desc: '가장 똑똑함 · 느림 · 유료 키 전용 (구글 무료 등급 없음)' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tier: '표준', badge: 'free', desc: '가장 똑똑한 Flash · 한국 낮엔 한산, 밤~새벽엔 붐빔' },
    { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', tier: '표준', badge: 'free', desc: '빠르고 효율적인 Flash · 3.8 처럼 밤~새벽엔 붐빔' },
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', tier: '이전 세대', badge: 'free', desc: '한 세대 전 Flash · 밤~새벽에도 덜 붐빔' },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', tier: '이전 세대', badge: 'free', desc: '두 세대 전 Flash · 앞 모델이 붐빌 때 대안' },
    { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (preview)', tier: '이전 세대', badge: 'free', desc: '가장 오래된 Flash · 마지막 대안' },
  ],
};
export const PROVIDER_ORDER = ['gemini', 'openai', 'anthropic'];   // 무료 한도가 있는 Gemini 를 맨 위에

/** Gemini 모델 목록 정리: 그림 생성에 맞는 텍스트 모델(2.5 이상의 pro·flash·flash-lite)만 남기고, 음성·이미지·임베딩·실험용·옛 모델은 뺀다 */
export function filterGeminiModels(list) {
  const bad = /(tts|image|audio|live|embed|gemma|nano|banana|customtools|learnlm|aqa|imagen|veo|exp|thinking|vision|8b|computer|robotics|deep-research)/i;
  return sortCatalog((list || []).filter((id) => /^gemini-\d/.test(id) && !bad.test(id) && verOf(id) >= 205 && /(pro|flash)/.test(id)));
}

// ---------- 사용량 기록 (이 브라우저에서 이 앱으로 보낸 요청만): 회사 API 는 남은 한도를 알려 주지 않으므로 직접 센다 ----------
const USAGE_KEY = 'aiUsage.v2';   // v2: 공식 요금표·실제 토큰으로만 계산 (v1 의 어림 금액은 버림)
const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;   // 이 컴퓨터의 날짜
const today = () => dayStr(new Date());
function loadUsage() { try { return JSON.parse(localStorage.getItem(USAGE_KEY) || '{}'); } catch { return {}; } }
export const callLog = [];   // 이 창에서 보낸 요청 (그림 한 장에 든 비용을 합산하는 데 씀)
export function recordUsage(provider, model, usage) {
  const u = loadUsage(); const d = today(); u[d] = u[d] || {}; const row = u[d][provider] = u[d][provider] || {};
  if (row.billed == null) row.billed = (provider !== 'gemini' || geminiBilling()) ? (row.usd || 0) : 0;   // 옛 기록 보정
  for (const k of ['req', 'in', 'cached', 'out', 'usd', 'billed', 'unpriced']) row[k] = row[k] || 0;
  if (!row.models || Array.isArray(row.models) || Object.values(row.models).some((v) => typeof v === 'number')) row.models = {};
  const n = { input: +usage.input || 0, cached: +usage.cached || 0, cacheWrite: +usage.cacheWrite || 0, output: +usage.output || 0 };
  const usd = costOf(model, n);   // 유료 요금 기준 (공식 요금표 × 실제 토큰)
  const freeKey = provider === 'gemini' && !geminiBilling();   // Gemini 무료 키: 무료 한도 안에서 실제 청구 0원
  const billed = usd == null ? null : (freeKey ? 0 : usd);
  row.req += 1; row.in += n.input; row.cached += n.cached; row.out += n.output; if (usd == null) row.unpriced += 1; else { row.usd += usd; row.billed += billed; }
  const mm = row.models[model] = row.models[model] || { n: 0, in: 0, cached: 0, out: 0, usd: 0, priced: 0 };
  mm.n += 1; mm.in += n.input; mm.cached += n.cached; mm.out += n.output; if (usd != null) { mm.usd += usd; mm.priced += 1; }
  for (const k of Object.keys(u)) if (k < dayStr(new Date(Date.now() - 62 * 864e5))) delete u[k];   // 두 달 지난 기록은 버린다
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(u)); } catch {}
  callLog.push({ provider, model, ...n, usd, billed, freeKey });
}
/** 그림 한 장(생성 + 자동 재요청·보정)에 든 요청을 모델별로 쌓는다 → '문제 1개' 비용 = 실제 기록의 평균 */
const GEN_KEY = 'aiGen.v1';
export function recordGeneration(provider, model, calls) {
  if (!calls.length) return; let g = {}; try { g = JSON.parse(localStorage.getItem(GEN_KEY) || '{}'); } catch {}
  const k = provider + '|' + model; const r = g[k] = g[k] || { n: 0, calls: 0, usd: 0, priced: 0 };
  const priced = calls.every((c) => c.usd != null); r.n += 1; r.calls += calls.length; if (priced) { r.usd += calls.reduce((s, c) => s + c.usd, 0); r.priced += 1; }
  try { localStorage.setItem(GEN_KEY, JSON.stringify(g)); } catch {}
}
/** 이 모델의 실제 기록: 그림 한 장 평균 / 요청 1회 평균 (기록이 없거나 요금표가 없으면 null) */
export function measured(provider, model) {
  let g = {}; try { g = JSON.parse(localStorage.getItem(GEN_KEY) || '{}'); } catch {}
  const gen = g[provider + '|' + model]; const u = loadUsage();
  const call = { n: 0, in: 0, cached: 0, out: 0, usd: 0, priced: 0 };
  for (const day of Object.values(u)) { const mm = day[provider] && day[provider].models && day[provider].models[model]; if (mm && typeof mm === 'object') for (const k of Object.keys(call)) call[k] += mm[k] || 0; }
  return {
    perFigure: gen && gen.priced ? { n: gen.priced, usd: gen.usd / gen.priced, calls: gen.calls / gen.n } : null,
    perCall: call.priced ? { n: call.priced, usd: call.usd / call.priced, in: call.in / call.n, cached: call.cached / call.n, out: call.out / call.n } : null,
  };
}
export const geminiBilling = () => { try { return localStorage.getItem('geminiBilling') === '1'; } catch { return false; } };   // 결제(유료)를 연결한 Gemini 키 — 무료 한도 표시를 끈다
export function markQuotaHit(provider, model) { try { localStorage.setItem('quotaHit.' + provider, JSON.stringify({ day: today(), model })); } catch {} }
export function quotaHitToday(provider) { try { const q = JSON.parse(localStorage.getItem('quotaHit.' + provider) || 'null'); return q && q.day === today() ? q : null; } catch { return null; } }
/** 오늘·이번 달 요약 */
export function usageSummary(provider) {
  const u = loadUsage(); const d = today(); const mon = d.slice(0, 7);
  const z = () => ({ req: 0, in: 0, cached: 0, out: 0, usd: 0, billed: 0, unpriced: 0 });
  const fix = (row) => { const r = Object.assign(z(), row || {}); if (row && row.billed == null) r.billed = (provider !== 'gemini' || geminiBilling()) ? (row.usd || 0) : 0; return r; };
  const t = fix(u[d] && u[d][provider]);
  const m = z(); for (const [day, row] of Object.entries(u)) if (day.startsWith(mon) && row[provider]) { const r = fix(row[provider]); for (const k of Object.keys(m)) m[k] += +r[k] || 0; }
  const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)); const wk0 = dayStr(monday);   // 이번 주 = 월요일부터
  const w = z(); for (const [day, row] of Object.entries(u)) if (day >= wk0 && day <= d && row[provider]) { const r = fix(row[provider]); for (const k of Object.keys(w)) w[k] += +r[k] || 0; }
  return { today: t, week: w, month: m, quotaHit: quotaHitToday(provider) };
}

/** 모델 id → 보기 좋은 이름: gemini-3.1-pro-preview → Gemini 3.1 Pro (preview), gpt-5-mini → GPT-5 mini, claude-opus-5-5 → Claude Opus 5.5 */
export function prettyModelName(provider, id) {
  const s = String(id || '');
  if (provider === 'gemini') { const m = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash|pro)(?:-(.+))?$/.exec(s); if (m) return `Gemini ${m[1]} ${m[2] === 'flash-lite' ? 'Flash-Lite' : m[2] === 'flash' ? 'Flash' : 'Pro'}${m[3] ? ` (${m[3]})` : ''}`; return s; }
  if (provider === 'openai') { const m = /^gpt-(\d+(?:\.\d+)?)(?:-(.+))?$/.exec(s); if (m) return `GPT-${m[1]}${m[2] ? ' ' + m[2].replace(/-\d{4}-\d{2}-\d{2}$/, '') : ''}`; return s; }
  if (provider === 'anthropic') { const m = /^claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?(?:-(\d{8}))?(?:-(.+))?$/.exec(s); if (m) return `Claude ${m[1][0].toUpperCase() + m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[5] ? ` (${m[5]})` : ''}`; const m2 = /^claude-(\d)-(\d)-(opus|sonnet|haiku)/.exec(s); if (m2) return `Claude ${m2[1]}.${m2[2]} ${m2[3][0].toUpperCase() + m2[3].slice(1)}`; return s; }
  return s;
}
export function familyOf(provider, id) {
  const s = String(id || '').toLowerCase();
  if (provider === 'gemini') return /flash-lite/.test(s) ? 'flash-lite' : /flash/.test(s) ? 'flash' : /pro/.test(s) ? 'pro' : 'other';
  if (provider === 'anthropic') return (/opus|sonnet|haiku|fable/.exec(s) || ['other'])[0];
  if (provider === 'openai') return /nano/.test(s) ? 'nano' : /mini/.test(s) ? 'mini' : /^o\d/.test(s) ? 'o' : 'main';
  return 'other';
}
export function tierFor(provider, id) {
  const f = familyOf(provider, id);
  if (provider === 'gemini') return f === 'pro' ? { k: 'pro', label: '고급' } : f === 'flash-lite' ? { k: 'fast', label: '빠름' } : { k: 'std', label: '표준' };
  if (provider === 'anthropic') return f === 'haiku' ? { k: 'fast', label: '빠름' } : f === 'sonnet' ? { k: 'std', label: '표준' } : { k: 'pro', label: '고급' };
  if (provider === 'openai') return f === 'nano' ? { k: 'fast', label: '빠름' } : f === 'mini' ? { k: 'std', label: '표준' } : { k: 'pro', label: '고급' };
  return tierOf(id);
}
export function badgeFor(provider, id) { if (provider !== 'gemini') return 'paid'; return familyOf(provider, id) === 'pro' ? 'paidOnly' : 'free'; }   // Gemini Pro 는 무료 등급 없음
/** 회사별 권장 모델 (메뉴에 '권장' 표시) */
export const recommendLabel = (provider, id, free = false) => {   // 회사별 권장 모델과 표시 문구 (없으면 ''). free: Gemini 무료 키
  const m = String(id || '');
  if (provider === 'gemini') return free ? (m === 'gemini-3.8-flash' ? '낮 시간 권장' : m === 'gemini-3.6-flash' ? '밤 시간 권장' : '') : (m === 'gemini-3.1-pro-preview' ? '복잡한 도형 권장' : m === 'gemini-3.8-flash' ? '간단한 그림 권장' : '');
  if (provider === 'openai') return m === 'gpt-6-sol' ? '권장' : '';
  if (provider === 'anthropic') return /^claude-sonnet-5(?!-\d)/.test(m) ? '권장' : '';
  return '';
};
export const isRecommended = (provider, id, free = false) => !!recommendLabel(provider, id, free);
export const TIER_DESC = { pro: '가장 똑똑함 · 느리고 비쌈', std: '성능과 비용의 균형', fast: '가볍고 빠르고 쌈 · 간단한 그림' };
/** 키로 받아온 목록 정리: 그림 생성에 맞는 텍스트 모델만, 날짜 스냅샷·preview 중복 제거, 갈래(가족)마다 최신 2개, 한 세대 이상 옛 모델 제거, 최신·고급 → 빠름 순 */
export function pruneModels(provider, list) {
  let ids = [...new Set((list || []).map(String))];
  if (provider === 'gemini') ids = filterGeminiModels(ids);
  if (provider === 'openai') ids = ids.filter((id) => /^(gpt-\d|o\d)/.test(id) && !/(audio|realtime|transcribe|tts|embedding|moderation|search|image|instruct|codex|preview|pro-\d|deep-research|computer|vision)/.test(id));
  if (provider === 'anthropic') ids = ids.filter((id) => /^claude-/.test(id) && !/(vision|instant)/.test(id));
  const undated = (id) => id.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '').replace(/-latest$/, '');
  // 같은 모델의 날짜판·latest 판이 함께 있으면 짧은 것 하나만
  const byBase = new Map(); for (const id of ids) { const b = undated(id); if (!byBase.has(b) || id.length < byBase.get(b).length) byBase.set(b, id); } ids = [...byBase.values()];
  // preview 와 정식이 같은 버전으로 있으면 정식만
  ids = ids.filter((id) => !/preview/.test(id) || !ids.some((o) => o !== id && !/preview/.test(o) && undated(o) === undated(id).replace(/-preview.*$/, '')));
  // 한 세대 넘게 옛 것은 제거 (최고 버전보다 100 = 한 주 버전 낮은 것까지만)
  const maxV = Math.max(0, ...ids.map(verOf)); ids = ids.filter((id) => verOf(id) >= maxV - 100);
  // 가족마다 최신 2개
  const perFam = {}; const out = [];
  for (const id of sortCatalog(ids)) { const f = familyOf(provider, id); perFam[f] = (perFam[f] || 0) + 1; if (perFam[f] <= 2) out.push(id); }
  return out.slice(0, 8);
}

/** 모델의 지금 상태 (앱이 기억한 것): 잠시 건너뛰는 중(503·429·한도), 최근 성공 */
export function modelStatus(model) {
  let cd = {}; try { cd = JSON.parse(localStorage.getItem('modelCooldown') || '{}'); } catch {}
  const until = cd[model]; const last = (() => { try { return localStorage.getItem('lastGoodModel'); } catch { return null; } })();
  if (until && until > Date.now()) return { k: 'busy', label: `잠시 건너뜀 (${Math.ceil((until - Date.now()) / 60000)}분)`, tip: '조금 전 이 모델이 붐비거나(503) 한도(429)에 걸려 잠시 다른 모델로 넘어갑니다' };
  if (last && last === model) return { k: 'ok', label: '방금 성공', tip: '가장 최근에 그림을 만든 모델' };
  return null;
}
