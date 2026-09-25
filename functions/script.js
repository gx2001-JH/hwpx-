// Cloudflare Pages Function — /script
//
// convert.js 와 같은 얼개다. Netlify 핸들러가 표준 Request/Response 시그니처라
// Workers 에서도 그대로 부를 수 있고, 파일 이름이 곧 URL 경로가 된다.
import handler from "../netlify/functions/script.mjs";

export const onRequestPost = ({ request }) => handler(request);
