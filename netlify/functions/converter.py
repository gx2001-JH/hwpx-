"""LaTeX 수식 문자열을 HWP(한글) 수식편집기 문법으로 변환한다.

지원 범위: 분수, 근호, 위/아래첨자, 그리스문자, 적분/급수/극한, 삼각/로그 함수,
집합/논리 기호, 화살표, 강조기호(bar/vec/hat 등), 행렬/케이스, \\text, \\left \\right 등.
완벽한 LaTeX 파서는 아니며, 시험 문제 등 일반적인 수식 표현을 목표로 한다.
"""
import re

GREEK = {
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
    "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
}
VAR_GREEK = {
    "varepsilon": "epsilon", "vartheta": "theta", "varpi": "pi",
    "varrho": "rho", "varsigma": "sigma", "varphi": "phi", "varkappa": "kappa",
}

SYMBOL_MAP = {
    "times": "times", "div": "div", "cdot": "cdot", "cdotp": "cdot",
    "cdots": "cdots", "ldots": "cdots", "dots": "cdots", "dotsc": "cdots",
    "vdots": "vdots", "ddots": "ddots",
    "pm": "+-", "mp": "-+", "ast": "*", "star": "star",
    "circ": "circ", "bullet": "bullet",
    "leq": "<=", "le": "<=", "geq": ">=", "ge": ">=",
    "neq": "neq", "ne": "neq",
    "approx": "approx", "sim": "sim", "simeq": "simeq", "cong": "cong",
    "equiv": "equiv", "propto": "propto",
    "in": "in", "notin": "not in", "ni": "ni",
    "subset": "subset", "subseteq": "subseteq",
    "supset": "supset", "supseteq": "supseteq",
    "cup": "UNION", "cap": "INTER",
    "forall": "FORALL", "exists": "exists", "nexists": "not exists",
    "infty": "infty", "partial": "partial", "nabla": "nabla",
    "emptyset": "phi", "varnothing": "phi",
    "therefore": "therefore", "because": "because",
    "angle": "angle", "perp": "bot", "parallel": "parallel",
    "wedge": "wedge", "vee": "vee", "land": "wedge", "lor": "vee",
    "lnot": "not", "neg": "not",
    "oplus": "oplus", "ominus": "ominus", "otimes": "otimes", "oslash": "oslash",
    "rightarrow": "->", "to": "->", "longrightarrow": "->", "mapsto": "->",
    "leftarrow": "<-", "longleftarrow": "<-",
    "Rightarrow": "Rightarrow", "Leftarrow": "Leftarrow",
    "leftrightarrow": "<->", "Leftrightarrow": "⇔",
    "aleph": "aleph", "hbar": "hbar", "Re": "Re", "Im": "Im",
    "prime": "prime", "degree": "circ",
    "%": "%", "&": "&", "_": "_", "#": "#", "$": "$",
}

# 뒤에 아래/위첨자로 상하한이 자연스럽게 붙는 연산자·함수 (별도 처리 불필요, 텍스트로 그대로 출력)
PASSTHROUGH_WORDS = {
    "sum", "prod", "int", "oint", "lim", "max", "min", "sup", "inf", "gcd",
    "det", "exp", "log", "ln", "lg", "sin", "cos", "tan", "csc", "sec", "cot",
    "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "deg", "mod",
}

ACCENTS = {
    "bar": "bar", "overline": "bar",
    "vec": "vec", "overrightarrow": "vec",
    "dot": "dot", "ddot": "ddot",
    "hat": "hat", "widehat": "hat",
    "tilde": "tilde", "widetilde": "tilde",
    "check": "check", "breve": "breve",
    "acute": "acute", "grave": "grave",
    "underline": "under",
}

DELIM_MAP = {"\\{": "{", "\\}": "}", "{": "{", "}": "}"}

SPACING_COMMANDS = {",", ";", ":", "!", "quad", "qquad", " "}

TOKEN_RE = re.compile(
    r"\\[a-zA-Z]+|\\.|[{}\[\]_^&]|[0-9]+\.?[0-9]*|[^\s{}\[\]_^&\\]+|\s+"
)


def tokenize(s: str):
    return [t for t in TOKEN_RE.findall(s) if t != ""]


def is_single_atom(text: str) -> bool:
    return len(text) == 1


class Parser:
    def __init__(self, tokens):
        self.tokens = tokens
        self.i = 0
        self.n = len(tokens)

    def peek(self):
        return self.tokens[self.i] if self.i < self.n else None

    def next(self):
        t = self.tokens[self.i]
        self.i += 1
        return t

    def parse_group_body(self, stop_at_brace=True):
        """현재 위치부터 (필요시 매칭되는 '}' 직전까지) 파싱하여 렌더링된 문자열 반환."""
        out = []  # list of [text, atomic]

        def emit_atom(txt):
            out.append([txt, True])

        def emit_command_atom(txt):
            # \sin\theta 같이 서로 다른 명령이 공백 없이 바로 이어지면
            # 렌더링된 단어들이 뭉쳐 보이므로(sintheta) 명령 결과 사이에만 공백을 끼워 넣는다.
            # (위/아래첨자 밑변수 분리(mc^2 -> m, c^2)에는 적용하면 안 되므로 별도 함수로 분리)
            if out and txt and out[-1][0] and out[-1][0][-1].isalpha() and txt[0].isalpha():
                out.append([" ", False])
            out.append([txt, True])

        def emit_text(txt):
            if not txt:
                return
            if out and not out[-1][1]:
                out[-1][0] += txt
            else:
                out.append([txt, False])

        def take_base():
            if not out:
                return ""
            text, atomic = out[-1]
            if atomic or len(text) == 1:
                out.pop()
                return text
            out[-1][0] = text[:-1]
            return text[-1]

        while self.i < self.n:
            tok = self.peek()
            if stop_at_brace and tok == "}":
                break
            self.next()

            if tok in ("^", "_"):
                base = take_base()
                content, from_braces = self.parse_supsub_arg()
                brace = content if (not from_braces and is_single_atom(content)) else "{" + content + "}"
                marker = "^" if tok == "^" else "_"
                emit_atom(base + marker + brace)
                continue

            if tok == "{":
                inner = self.parse_group_body(stop_at_brace=True)
                self.expect("}")
                emit_atom(inner)
                continue

            if tok.startswith("\\") and len(tok) > 1 and tok[1].isalpha():
                name = tok[1:]
                emit_command_atom(self.render_command(name))
                continue

            if tok.startswith("\\") and len(tok) == 2:
                ch = tok[1]
                if ch in (",", ";", ":", "!", " "):
                    emit_text(" ")
                else:
                    emit_text(ch)
                continue

            if tok in ("[", "]"):
                emit_text(tok)
                continue

            if tok.strip() == "":
                emit_text(" ")
                continue

            # 일반 텍스트/숫자 런
            emit_text(tok)

        return "".join(seg[0] for seg in out)

    def expect(self, tok):
        if self.peek() == tok:
            self.next()
        # 문법이 어긋나도 최대한 관대하게 처리 (예외를 던지지 않음)

    def parse_braced_group(self):
        """다음 토큰이 '{' 여야 하며, 그 내용을 렌더링해 반환."""
        if self.peek() == "{":
            self.next()
            inner = self.parse_group_body(stop_at_brace=True)
            self.expect("}")
            return inner
        # 중괄호가 없으면 단일 토큰만 소비
        return self.parse_single_token()

    def parse_single_token(self):
        tok = self.peek()
        if tok is None:
            return ""
        if tok == "{":
            self.next()
            inner = self.parse_group_body(stop_at_brace=True)
            self.expect("}")
            return inner
        self.next()
        if tok.startswith("\\") and len(tok) > 1 and tok[1].isalpha():
            return self.render_command(tok[1:])
        if tok.startswith("\\") and len(tok) == 2:
            return tok[1]
        return tok

    def parse_supsub_arg(self):
        """^, _ 뒤에 오는 인자를 파싱. {..}면 (내용, True), 아니면 (단일토큰, False)."""
        if self.peek() == "{":
            self.next()
            inner = self.parse_group_body(stop_at_brace=True)
            self.expect("}")
            return inner, True
        tok = self.next() if self.i < self.n else ""
        if tok.startswith("\\") and len(tok) > 1 and tok[1].isalpha():
            return self.render_command(tok[1:]), False
        if tok.startswith("\\") and len(tok) == 2:
            return tok[1], False
        return tok, False

    def render_command(self, name):
        if name in ("frac", "dfrac", "tfrac"):
            num = self.parse_braced_group()
            den = self.parse_braced_group()
            return "{" + num + "} over {" + den + "}"

        if name == "sqrt":
            idx = None
            if self.peek() == "[":
                self.next()
                idx_tokens = []
                while self.peek() not in (None, "]"):
                    idx_tokens.append(self.next())
                self.expect("]")
                idx = Parser(idx_tokens).parse_group_body(stop_at_brace=False)
            rad = self.parse_braced_group()
            if idx is None:
                return "sqrt " + rad if is_single_atom(rad) else "sqrt {" + rad + "}"
            return "{" + rad + "} ^{1 over {" + idx + "}}"

        if name in ACCENTS:
            arg = self.parse_braced_group()
            kw = ACCENTS[name]
            return kw + " " + arg if is_single_atom(arg) else kw + " {" + arg + "}"

        if name in ("text", "mbox", "textrm", "operatorname"):
            raw = self.consume_raw_group()
            return '"' + raw + '"'

        if name in ("mathrm", "rm"):
            arg = self.parse_braced_group()
            return "rm {" + arg + "}"

        if name in ("mathbf", "bf", "boldsymbol"):
            arg = self.parse_braced_group()
            return "bold {" + arg + "}"

        if name in ("mathit", "it"):
            arg = self.parse_braced_group()
            return "it {" + arg + "}"

        if name == "binom":
            n = self.parse_braced_group()
            k = self.parse_braced_group()
            return "left ( {" + n + "} atop {" + k + "} right )"

        if name in ("left", "right"):
            tok = self.next() if self.i < self.n else ""
            delim = DELIM_MAP.get(tok, tok)
            return ("left " if name == "left" else "right ") + delim

        if name in SPACING_COMMANDS:
            return " "

        if name in GREEK:
            return name
        if name in VAR_GREEK:
            return VAR_GREEK[name]
        lname = name.lower()
        if lname in GREEK:
            return lname
        if lname in VAR_GREEK:
            return VAR_GREEK[lname]

        if name in SYMBOL_MAP:
            return SYMBOL_MAP[name]
        if name in PASSTHROUGH_WORDS:
            return name

        # \begin{}, \end{} 은 사전 처리 단계에서 이미 치환되므로 여기 도달하지 않음.
        # 알 수 없는 명령은 이름 그대로 출력 (최선의 노력)
        return name

    def consume_raw_group(self):
        """{...} 내부를 수식 변환 없이 원문 그대로(이스케이프만 해제) 추출."""
        if self.peek() != "{":
            return self.parse_single_token()
        self.next()
        depth = 1
        buf = []
        while self.i < self.n and depth > 0:
            tok = self.next()
            if tok == "{":
                depth += 1
                buf.append(tok)
            elif tok == "}":
                depth -= 1
                if depth > 0:
                    buf.append(tok)
            elif tok.startswith("\\") and len(tok) == 2:
                buf.append(tok[1])
            elif tok.strip() == "":
                buf.append("~")
            else:
                buf.append(tok)
        return "".join(buf)


def split_top_level(s: str, sep: str):
    """중괄호/대괄호 깊이를 고려하여 최상위 레벨에서만 sep으로 분리."""
    parts = []
    depth = 0
    buf = []
    i = 0
    n = len(s)
    seplen = len(sep)
    while i < n:
        if s[i] in "{[":
            depth += 1
            buf.append(s[i])
            i += 1
        elif s[i] in "}]":
            depth -= 1
            buf.append(s[i])
            i += 1
        elif depth == 0 and s[i:i + seplen] == sep:
            parts.append("".join(buf))
            buf = []
            i += seplen
        else:
            buf.append(s[i])
            i += 1
    parts.append("".join(buf))
    return parts


ENV_RE = re.compile(r"\\begin\{(\w+\*?)\}(.*?)\\end\{\1\}", re.DOTALL)

ENV_DELIMS = {
    "pmatrix": ("left (", "right )"),
    "bmatrix": ("left [", "right ]"),
    "Bmatrix": ("left {", "right }"),
    "vmatrix": ("left |", "right |"),
    "Vmatrix": ("left ||", "right ||"),
    "matrix": (None, None),
    "smallmatrix": (None, None),
    "array": (None, None),
    "cases": ("left {", None),
    "aligned": (None, None),
    "align": (None, None),
    "align*": (None, None),
    "eqnarray": (None, None),
    "gathered": (None, None),
}


def convert_environment(env_name: str, body: str) -> str:
    left, right = ENV_DELIMS.get(env_name, (None, None))
    rows = split_top_level(body.strip(), "\\\\")
    row_strs = []
    for row in rows:
        row = row.strip()
        if not row:
            continue
        cells = split_top_level(row, "&")
        rendered_cells = [latex_to_hwp(c.strip()) for c in cells]
        row_strs.append(" & ".join(rendered_cells))
    inner = "matrix{" + " # ".join(row_strs) + "}"
    if left and right:
        return left + " " + inner + " " + right
    if left:
        return left + " " + inner
    return inner


def preprocess_environments(latex: str) -> str:
    def _sub(m):
        env_name = m.group(1)
        body = m.group(2)
        placeholder = convert_environment(env_name, body)
        # 이후 토크나이저를 거치지 않도록 특수 마커로 감싼다.
        return "\x00" + placeholder.replace("\x00", "") + "\x01"

    return ENV_RE.sub(_sub, latex)


def latex_to_hwp(latex: str) -> str:
    """LaTeX 수식 문자열(중괄호 포함, $ 등 구분자는 제외) -> HWP 수식 스크립트 문자열."""
    latex = latex.strip()
    if not latex:
        return ""

    # \begin{...}...\end{...} 환경을 먼저 치환
    latex = preprocess_environments(latex)

    # 마커로 감싼 이미 변환된 조각과, 그 외 일반 LaTeX 조각을 분리해서 처리
    result_parts = []
    pos = 0
    for m in re.finditer("\x00(.*?)\x01", latex, re.DOTALL):
        pre = latex[pos:m.start()]
        if pre:
            tokens = tokenize(pre)
            result_parts.append(Parser(tokens).parse_group_body(stop_at_brace=False))
        result_parts.append(m.group(1))
        pos = m.end()
    tail = latex[pos:]
    if tail:
        tokens = tokenize(tail)
        result_parts.append(Parser(tokens).parse_group_body(stop_at_brace=False))

    out = "".join(result_parts)
    out = re.sub(r" {2,}", " ", out)
    return out.strip()


if __name__ == "__main__":
    tests = [
        r"\frac{1}{2}",
        r"E=mc^2",
        r"H_2 O",
        r"0<\theta<\frac{\pi}{2}",
        r"\int_a^b f(x)dx",
        r"\lim_{x \to 0} \frac{1}{x}",
        r"\sqrt{a+b}",
        r"\sqrt[3]{8}",
        r"\overline{AB}",
        r"A \cup B",
        r"A \notin B",
        r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
        r"\begin{cases} x+1 & x>0 \\ -x & x \le 0 \end{cases}",
        r"\left( x+1 \right)^2",
        r"x \le 3 \text{ and } y \ge 2",
    ]
    for t in tests:
        print(t, "  =>  ", latex_to_hwp(t))
