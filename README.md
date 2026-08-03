# 한글 수식 변환기 (배포용, HWP 프로그램 불필요)

LaTeX 수식이 섞인 텍스트를 입력하면, HWP(한글) 수식편집기 문법으로 변환하고
hwpx 파일(zip+XML)을 순수 파이썬으로 직접 조립해 다운로드합니다.
한/글 프로그램이 설치되어 있지 않은 환경(Linux 서버, 서버리스 함수 등)에서도 동작합니다.

## 구조

- `converter.py` — LaTeX → HWP 수식 문법 변환기 (로컬 자동화 버전과 동일, HWP 의존성 없음)
- `hwpx_templates.py` — 실제 한글이 생성한 hwpx를 분해해 얻은 정적 XML 템플릿
- `hwpx_builder_web.py` — 텍스트를 파싱해 section0.xml을 동적 생성 + zip으로 패키징
- `app.py` + `templates/index.html` — 일반 Flask 서버 버전 (Render, Railway, Fly.io 등에 그대로 배포 가능)
- `netlify.toml` + `netlify/functions/convert.py` + `public/index.html` — Netlify Functions 버전

## 로컬 실행

```bash
pip install -r requirements.txt
python app.py
```

`http://127.0.0.1:5051` 접속.

## 배포

### Render / Railway / Fly.io (권장, 별도 수정 불필요)

Flask 앱(`app.py`)을 그대로 표준 Python 웹 서비스로 인식하는 플랫폼입니다.
`requirements.txt`가 있으니 대부분 자동 감지되며, 시작 명령은 `python app.py`
(또는 `gunicorn app:app`)로 지정하면 됩니다.

### Netlify

`netlify.toml`이 `/convert` 요청을 `netlify/functions/convert.py` 서버리스 함수로
리다이렉트하도록 설정되어 있어, 프런트엔드 코드 수정 없이 그대로 배포됩니다.

```bash
netlify deploy --prod
```

또는 GitHub 저장소를 Netlify에 연결하면 자동 배포됩니다. 함수 자체는 외부
패키지 의존성이 전혀 없는 순수 표준 라이브러리 코드라 별도 `requirements.txt` 없이
동작하도록 만들었습니다.

**참고**: `netlify/functions/convert.py` 로직은 이벤트를 직접 시뮬레이션해
로컬에서 검증했지만(정상적으로 유효한 hwpx를 생성함), 실제 Netlify 빌드/런타임
환경에서의 배포는 이 세션에서 직접 실행해보지 못했습니다. 배포 후 문제가 있다면
Netlify의 함수 로그를 확인해주세요.

## 알려진 한계

- 수식 상자의 가로/세로 크기를 한/글이 없는 환경에서는 정확히 계산할 수 없어
  자체 추정 로직을 사용합니다(다양한 수식을 실제 한글로 렌더링해 보정함).
  드물게 일반적이지 않은 복잡한 수식에서는 여백이 다소 넓거나 좁게 보일 수
  있으나, 텍스트 겹침 등 눈에 띄는 문제는 여러 샘플로 검증해 방지했습니다.
- 이미지 캡처 입력(수식 이미지를 자동으로 LaTeX로 인식하는 기능)은 아직
  포함되어 있지 않습니다. LaTeX 텍스트만 입력받습니다.
