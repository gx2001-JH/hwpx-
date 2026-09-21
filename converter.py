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
# 대문자 그리스 문자는 한글 수식에서도 대문자 키워드로 써야 한다("DELTA" -> Δ).
# 소문자로 내려버리면 Δ가 δ로 바뀌어 뜻이 달라진다(실제로 그런 버그가 있었다).
# LaTeX에 대문자 명령이 있는 글자는 라틴 문자와 모양이 다른 이 11개뿐이다.
UPPER_GREEK = {
    "Gamma": "GAMMA", "Delta": "DELTA", "Theta": "THETA", "Lambda": "LAMBDA",
    "Xi": "XI", "Pi": "PI", "Sigma": "SIGMA", "Upsilon": "UPSILON",
    "Phi": "PHI", "Psi": "PSI", "Omega": "OMEGA",
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
    "mid": "|", "vert": "|", "lvert": "|", "rvert": "|", "Vert": "||",
    "%": "%", "&": "&", "_": "_", "#": "#", "$": "$",
}

# 눈에 보이는 중괄호. 그냥 "{"를 내보내면 한글이 그룹 묶음 기호로 읽어버려서
# 집합 표기 {x | x>0}의 중괄호가 화면에서 사라진다.
LITERAL_BRACES = {"{": "lbrace", "}": "rbrace"}

# 서식/배치만 바꾸는 명령. 한글 수식에는 대응이 없으니 흔적을 남기지 말고 지운다.
# (그대로 두면 "displaystyle" 같은 글자가 수식 안에 찍혀 나온다)
DROP_COMMANDS = {
    "displaystyle", "textstyle", "scriptstyle", "scriptscriptstyle",
    "limits", "nolimits", "left.", "right.", "phantom",
}

# 글꼴만 바꾸는 명령. 인자 내용만 그대로 살린다.
TRANSPARENT_COMMANDS = {
    "mathbb", "mathcal", "mathfrak", "mathsf", "mathtt", "mathnormal", "boxed",
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

# 라틴 문자 런. 대소문자가 섞여 있어도 각각 따로 잡히도록 둘로 나눠 쓴다.
LETTER_RUN_RE = re.compile(r"[A-Z]+|[a-z]+")


def tokenize(s: str):
    return [t for t in TOKEN_RE.findall(s) if t != ""]


def is_single_atom(text: str) -> bool:
    return len(text) == 1


def style_wrap(run: str) -> str:
    """점·선분 이름으로 쓰이는 대문자는 정자체(rm), 변수로 쓰이는 소문자는
    이탤릭(it)으로 서식을 '항상 명시해서' 적용한다.

    rm/it은 뒤따르는 내용까지 계속 영향을 주는 스위치라서, 한쪽만 지정하고
    나머지를 한글 기본 서식에 맡기면 앞에서 쓴 rm이 뒤 소문자까지 정자체로
    만들어버린다. 그래서 대문자·소문자 모두 각자 중괄호로 범위를 묶어
    지정한다."""
    # 키워드와 글자 사이에 공백을 둔다. "{itx}"처럼 붙여 쓰면 한글이 이것을
    # "itx"라는 낱말 하나로 읽어 그대로 찍어버릴 수 있다(대문자는 "rmAB"처럼
    # 붙여도 대소문자가 바뀌는 지점에서 갈라지지만, 소문자끼리는 그 단서가 없다).
    return ("{rm " if run[0].isupper() else "{it ") + run + "}"


def wrap_letter_runs(text: str) -> str:
    return LETTER_RUN_RE.sub(lambda m: style_wrap(m.group(0)), text)


def is_fully_braced(s: str) -> bool:
    """문자열 전체가 중괄호 그룹 하나인지 판정한다 ("{rmAB}" -> True, "{a}+{b}" -> False)."""
    if len(s) < 2 or not s.startswith("{") or not s.endswith("}"):
        return False
    depth = 0
    for i, ch in enumerate(s):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i == len(s) - 1
    return False


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

        def emit_text_run(txt):
            """일반 텍스트 토큰을 방출한다. 라틴 문자 런은 대문자면 {rm...},
            소문자면 {it...}으로 감싸 서식을 명시한다(각각 원자로 취급)."""
            if not LETTER_RUN_RE.search(txt):
                emit_text(txt)
                return
            # "AB^2"은 A·B²이므로, 바로 뒤에 첨자가 오면 마지막 글자만 따로 감싸야
            # 첨자가 마지막 글자에만 붙는다(take_base가 원자 단위로 떼어가기 때문).
            next_is_script = self.peek() in ("^", "_")
            pos = 0
            for m in LETTER_RUN_RE.finditer(txt):
                emit_text(txt[pos:m.start()])
                run = m.group(0)
                if next_is_script and m.end() == len(txt) and len(run) > 1:
                    emit_atom(style_wrap(run[:-1]))
                    emit_atom(style_wrap(run[-1]))
                else:
                    emit_atom(style_wrap(run))
                pos = m.end()
            emit_text(txt[pos:])

        while self.i < self.n:
            tok = self.peek()
            if stop_at_brace and tok == "}":
                break
            self.next()

            if tok in ("^", "_"):
                base = take_base()
                # 조합 기호 "{}_n C_r"처럼 밑이 없는 첨자는 스크립트가 "_"로 시작해
                # 한글이 붙일 대상을 못 찾는다. 빈 그룹을 밑으로 세워준다.
                if not base:
                    base = "{}"
                content, from_braces = self.parse_supsub_arg()
                # 위/아래첨자 뒤에 공백 없이 다른 문자가 바로 이어지면("a_n+b_n") 한글
                # 자체 수식 파서가 첨자 뒤 경계를 잘못 인식해 뒤 내용까지 첨자에
                # 삼켜버리는 문제가 실측으로 확인됐다({} 없이 단일문자를 쓸 때만
                # 발생). 항상 중괄호로 감싸면 이 모호함이 사라진다.
                brace = "{" + content + "}"
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
                rendered = self.render_command(name)
                # 지워야 하는 명령(\limits 등)은 빈 문자열이 온다. 빈 원자를 넣어두면
                # 뒤따르는 첨자가 그 빈 원자에 붙어버려 "sum{}_{k=1}"처럼 상하한이
                # 큰 연산자에서 떨어져 나간다.
                if rendered:
                    emit_command_atom(rendered)
                continue

            if tok.startswith("\\") and len(tok) == 2:
                ch = tok[1]
                if ch in (",", ";", ":", "!", " "):
                    emit_text(" ")
                elif ch in LITERAL_BRACES:
                    emit_text(" " + LITERAL_BRACES[ch] + " ")
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
            emit_text_run(tok)

        return "".join(seg[0] for seg in out)

    def expect(self, tok):
        if self.peek() == tok:
            self.next()
        # 문법이 어긋나도 최대한 관대하게 처리 (예외를 던지지 않음)

    def parse_braced_group(self):
        """다음 토큰이 '{' 여야 하며, 그 내용을 렌더링해 반환."""
        # "\overline {AB}"처럼 명령과 인자 사이에 공백이 있어도 인자로 인식해야 한다.
        # (공백을 인자로 삼아버리면 "bar { }"처럼 빈 강조기호가 만들어진다)
        while self.peek() is not None and self.peek().strip() == "":
            self.next()
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
        if len(tok) > 1:
            # 토크나이저는 "n+b"처럼 특수문자가 아닌 문자들을 한 토큰으로 묶어서
            # 반환하는데, 중괄호 없는 위/아래첨자는 LaTeX 규칙상 문자 1개만 가져가야
            # 한다("a_n+b_n"의 첨자는 "n"뿐, "n+b"가 아님). 나머지는 토큰 스트림에
            # 되돌려 넣어야 그 다음 "+b_n"이 정상적으로 이어서 파싱된다.
            self.tokens.insert(self.i, tok[1:])
            self.n += 1
            tok = tok[0]
        if LETTER_RUN_RE.fullmatch(tok):
            return style_wrap(tok), False
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
            # 중괄호 없이 쓴 경우(\bar A)는 여기서만 서식 처리를 할 수 있다.
            if "{" not in arg and LETTER_RUN_RE.search(arg):
                arg = wrap_letter_runs(arg)
            kw = ACCENTS[name]
            if is_single_atom(arg) or is_fully_braced(arg):
                inner = kw + " " + arg
            else:
                inner = kw + " {" + arg + "}"
            # 강조기호 전체를 중괄호로 한 번 더 묶는다. 그래야 뒤에 붙는 지수가
            # bar가 끝난 뒤에 적용된다("bar {AB}^{2}"는 지수가 bar 안쪽으로
            # 들어간 것처럼 해석될 수 있다).
            return "{" + inner + "}"

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

        if name in DROP_COMMANDS:
            return ""

        if name in TRANSPARENT_COMMANDS:
            return self.parse_braced_group()

        if name in GREEK:
            return name
        if name in VAR_GREEK:
            return VAR_GREEK[name]
        if name in UPPER_GREEK:
            return UPPER_GREEK[name]
        lname = name.lower()
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
