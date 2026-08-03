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
- 이미지 캡처 입력(수식 이미지를 자동으로 LaTeX로 인식하는 기능)은 아직
  포함되어 있지 않습니다. LaTeX 텍스트만 입력받습니다.
- JS 버전의 zip은 압축 없이(STORED) 작성되어 Python/압축 버전보다 파일 용량이
  다소 큽니다 (기능상 차이는 없음).
