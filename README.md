# 한글 수식 변환기 (배포용, HWP 프로그램 불필요)

LaTeX 수식이 섞인 텍스트를 입력하면, HWP(한글) 수식편집기 문법으로 변환하고
hwpx 파일(zip+XML)을 직접 조립해 다운로드합니다.
한/글 프로그램이 설치되어 있지 않은 환경(Linux 서버, 서버리스 함수 등)에서도 동작합니다.

두 가지 배포 대상을 위해 같은 로직을 두 언어로 유지합니다 (Netlify Functions는
Python을 지원하지 않기 때문입니다 — 아래 "왜 두 벌인가" 참고).

## 구조

**Python 버전** (Render / Railway / Fly.io 등 일반 서버용)
- `converter.py` — LaTeX → HWP 수식 문법 변환기
- `hwpx_templates.py` — 실제 한글이 생성한 hwpx를 분해해 얻은 정적 XML 템플릿
- `hwpx_builder_web.py` — 텍스트를 파싱해 section0.xml을 동적 생성 + zip으로 패키징
- `app.py` + `templates/index.html` — Flask 서버

**JavaScript 버전** (Netlify Functions용, `netlify/functions/`)
- `converter.mjs`, `hwpxTemplates.mjs`, `hwpxBuilder.mjs` — 위 Python 로직의 1:1 이식
- `zipWriter.mjs` — 외부 의존성 없이 Node 내장 `zlib.crc32`만으로 zip(STORED)을 직접 작성
- `convert.mjs` — Netlify 함수 핸들러 (`/convert` 경로에 자동 매핑)
- `ocr.mjs` — 이미지를 받아 Gemini Vision으로 텍스트+수식을 추출하는 함수 (`/ocr`)
- `generate.mjs` — 요청에 따라 문제를 새로 짓거나 기존 문제를 변형하는 함수 (`/generate`)

`public/index.html` — Netlify가 서빙하는 정적 프런트엔드. `templates/index.html`(Flask용)과
같은 백엔드 API(`/convert`, `/ocr`, `/generate`)를 쓰지만, **UI는 더 이상 서로 동기화하지
않습니다.** Netlify 버전은 사이드바+박스 그리드 레이아웃, 박스별 AI 변형 등 더 다듬어진
디자인을 계속 업데이트하고, Flask 버전(`templates/index.html`)은 더 단순한 박스 목록
UI에서 유지됩니다.

## 로컬 실행 (Python/Flask 버전)

```bash
pip install -r requirements.txt
python app.py
```

`http://127.0.0.1:5051` 접속.

## 배포

### Render / Railway / Fly.io (Python 버전)

Flask 앱(`app.py`)을 그대로 표준 Python 웹 서비스로 인식하는 플랫폼입니다.
`requirements.txt`가 있으니 대부분 자동 감지되며, 시작 명령은 `python app.py`
(또는 `gunicorn app:app`)로 지정하면 됩니다.

### Netlify (JavaScript 버전)

```bash
netlify deploy --prod
```

또는 GitHub 저장소를 Netlify에 연결하면 자동 배포됩니다. `netlify/functions/convert.mjs`가
`export const config = { path: "/convert" }`로 라우팅을 직접 선언하므로 별도 리다이렉트
설정이 필요 없습니다. 함수는 외부 npm 패키지 의존성이 전혀 없습니다.

### Cloudflare Pages (같은 코드, 다른 런타임)

`functions/` 디렉터리가 Cloudflare Pages Functions입니다. 파일 이름이 곧 URL 경로라
(`functions/convert.js` → `/convert`) 별도 라우팅 설정이 없습니다.

**로직은 Netlify와 한 줄도 나누지 않았습니다.** Netlify 핸들러가 이미 표준
`Request`/`Response` 시그니처여서, Cloudflare 쪽 파일은 그것을 그대로 호출하는
세 줄짜리 래퍼입니다. 두 플랫폼의 차이는 단 하나, 서버에 설정해둔 API 키를 읽는
방법뿐입니다:

- Netlify(Node): `process.env.GEMINI_API_KEY`
- Cloudflare(Workers): 요청 컨텍스트의 `env.GEMINI_API_KEY` — Workers에는 `process`
  전역이 아예 없습니다.

이 차이는 `geminiClient.mjs`의 `serverApiKey(ctx)` 하나가 흡수합니다.

Workers는 Node 런타임이 아니므로 `node:*` 내장 모듈을 쓰면 안 됩니다. 그래서
`zipWriter.mjs`는 `Buffer`와 `node:zlib`(crc32)를 걷어내고 `Uint8Array`/`TextEncoder`와
직접 구현한 CRC-32만 쓰도록 바꿨습니다. 덕분에 Node·Workers·브라우저 어디서나 같은
코드가 돕니다(`nodejs_compat` 플래그도 필요 없음).

대시보드에서 연결할 때:

| 항목 | 값 |
| --- | --- |
| Framework preset | None |
| Build command | *(비워둠)* |
| Build output directory | `public` |
| 환경 변수 | `GEMINI_API_KEY` (선택 — 사용자가 자기 키를 넣는 방식이면 불필요) |

## 문제 박스 UI

문제는 텍스트 하나에 이어붙는 대신 **박스 단위**로 관리합니다. 각 박스는 체크박스(변환
대상 포함 여부), 위/아래 순서 이동, 삭제, 출처 라벨(이미지/AI/직접입력)을 가지며, 내용을
직접 수정할 수 있습니다. "hwpx로 변환"은 **체크된 박스만** 순서대로 모아 파일 하나로
만듭니다 — 문제마다 따로 변환할 필요 없이, 필요한 것만 골라 한 번에 만들 수 있습니다.

각 박스는 **편집 / 미리보기** 두 가지 보기를 토글할 수 있습니다. 편집은 원문 LaTeX 텍스트를
직접 고치는 모드, 미리보기는 [KaTeX](https://katex.org)(CDN)로 `$...$`/`$$...$$` 수식을
실제로 렌더링해 보여주는 모드입니다 — hwpx 변환 결과를 미리 가늠해볼 수 있습니다.

### Netlify 버전 전용 UI (사이드바 + 박스 그리드)

`public/index.html`은 왼쪽 사이드바(이미지 입력, AI 생성, 박스 도구)와 오른쪽 박스 그리드로
나뉘는 2단 레이아웃입니다. 좌우 경계를 마우스로 드래그해 폭을 조절할 수 있고, 화면이 좁아지면
(≤860px) 위아래로 쌓이는 1단 레이아웃으로 자동 전환됩니다.

- **이미지 입력 3가지**: 왼쪽 점선 영역에 드래그, 클릭 후 Ctrl+V, 또는 "파일 선택" 버튼.
  (점선 영역을 클릭하면 바로 파일 선택창이 뜨는 방식은 "클릭 후 Ctrl+V" 안내와 모순되므로,
  클릭은 포커스만 주고 파일 선택은 별도 버튼으로 분리했습니다.)
- **박스에 바로 붙여넣기**: 특정 박스의 텍스트 칸을 클릭해 포커스한 뒤 이미지를 Ctrl+V하면,
  새 박스를 만들지 않고 그 박스에 바로 이어붙입니다.
- 체크박스 색상은 브라우저 기본값 대신 `accent-color`로 Claude 팔레트(클레이 오렌지)에 맞췄고,
  아이콘은 이모지 대신 모두 인라인 SVG 플랫 아이콘을 씁니다.

## AI 기능 (이미지 OCR + 문항 생성/변형) 설정

**세 회사를 쓸 수 있습니다** — Google Gemini · OpenAI GPT · Anthropic Claude.
머리글의 열쇠 단추에서 회사를 고르고 본인 API 키를 넣으면 됩니다.

호출은 **브라우저에서 각 회사 API 로 직접** 나갑니다. 이 앱 서버는 키를 보지도
갖지도 않습니다(도형 생성기와 같은 방식). 그래서 `/ocr`·`/generate` 서버 함수는
없앴고, 남은 서버 함수는 hwpx 를 만드는 `/convert` 하나뿐입니다.

- `public/js/providers.js` — 도형 생성기(suneung-figure-generator)에서 **그대로 가져온**
  파일입니다. 모델 카탈로그·요금표·회사별 호출이 들어 있습니다. 그쪽이 고쳐지면
  통째로 다시 복사해 오면 됩니다. **직접 수정하지 마세요.**
- `public/js/ai.js` — 위 파일을 감싸 Gemini 호출을 더하고, 세 회사를 한 함수
  (`generateText`)로 부를 수 있게 합니다. providers.js 의 `generateText` 는
  OpenAI·Claude 만 다루고 Gemini 는 스트리밍 경로를 쓰는데, 이 앱은 스트리밍이
  필요 없어 여기서 채웠습니다.
- `public/js/prompts.js` — OCR·문항 생성 지시문과 응답 파싱.

키는 브라우저 localStorage 에 회사별로 저장됩니다(`geminiApiKey`, `openaiApiKey`,
`anthropicApiKey`). **도형 생성기와 같은 이름**이라, 나중에 두 앱을 같은 주소에
올리면 키가 그대로 공유됩니다.

Flask 버전(`app.py` + `templates/index.html`)은 예전 구조 그대로 서버의
`GEMINI_API_KEY` 를 쓰는 `/ocr`·`/generate` 라우트를 유지합니다.

## 왜 두 벌인가 (Python + JavaScript)

처음엔 Netlify Functions에도 Python으로 배포하려 했으나, **Netlify는 서버리스 함수에서
Python을 지원하지 않습니다** (TypeScript/JavaScript/Go만 지원 — Netlify 공식 지원팀 답변).
함수 파일이 조용히 무시되어 빌드 에러 없이 404만 발생합니다. 이 때문에 변환 로직을
JavaScript로 별도 이식했습니다. 두 구현 모두 동일한 테스트 케이스로 결과를 대조하고,
실제 한글 프로그램으로 열어 픽셀 단위로 동일하게 렌더링됨을 확인했습니다.

## 알려진 한계

- 수식 상자의 가로/세로 크기를 한/글이 없는 환경에서는 정확히 계산할 수 없어
  자체 추정 로직을 사용합니다(다양한 수식을 실제 한글로 렌더링해 보정함).
  드물게 일반적이지 않은 복잡한 수식에서는 여백이 다소 넓거나 좁게 보일 수
  있으나, 텍스트 겹침 등 눈에 띄는 문제는 여러 샘플로 검증해 방지했습니다.
- 이미지 OCR은 일반 LLM 비전 모델(Gemini)을 사용하므로, Mathpix 같은 수식 전용 OCR보다
  복잡한 수식에서 인식 오류가 나올 수 있습니다. 추출된 텍스트는 항상 사람이 확인 후
  변환하는 흐름으로 설계했습니다.
- JS 버전의 zip은 압축 없이(STORED) 작성되어 Python/압축 버전보다 파일 용량이
  다소 큽니다 (기능상 차이는 없음).
- AI가 생성/변형한 문제는 정답이나 풀이 과정이 틀릴 수 있습니다(LLM 특성상 당연한 한계).
  변환 전 반드시 사람이 검토해야 합니다.
- 이미지 큐(다중 업로드/연속 붙여넣기)는 단일 이미지 OCR과 동일한 `/ocr` 호출을 순서대로
  반복하는 구조로, 로직 검토와 단일 이미지 경로 실사용 검증은 마쳤지만, 여러 장을 실제로
  연속 붙여넣는 시나리오는 이 저장소를 만든 세션에서 자동화 테스트 도구의 한계로 직접
  실행해보지 못했습니다. 실제 사용 중 문제가 있으면 알려주세요.
- 박스 미리보기는 jsdelivr CDN의 KaTeX를 씁니다. CDN이 차단된 네트워크에서는 미리보기가
  렌더링되지 않고 원문 텍스트만 보이지만(자동 감지 후 조용히 폴백), 편집·변환 기능 자체에는
  영향이 없습니다.
