// Cloudflare Pages Function — /ocr
// ctx를 그대로 넘겨야 serverApiKey(ctx)가 Workers의 env에서 GEMINI_API_KEY를
// 읽을 수 있다(Workers에는 process 전역이 없다).
import handler from "../netlify/functions/ocr.mjs";

export const onRequestPost = (ctx) => handler(ctx.request, ctx);
