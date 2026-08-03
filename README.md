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
- `ocr.mjs` — 이미지 업로드를 받아 Gemini Vision으로 텍스트+수식을 추출하는 함수 (`/ocr`)

`public/index.html` — Netlify가 서빙하는 정적 프런트엔드 (Python 버전의 `templates/index.html`과 동일).

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

## 이미지 OCR (수식 이미지 → 텍스트) 설정

"이미지에서 가져오기" 버튼은 Google Gemini API(`gemini-2.5-flash`)로 이미지 속 문제
텍스트와 수식을 읽어 `$...$` LaTeX 형식으로 반환합니다. 추출된 텍스트는 자동으로
변환되지 않고 textarea에 채워지므로, 오탈자나 잘못 인식된 수식이 없는지 확인한 뒤
직접 "hwpx로 변환" 버튼을 눌러야 합니다.

**API 키 발급**: [Google AI Studio](https://aistudio.google.com/apikey)에서 무료로
발급받을 수 있습니다 (요청 빈도 제한이 있는 무료 티어). 키는 절대 코드에 직접 넣지 말고
아래처럼 환경 변수로만 설정하세요.

- **Netlify**: Site settings → Environment variables → `GEMINI_API_KEY` 추가 후 재배포.
- **Render / Railway / Fly.io**: 각 플랫폼의 환경 변수(Environment Variables) 설정 화면에서
  `GEMINI_API_KEY` 추가.
- **로컬 실행**: 셸에서 `export GEMINI_API_KEY=발급받은키` (PowerShell은
  `$env:GEMINI_API_KEY="발급받은키"`) 실행 후 `python app.py`. 이 값을 `.env` 파일에
  저장해도 되며, `.gitignore`에 이미 `.env`가 포함되어 있어 실수로 커밋되지 않습니다.

환경 변수가 설정되지 않은 상태로 "이미지에서 가져오기"를 누르면 서버가
"GEMINI_API_KEY가 설정되어 있지 않습니다" 오류를 반환합니다.

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
