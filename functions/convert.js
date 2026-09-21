// Cloudflare Pages Function — /convert
//
// 로직은 Netlify 버전과 하나도 나누지 않는다. Netlify 핸들러가 이미 표준
// Request/Response 시그니처라서 Workers에서도 그대로 부를 수 있다.
// (파일 경로가 URL 경로가 되는 Pages 규칙상 이 파일이 /convert 를 맡는다)
import handler from "../netlify/functions/convert.mjs";

export const onRequestPost = ({ request }) => handler(request);
