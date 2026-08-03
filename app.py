import io
import json
import os
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


def _build_generate_prompt(instruction: str, context: str) -> str:
    context_block = ""
    if context and context.strip():
        context_block = (
            "\n다음은 참고할 기존 문제(스타일 참고용이거나 변형 대상)야:\n"
            f'"""\n{context.strip()}\n"""\n'
        )
    return (
        "너는 한국 수학 문제 출제 전문가야. 아래 사용자 요청에 따라 수학 문제와 해설을 작성해줘.\n\n"
        "규칙:\n"
        "- 수식은 반드시 LaTeX 문법으로 작성하고 $...$ 로 감싸줘 (여러 줄/블록 수식은 $$...$$).\n"
        "- 문제 번호, 문제 본문, [해설] 형식을 갖춰서 작성해줘.\n"
        "- 마크다운 문법(**굵게**, - 목록, # 제목 등)을 쓰지 말고 일반 텍스트로만 작성해줘.\n"
        "- 설명이나 코드블록 없이, 문제와 해설 텍스트만 출력해줘.\n"
        f"{context_block}\n사용자 요청: {instruction}"
    )


def _call_gemini(api_key: str, parts: list):
    payload = json.dumps({"contents": [{"parts": parts}]}).encode("utf-8")
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.5-flash:generateContent?key={api_key}"
    )
    req = urllib.request.Request(
        url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


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
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다."}), 500

    body = request.get_json(silent=True) or {}
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
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode("utf-8"))
            msg = err_body.get("error", {}).get("message", f"Gemini API 오류 ({e.code})")
        except Exception:
            msg = f"Gemini API 오류 ({e.code})"
        return jsonify({"error": msg}), 502
    except Exception as e:
        return jsonify({"error": f"OCR 처리 중 오류: {e}"}), 500

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return jsonify({"error": "이미지에서 텍스트를 추출하지 못했습니다."}), 502

    return jsonify({"text": text.strip()})


@app.route("/generate", methods=["POST"])
def generate():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({"error": "서버에 GEMINI_API_KEY가 설정되어 있지 않습니다."}), 500

    body = request.get_json(silent=True) or {}
    instruction = (body.get("instruction") or "").strip()
    context = body.get("context") or ""
    if not instruction:
        return jsonify({"error": "생성/변형 요청 내용을 입력해주세요."}), 400

    parts = [{"text": _build_generate_prompt(instruction, context)}]

    try:
        data = _call_gemini(api_key, parts)
    except urllib.error.HTTPError as e:
        try:
            err_body = json.loads(e.read().decode("utf-8"))
            msg = err_body.get("error", {}).get("message", f"Gemini API 오류 ({e.code})")
        except Exception:
            msg = f"Gemini API 오류 ({e.code})"
        return jsonify({"error": msg}), 502
    except Exception as e:
        return jsonify({"error": f"생성 처리 중 오류: {e}"}), 500

    try:
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return jsonify({"error": "문제를 생성하지 못했습니다."}), 502

    return jsonify({"text": text.strip()})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5051, debug=False)
