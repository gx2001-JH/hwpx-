import base64
import json
from urllib.parse import parse_qs

from hwpx_builder_web import build_hwpx_bytes


def handler(event, context):
    if event.get("httpMethod") != "POST":
        return {"statusCode": 405, "body": "Method Not Allowed"}

    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        body = base64.b64decode(body).decode("utf-8")

    params = parse_qs(body)
    text = (params.get("text", [""])[0])
    filename = (params.get("filename", ["output"])[0] or "output").strip()
    filename = "".join(c for c in filename if c not in '\\/:*?"<>|').strip() or "output"

    if not text.strip():
        return {
            "statusCode": 400,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": "변환할 텍스트를 입력해주세요."}),
        }

    try:
        data = build_hwpx_bytes(text, title=filename)
    except Exception as e:
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"error": f"변환 중 오류가 발생했습니다: {e}"}),
        }

    return {
        "statusCode": 200,
        "headers": {
            "Content-Type": "application/haansofthwpx",
            "Content-Disposition": f'attachment; filename="{filename}.hwpx"',
        },
        "body": base64.b64encode(data).decode("ascii"),
        "isBase64Encoded": True,
    }
