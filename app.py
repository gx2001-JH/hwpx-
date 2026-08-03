import io

from flask import Flask, render_template, request, send_file, jsonify

from hwpx_builder_web import build_hwpx_bytes

app = Flask(__name__)


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


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5051, debug=False)
