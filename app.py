import io
import json
import os
import re
import urllib.error
import urllib.request

from flask import Flask, render_template, request, send_file, jsonify

from hwpx_builder_web import build_hwpx_bytes

app = Flask(__name__)

OCR_PROMPT = """다음 이미지에 있는 수학 문제 텍스트를 그대로 옮겨 적어줘.

규칙:
- 수식 부분은 LaTeX 문법으로 작성하고 반드시 $...$ 로 감싸줘. 여러 줄에 걸치거나 별도 줄로 강조해야 하는 블록 수식은 $$...$$ 로 감싸줘.
- 수식이 아닌 일반 텍스트(문제 번호, 설명, 보기 등)는 이미지에 있는 그대로 옮기고, 문단/줄바꿈 구조도 최대한 유지해줘.
- 이미지에 없는 내용을 추가하거나 문제를 풀지 마. 오직 옮겨 적기만 해.
- 설명이나 코드블록 없이, 옮겨 적은 텍스트만 출력해줘."""


TYPE_INSTRUCTIONS = {
    "객관식": "문제 유형은 객관식으로 작성해줘. 보기는 ①, ②, ③, ④, ⑤ 기호를 사용하고, [해설] 마지막에 정답 번호를 명시해줘.",
    "단답형": "문제 유형은 단답형으로 작성해줘. 정수이거나 간단한 형태의 값이 답으로 나오도록 하고, 문제 끝을 '...값을 구하시오.' 형식으로 마무리해줘.",
    "서술형": "문제 유형은 서술형으로 작성해줘. 최종 답만이 아니라 풀이 과정을 요구하는 형식으로 작성하고, [해설]에 전체 풀이 과정을 단계별로 자세히 서술해줘.",
}


def _build_generate_prompt(instruction: str, context: str, problem_type: str) -> str:
    context_block = ""
    if context and context.strip():
        context_block = (
            "\n다음은 참고할 기존 문제(스타일 참고용이거나 변형 대상)야:\n"
            f'"""\n{context.strip()}\n"""\n'
        )
    type_block = f"\n{TYPE_INSTRUCTIONS[problem_type]}\n" if problem_type in TYPE_INSTRUCTIONS else ""
    return (
        "너는 대한민국 수능(대학수학능력시험)/모의고사 스타일 수학 문제를 출제하는 전문가야.\n"
        "아래 사용자 요청에 따라 수학 문제와 해설을 작성해줘.\n\n"
        "형식 규칙:\n"
        "- 수식은 반드시 LaTeX 문법으로 작성하고 $...$ 로 감싸줘 (여러 줄/블록 수식은 $$...$$). 문장 "
        "중간에 단독으로 나오는 숫자나 변수 하나(예: 답이 \"5이다\"라고 쓸 때의 5)도 예외 없이 $5$처럼 "
        "LaTeX로 감싸줘 — 감싸지 않은 일반 텍스트 숫자로 남겨두지 마.\n"
        "- 객관식 보기 번호는 항상 ①, ②, ③, ④, ⑤ 기호만 사용해. \"(1)\", \"(2)\", \"1)\", \"1.\" 같은 "
        "형태는 절대 쓰지 마 (문제 유형을 명시적으로 지정받지 않고 네가 알아서 객관식으로 판단해 "
        "만드는 경우에도 반드시 지켜야 하는 규칙이야).\n"
        "- 마크다운 문법(**굵게**, - 목록, # 제목 등)을 쓰지 말고 일반 텍스트로만 작성해줘.\n"
        "- 각 문제는 문제 본문 다음 줄에 \"[해설]\"로 시작하는 해설을 붙여줘.\n"
        "- 대한민국 수능/모의고사에서 실제로 쓰이는 어휘와 문장 형식을 따라줘 "
        "(예: \"다음 중 옳은 것은?\", \"...의 값을 구하시오.\", \"...을 만족시키는 모든 ...의 값의 합은?\" 등).\n"
        "- 여러 문제를 요청받으면 하나로 합치지 말고 problems 배열의 개별 원소로 나눠서 작성해줘.\n"
        f"{type_block}{context_block}\n사용자 요청: {instruction}\n\n"
        '반드시 다음 JSON 형식으로만 응답해: {"problems": ["문제1 전체 텍스트(문제+[해설])", "문제2 전체 텍스트", ...]}'
    )


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    m = re.match(r"^```(?:json)?\s*([\s\S]*?)\s*```$", stripped)
    return m.group(1) if m else text


def _unwrap_nested(value) -> list:
    """가끔 모델이 problems 배열의 원소 하나에 {"problems": [...]} JSON 문자열
    전체를 그대로 한 번 더 넣어버린다(자기 자신이 출력해야 할 형식 설명을
    내용으로 착각하는 경우). 그 결과가 그대로 박스에 노출되던 버그라, 원소가
    다시 그 형태처럼 보이면 한 번 더 풀어서 실제 문제 텍스트까지 내려간다."""
    trimmed = str(value).strip()
    if trimmed.startswith("{") and '"problems"' in trimmed:
        try:
            inner = json.loads(_strip_code_fence(trimmed))
            inner_problems = inner.get("problems")
            if isinstance(inner_problems, list) and inner_problems:
                result = []
                for p in inner_problems:
                    result.extend(_unwrap_nested(p))
                return result
        except Exception:
            pass
    return [trimmed]


def _parse_problems(text: str):
    try:
        parsed = json.loads(_strip_code_fence(text))
        problems = parsed.get("problems")
        if isinstance(problems, list) and problems:
            result = []
            for p in problems:
                result.extend(_unwrap_nested(p))
            return [p.strip() for p in result if p.strip()]
    except Exception:
        pass
    return [p.strip() for p in _unwrap_nested(text) if p.strip()]


# 기본 모델. 구글이 이 모델을 특정 API 키(주로 새로 발급된 키)에 막아버리면
# _is_model_unavailable_error()가 이를 감지해 _FALLBACK_MODEL로 한 번 더 시도한다.
_PRIMARY_MODEL = "gemini-2.5-flash"
_FALLBACK_MODEL = "gemini-flash-latest"


def _call_gemini_model(api_key: str, model: str, body: dict):
    payload = json.dumps(body).encode("utf-8")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent?key={api_key}"
    )
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


class GeminiApiError(Exception):
    """HTTPError는 본문을 한 번만 읽을 수 있어서, 라우트에서 다시 읽으려다
    실패하는 일이 없도록 메시지를 미리 뽑아 담아두는 래퍼."""

    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _read_http_error_message(err: urllib.error.HTTPError) -> str:
    try:
        body = json.loads(err.read().decode("utf-8"))
        return body.get("error", {}).get("message") or f"Gemini API 오류 ({err.code})"
    except Exception:
        return f"Gemini API 오류 ({err.code})"


def _is_model_unavailable_message(msg: str) -> bool:
    lowered = msg.lower()
    return "no longer available" in lowered or "not found for api version" in lowered


def _call_gemini(api_key: str, parts: list, json_mode: bool = False):
    body = {"contents": [{"parts": parts}]}
    if json_mode:
        body["generationConfig"] = {"responseMimeType": "application/json"}
    try:
        return _call_gemini_model(api_key, _PRIMARY_MODEL, body)
    except urllib.error.HTTPError as e:
        msg = _read_http_error_message(e)
        if e.code == 404 and _is_model_unavailable_message(msg):
            try:
                return _call_gemini_model(api_key, _FALLBACK_MODEL, body)
            except urllib.error.HTTPError as e2:
                raise GeminiApiError(e2.code, _read_http_error_message(e2)) from e2
        raise GeminiApiError(e.code, msg) from e


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/convert", methods=["POST"])
def convert():
    text = request.form.get("text", "")
    filename = request.form.get("filename", "").strip() or "output"
    filename = "".join(c for c in filename if c not in '\\/:*?"<>|').strip() or "output"

    if not text.strip():
        return jsonify({"error": "변환할 텍스트를 입력해주세요."}), 400

    try:
        data = build_hwpx_bytes(text, title=filename)
    except Exception as e:
        return jsonify({"error": f"변환 중 오류가 발생했습니다: {e}"}), 500

    return send_file(
        io.BytesIO(data),
        as_attachment=True,
        download_name=f"{filename}.hwpx",
        mimetype="application/haansofthwpx",
    )


@app.route("/ocr", methods=["POST"])
def ocr():
    body = request.get_json(silent=True) or {}
    # 사용자가 자기 API 키를 등록했으면 그 키를 우선 쓰고, 없으면(관리자가 설정해둔 경우)
    # 서버 환경 변수로 폴백한다.
    api_key = (body.get("apiKey") or "").strip() or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "API 키가 없습니다. 상단의 'API 키 설정'에서 본인의 Gemini API 키를 등록해주세요."}), 401
    image_base64 = body.get("imageBase64")
    mime_type = body.get("mimeType")
    if not image_base64 or not mime_type:
        return jsonify({"error": "이미지 데이터가 없습니다."}), 400

    parts = [
        {"text": OCR_PROMPT},
        {"inline_data": {"mime_type": mime_type, "data": image_base64}},
    ]

    try:
        data = _call_gemini(api_key, parts)
    except GeminiApiError as e:
        return jsonify({"error": e.message}), 502
    except Exception as e:
        return jsonify({"error": f"OCR 처리 중 오류: {e}"}), 500

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return jsonify({"error": "이미지에서 텍스트를 추출하지 못했습니다."}), 502

    return jsonify({"text": text.strip()})


@app.route("/generate", methods=["POST"])
def generate():
    body = request.get_json(silent=True) or {}
    # 사용자가 자기 API 키를 등록했으면 그 키를 우선 쓰고, 없으면(관리자가 설정해둔 경우)
    # 서버 환경 변수로 폴백한다.
    api_key = (body.get("apiKey") or "").strip() or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "API 키가 없습니다. 상단의 'API 키 설정'에서 본인의 Gemini API 키를 등록해주세요."}), 401
    instruction = (body.get("instruction") or "").strip()
    context = body.get("context") or ""
    problem_type = body.get("type") or ""
    if not instruction:
        return jsonify({"error": "생성/변형 요청 내용을 입력해주세요."}), 400

    parts = [{"text": _build_generate_prompt(instruction, context, problem_type)}]

    try:
        data = _call_gemini(api_key, parts, json_mode=True)
    except GeminiApiError as e:
        return jsonify({"error": e.message}), 502
    except Exception as e:
        return jsonify({"error": f"생성 처리 중 오류: {e}"}), 500

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        text = None

    problems = _parse_problems(text) if text else []
    if not problems:
        return jsonify({"error": "문제를 생성하지 못했습니다."}), 502

    return jsonify({"problems": problems})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5051, debug=False)
