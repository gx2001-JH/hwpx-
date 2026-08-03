"""HWP 프로그램 없이(COM 자동화 없이) hwpx 파일을 순수 파이썬으로 생성한다.

section0.xml(본문)을 실제 한글이 만든 문서 구조를 본떠 직접 조립하고,
그 외 정적 파일들(header.xml, content.hpf 등)은 hwpx_templates 모듈의
템플릿을 그대로 사용한다. 어떤 플랫폼(Netlify, Render 등)에도 배포 가능하다.
"""
import datetime
import io
import re
import zipfile
from xml.sax.saxutils import escape as xml_escape

import hwpx_templates as tpl
from converter import latex_to_hwp

MATH_SPLIT_RE = re.compile(
    r"(?P<dd>\$\$(?P<dd_body>.+?)\$\$)"
    r"|(?P<db>\\\[(?P<db_body>.+?)\\\])"
    r"|(?P<ib>\\\((?P<ib_body>.+?)\\\))"
    r"|(?P<id>(?<!\\)\$(?P<id_body>(?:[^$\\]|\\.)+?)(?<!\\)\$)",
    re.DOTALL,
)


def split_segments(text: str):
    """텍스트를 [(is_math, content), ...] 로 분리."""
    segments = []
    pos = 0
    for m in MATH_SPLIT_RE.finditer(text):
        if m.start() > pos:
            segments.append((False, text[pos:m.start()]))
        body = (
            m.group("dd_body")
            or m.group("db_body")
            or m.group("ib_body")
            or m.group("id_body")
        )
        segments.append((True, body))
        pos = m.end()
    if pos < len(text):
        segments.append((False, text[pos:]))
    return segments


def split_into_paragraphs(text: str):
    """[(is_math, content)] 세그먼트 목록을, 줄바꿈 기준 문단 목록으로 재구성.
    각 문단은 [(is_math, content), ...] 형태이며 빈 문단은 빈 리스트."""
    segments = split_segments(text)
    paragraphs = [[]]
    for is_math, content in segments:
        if is_math:
            paragraphs[-1].append((True, content))
        else:
            parts = content.split("\n")
            for i, part in enumerate(parts):
                if i > 0:
                    paragraphs.append([])
                if part != "":
                    paragraphs[-1].append((False, part))
    return paragraphs


_SIZE_TOKEN_RE = re.compile(r'"[^"]*"|[A-Za-z]+|[0-9]+\.?[0-9]*|\s+|.')

BASE_H = 975
ATOM_W = 600
MIN_ATOM_W = 600
CHAR_W = 480
OP_W = 850
SPACE_W = 220
KEYWORD_GLYPH_W = 650
# 하나의 기호 글리프로 렌더링되는 키워드들 (단어 길이와 무관하게 폭이 일정함)
_KEYWORD_GLYPHS = {
    "times", "div", "cdot", "cdots", "vdots", "ddots", "pm", "mp", "circ", "bullet",
    "star", "approx", "sim", "simeq", "cong", "equiv", "propto", "in", "ni", "not",
    "subset", "subseteq", "supset", "supseteq", "UNION", "INTER", "FORALL", "exists",
    "infty", "partial", "nabla", "therefore", "because", "angle", "bot", "parallel",
    "wedge", "vee", "oplus", "ominus", "otimes", "oslash", "aleph", "hbar", "Re", "Im",
    "prime", "neq", "Rightarrow", "Leftarrow", "phi", "theta", "pi", "alpha", "beta",
    "gamma", "delta", "epsilon", "zeta", "eta", "iota", "kappa", "lambda", "mu", "nu",
    "xi", "rho", "sigma", "tau", "upsilon", "chi", "psi", "omega",
}
# 뒤따르는 그룹/토큰에 강세표시를 얹는 접두 키워드 (그 자체는 폭을 거의 차지하지 않음)
_ACCENTS = {
    "bar", "vec", "dot", "ddot", "hat", "tilde", "check", "breve", "acute",
    "grave", "under", "rm", "bold", "it",
}
# 위/아래첨자(극한)가 붙으면 훨씬 더 큰 세로 공간이 필요한 큰 연산자 기호
_BIG_OPS = {"int", "oint", "sum", "prod", "lim", "iint", "iiint"}
_ZERO_WIDTH_KEYWORDS = {"over", "sqrt", "matrix", "left", "right", "atop", "root"}


def _sz_tokenize(script: str):
    return [t for t in _SIZE_TOKEN_RE.findall(script) if t != ""]


def _sz_find_close(tokens, open_idx):
    depth = 1
    j = open_idx + 1
    while j < len(tokens):
        if tokens[j] == "{":
            depth += 1
        elif tokens[j] == "}":
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return len(tokens)


def _sz_split(tokens, sep):
    parts, cur, depth = [], [], 0
    for t in tokens:
        if t == "{":
            depth += 1
        elif t == "}":
            depth -= 1
        if t == sep and depth == 0:
            parts.append(cur)
            cur = []
        else:
            cur.append(t)
    parts.append(cur)
    return parts


def _sz_classify_plain(tok):
    if tok.strip() == "":
        return len(tok) * SPACE_W, BASE_H, None
    if tok.startswith('"') and tok.endswith('"'):
        text = tok[1:-1]
        return max(MIN_ATOM_W, len(text) * CHAR_W), BASE_H, None
    if tok in _BIG_OPS:
        return KEYWORD_GLYPH_W, BASE_H, "bigop"
    if tok in _KEYWORD_GLYPHS:
        return KEYWORD_GLYPH_W, BASE_H, None
    if len(tok) == 1 and not tok.isalnum():
        return OP_W, BASE_H, None
    return max(MIN_ATOM_W, len(tok) * CHAR_W), BASE_H, None


def _sz_measure(tokens):
    out = []  # list of [w, h, tag]
    i = 0
    n = len(tokens)

    def take_base():
        if out:
            return tuple(out.pop())
        return (0, BASE_H, None)

    def next_arg(i):
        """i번째 토큰부터 {그룹} 또는 단일 토큰 하나를 읽어 (w,h,tag,new_i) 반환."""
        if i < n and tokens[i] == "{":
            j = _sz_find_close(tokens, i)
            w, h = _sz_measure(tokens[i + 1:j])
            return w, h, None, j + 1
        if i < n:
            w, h, tag = _sz_classify_plain(tokens[i])
            return w, h, tag, i + 1
        return ATOM_W, BASE_H, None, i

    while i < n:
        tok = tokens[i]

        if tok == "{":
            j = _sz_find_close(tokens, i)
            w, h = _sz_measure(tokens[i + 1:j])
            out.append([w, h, None])
            i = j + 1
            continue

        if tok in ("^", "_"):
            base_w, base_h, base_tag = take_base()
            cw, ch, _, i = next_arg(i + 1)
            if base_tag == "bigop":
                new_h = base_h + max(750, ch + 500)
                new_w = base_w + max(cw, 500)
            else:
                new_h = base_h + max(180, ch * 0.55)
                new_w = base_w + cw * 0.75 + 120
            out.append([new_w, new_h, base_tag])
            continue

        if tok in ("over", "atop"):
            num_w, num_h, _ = take_base()
            den_w, den_h, _, i = next_arg(i + 1)
            gap = 300 if tok == "over" else 220
            out.append([max(num_w, den_w) * 1.08 + 280, num_h + den_h + gap, None])
            continue

        if tok == "sqrt":
            cw, ch, _, i = next_arg(i + 1)
            out.append([cw + 550, ch + 200, None])
            continue

        if tok in _ACCENTS:
            cw, ch, _, i = next_arg(i + 1)
            out.append([cw + 150, ch + 200, None])
            continue

        if tok == "matrix":
            i += 1
            if i < n and tokens[i] == "{":
                j = _sz_find_close(tokens, i)
                inner = tokens[i + 1:j]
                i = j + 1
            else:
                inner = []
            rows = _sz_split(inner, "#")
            row_sizes = []
            for row in rows:
                cells = _sz_split(row, "&")
                row_w, row_h = 0, BASE_H
                for cell in cells:
                    cw, ch = _sz_measure(cell)
                    row_w += cw + 200
                    row_h = max(row_h, ch)
                row_sizes.append((row_w, row_h))
            mw = max((w for w, h in row_sizes), default=ATOM_W)
            mh = sum(h for w, h in row_sizes) + 250 * max(0, len(row_sizes) - 1)
            out.append([mw + 150, mh + 150, None])
            continue

        if tok in ("left", "right"):
            i += 2  # 구분 기호(다음 토큰) 포함
            out.append([350, BASE_H, None])
            continue

        w, h, tag = _sz_classify_plain(tok)
        out.append([w, h, tag])
        i += 1

    total_w = sum(w for w, h, t in out)
    total_h = max((h for w, h, t in out), default=BASE_H)
    return total_w, total_h


def estimate_equation_size(script: str):
    """실제 한글로 다양한 수식을 렌더링해 얻은 (width, height) 표본에 근사하도록
    구성한 추정기. 한/글이 없는 환경에서는 정확한 레이아웃 값을 알 수 없으므로,
    과소평가로 인한 텍스트 겹침을 피하기 위해 여유 배율을 적용한다."""
    tokens = _sz_tokenize(script)
    w, h = _sz_measure(tokens)
    width = max(600, int(w * 1.22))
    height = max(975, int(h * 1.12))
    return width, height


def estimate_baseline(script: str) -> int:
    """hp:equation의 baseLine(글상자 내 텍스트 기준선 위치, %). 분수/행렬처럼
    상하로 내용이 쌓이는 수식은 실제 한글에서 66~68 정도로 훨씬 낮게 저장되는데,
    고정값을 쓰면 그런 수식만 기준선보다 위로 붕 떠 보인다(실제 버그로 확인됨).
    over/atop/matrix가 있으면 낮게, 위아래첨자가 붙는 큰 연산자(int, sum 등)도
    상하로 내용이 쌓이므로 함께 낮게 잡고, 그 외 단순 한 줄 수식은 높게 둔다."""
    tokens = _sz_tokenize(script)
    token_set = set(tokens)
    if "over" in token_set or "atop" in token_set or "matrix" in token_set:
        return 67
    for i, tok in enumerate(tokens):
        if tok in _BIG_OPS and any(t in ("^", "_") for t in tokens[i + 1:i + 3]):
            return 60
    return 88


class _Counters:
    def __init__(self):
        self.eq_id = 2000000001
        self.z_order = 0

    def next_eq_id(self):
        self.eq_id += 1
        return self.eq_id

    def next_z_order(self):
        z = self.z_order
        self.z_order += 1
        return z


def _equation_xml(latex: str, counters: "_Counters") -> str:
    script = latex_to_hwp(latex)
    if not script:
        return ""
    width, height = estimate_equation_size(script)
    baseline = estimate_baseline(script)
    eq_id = counters.next_eq_id()
    z_order = counters.next_z_order()
    return (
        f'<hp:equation id="{eq_id}" zOrder="{z_order}" numberingType="EQUATION" '
        'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" '
        f'version="Equation Version 60" baseLine="{baseline}" textColor="#000000" baseUnit="1000" '
        'lineMode="CHAR" font="HancomEQN">'
        f'<hp:sz width="{width}" widthRelTo="ABSOLUTE" height="{height}" '
        'heightRelTo="ABSOLUTE" protect="0"/>'
        '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" '
        'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" '
        'horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
        '<hp:outMargin left="56" right="56" top="0" bottom="0"/>'
        "<hp:shapeComment>수식입니다.</hp:shapeComment>"
        f"<hp:script>{xml_escape(script)}</hp:script>"
        "</hp:equation>"
    )


def _paragraph_xml(paragraph, counters: "_Counters", sec_pr: str = "") -> str:
    if not paragraph and not sec_pr:
        return (
            '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" '
            'merged="0"><hp:run charPrIDRef="0"/></hp:p>'
        )

    body_parts = []
    for is_math, content in paragraph:
        if is_math:
            body_parts.append(_equation_xml(content, counters))
        else:
            body_parts.append(f"<hp:t>{xml_escape(content)}</hp:t>")

    run_inner = sec_pr + "".join(body_parts)
    return (
        '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" '
        f'merged="0"><hp:run charPrIDRef="0">{run_inner}</hp:run></hp:p>'
    )


def build_section_xml(input_text: str) -> str:
    paragraphs = split_into_paragraphs(input_text)
    counters = _Counters()

    parts = [f'<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec {tpl.SECTION_XML_NS}>']
    for i, para in enumerate(paragraphs):
        sec_pr = tpl.SEC_PR if i == 0 else ""
        parts.append(_paragraph_xml(para, counters, sec_pr))
    parts.append("</hs:sec>")
    return "".join(parts)


def build_hwpx_bytes(input_text: str, title: str = "문서") -> bytes:
    section_xml = build_section_xml(input_text)
    created = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    content_hpf = tpl.content_hpf(xml_escape(title), created)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("mimetype", tpl.MIMETYPE)
        z.writestr("version.xml", tpl.VERSION_XML)
        z.writestr("settings.xml", tpl.SETTINGS_XML)
        z.writestr("Contents/header.xml", tpl.HEADER_XML)
        z.writestr("Contents/section0.xml", section_xml)
        z.writestr("Contents/content.hpf", content_hpf)
        z.writestr("META-INF/container.xml", tpl.CONTAINER_XML)
        z.writestr("META-INF/container.rdf", tpl.CONTAINER_RDF)
        z.writestr("META-INF/manifest.xml", tpl.MANIFEST_XML)
        z.writestr("Preview/PrvText.txt", re.sub(r"\$+|\\\[|\\\]|\\\(|\\\)", "", input_text)[:500])
    return buf.getvalue()
