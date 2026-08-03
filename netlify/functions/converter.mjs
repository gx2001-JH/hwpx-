// LaTeX 수식 문자열을 HWP(한글) 수식편집기 문법으로 변환한다.
// converter.py의 1:1 이식본. 로직을 바꾸지 않고 언어만 옮겼다.

const GREEK = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
  "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
  "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
]);
const VAR_GREEK = {
  varepsilon: "epsilon", vartheta: "theta", varpi: "pi",
  varrho: "rho", varsigma: "sigma", varphi: "phi", varkappa: "kappa",
};

const SYMBOL_MAP = {
  times: "times", div: "div", cdot: "cdot", cdotp: "cdot",
  cdots: "cdots", ldots: "cdots", dots: "cdots", dotsc: "cdots",
  vdots: "vdots", ddots: "ddots",
  pm: "+-", mp: "-+", ast: "*", star: "star",
  circ: "circ", bullet: "bullet",
  leq: "<=", le: "<=", geq: ">=", ge: ">=",
  neq: "neq", ne: "neq",
  approx: "approx", sim: "sim", simeq: "simeq", cong: "cong",
  equiv: "equiv", propto: "propto",
  in: "in", notin: "not in", ni: "ni",
  subset: "subset", subseteq: "subseteq",
  supset: "supset", supseteq: "supseteq",
  cup: "UNION", cap: "INTER",
  forall: "FORALL", exists: "exists", nexists: "not exists",
  infty: "infty", partial: "partial", nabla: "nabla",
  emptyset: "phi", varnothing: "phi",
  therefore: "therefore", because: "because",
  angle: "angle", perp: "bot", parallel: "parallel",
  wedge: "wedge", vee: "vee", land: "wedge", lor: "vee",
  lnot: "not", neg: "not",
  oplus: "oplus", ominus: "ominus", otimes: "otimes", oslash: "oslash",
  rightarrow: "->", to: "->", longrightarrow: "->", mapsto: "->",
  leftarrow: "<-", longleftarrow: "<-",
  Rightarrow: "Rightarrow", Leftarrow: "Leftarrow",
  leftrightarrow: "<->", Leftrightarrow: "⇔",
  aleph: "aleph", hbar: "hbar", Re: "Re", Im: "Im",
  prime: "prime", degree: "circ",
  "%": "%", "&": "&", _: "_", "#": "#", $: "$",
};

// 뒤에 아래/위첨자로 상하한이 자연스럽게 붙는 연산자·함수 (별도 처리 불필요, 텍스트로 그대로 출력)
const PASSTHROUGH_WORDS = new Set([
  "sum", "prod", "int", "oint", "lim", "max", "min", "sup", "inf", "gcd",
  "det", "exp", "log", "ln", "lg", "sin", "cos", "tan", "csc", "sec", "cot",
  "sinh", "cosh", "tanh", "arcsin", "arccos", "arctan", "deg", "mod",
]);

const ACCENTS = {
  bar: "bar", overline: "bar",
  vec: "vec", overrightarrow: "vec",
  dot: "dot", ddot: "ddot",
  hat: "hat", widehat: "hat",
  tilde: "tilde", widetilde: "tilde",
  check: "check", breve: "breve",
  acute: "acute", grave: "grave",
  underline: "under",
};

const DELIM_MAP = { "\\{": "{", "\\}": "}", "{": "{", "}": "}" };

const SPACING_COMMANDS = new Set([",", ";", ":", "!", "quad", "qquad", " "]);

const TOKEN_RE = /\\[a-zA-Z]+|\\.|[{}[\]_^&]|[0-9]+\.?[0-9]*|[^\s{}[\]_^&\\]+|\s+/g;

function tokenize(s) {
  const out = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    if (m[0] !== "") out.push(m[0]);
  }
  return out;
}

function isSingleAtom(text) {
  return text.length === 1;
}

function isAlpha(ch) {
  return !!ch && /[A-Za-z]/.test(ch);
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.i = 0;
    this.n = tokens.length;
  }

  peek() {
    return this.i < this.n ? this.tokens[this.i] : null;
  }

  next() {
    const t = this.tokens[this.i];
    this.i += 1;
    return t;
  }

  parseGroupBody(stopAtBrace = true) {
    const out = []; // [text, atomic]

    const emitAtom = (txt) => {
      out.push([txt, true]);
    };

    const emitCommandAtom = (txt) => {
      // \sin\theta 같이 서로 다른 명령이 공백 없이 바로 이어지면
      // 렌더링된 단어들이 뭉쳐 보이므로(sintheta) 명령 결과 사이에만 공백을 끼워 넣는다.
      // (위/아래첨자 밑변수 분리(mc^2 -> m, c^2)에는 적용하면 안 되므로 별도 함수로 분리)
      if (out.length && txt) {
        const prev = out[out.length - 1];
        if (prev[0] && isAlpha(prev[0][prev[0].length - 1]) && isAlpha(txt[0])) {
          out.push([" ", false]);
        }
      }
      out.push([txt, true]);
    };

    const emitText = (txt) => {
      if (!txt) return;
      if (out.length && !out[out.length - 1][1]) {
        out[out.length - 1][0] += txt;
      } else {
        out.push([txt, false]);
      }
    };

    const takeBase = () => {
      if (!out.length) return "";
      const [text, atomic] = out[out.length - 1];
      if (atomic || text.length === 1) {
        out.pop();
        return text;
      }
      out[out.length - 1][0] = text.slice(0, -1);
      return text[text.length - 1];
    };

    while (this.i < this.n) {
      const tok = this.peek();
      if (stopAtBrace && tok === "}") break;
      this.next();

      if (tok === "^" || tok === "_") {
        const base = takeBase();
        const [content] = this.parseSupsubArg();
        // 위/아래첨자 뒤에 공백 없이 다른 문자가 바로 이어지면("a_n+b_n") 한글 자체
        // 수식 파서가 첨자 뒤 경계를 잘못 인식해 뒤 내용까지 첨자에 삼켜버리는
        // 문제가 실측으로 확인됐다({} 없이 단일문자를 쓸 때만 발생). 항상 중괄호로
        // 감싸면 이 모호함이 사라진다.
        const brace = "{" + content + "}";
        const marker = tok === "^" ? "^" : "_";
        emitAtom(base + marker + brace);
        continue;
      }

      if (tok === "{") {
        const inner = this.parseGroupBody(true);
        this.expect("}");
        emitAtom(inner);
        continue;
      }

      if (tok.startsWith("\\") && tok.length > 1 && isAlpha(tok[1])) {
        const name = tok.slice(1);
        emitCommandAtom(this.renderCommand(name));
        continue;
      }

      if (tok.startsWith("\\") && tok.length === 2) {
        const ch = tok[1];
        if ([",", ";", ":", "!", " "].includes(ch)) {
          emitText(" ");
        } else {
          emitText(ch);
        }
        continue;
      }

      if (tok === "[" || tok === "]") {
        emitText(tok);
        continue;
      }

      if (tok.trim() === "") {
        emitText(" ");
        continue;
      }

      // 일반 텍스트/숫자 런
      emitText(tok);
    }

    return out.map((seg) => seg[0]).join("");
  }

  expect(tok) {
    if (this.peek() === tok) this.next();
    // 문법이 어긋나도 최대한 관대하게 처리 (예외를 던지지 않음)
  }

  parseBracedGroup() {
    if (this.peek() === "{") {
      this.next();
      const inner = this.parseGroupBody(true);
      this.expect("}");
      return inner;
    }
    return this.parseSingleToken();
  }

  parseSingleToken() {
    const tok = this.peek();
    if (tok === null) return "";
    if (tok === "{") {
      this.next();
      const inner = this.parseGroupBody(true);
      this.expect("}");
      return inner;
    }
    this.next();
    if (tok.startsWith("\\") && tok.length > 1 && isAlpha(tok[1])) {
      return this.renderCommand(tok.slice(1));
    }
    if (tok.startsWith("\\") && tok.length === 2) {
      return tok[1];
    }
    return tok;
  }

  parseSupsubArg() {
    if (this.peek() === "{") {
      this.next();
      const inner = this.parseGroupBody(true);
      this.expect("}");
      return [inner, true];
    }
    const tok = this.i < this.n ? this.next() : "";
    if (tok.startsWith("\\") && tok.length > 1 && isAlpha(tok[1])) {
      return [this.renderCommand(tok.slice(1)), false];
    }
    if (tok.startsWith("\\") && tok.length === 2) {
      return [tok[1], false];
    }
    if (tok.length > 1) {
      // 토크나이저는 "n+b"처럼 특수문자가 아닌 문자들을 한 토큰으로 묶어서
      // 반환하는데, 중괄호 없는 위/아래첨자는 LaTeX 규칙상 문자 1개만 가져가야
      // 한다("a_n+b_n"의 첨자는 "n"뿐, "n+b"가 아님). 나머지는 토큰 스트림에
      // 되돌려 넣어야 그 다음 "+b_n"이 정상적으로 이어서 파싱된다.
      this.tokens.splice(this.i, 0, tok.slice(1));
      this.n += 1;
      return [tok[0], false];
    }
    return [tok, false];
  }

  renderCommand(name) {
    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      const num = this.parseBracedGroup();
      const den = this.parseBracedGroup();
      return "{" + num + "} over {" + den + "}";
    }

    if (name === "sqrt") {
      let idx = null;
      if (this.peek() === "[") {
        this.next();
        const idxTokens = [];
        while (this.peek() !== null && this.peek() !== "]") {
          idxTokens.push(this.next());
        }
        this.expect("]");
        idx = new Parser(idxTokens).parseGroupBody(false);
      }
      const rad = this.parseBracedGroup();
      if (idx === null) {
        return isSingleAtom(rad) ? "sqrt " + rad : "sqrt {" + rad + "}";
      }
      return "{" + rad + "} ^{1 over {" + idx + "}}";
    }

    if (name in ACCENTS) {
      const arg = this.parseBracedGroup();
      const kw = ACCENTS[name];
      return isSingleAtom(arg) ? kw + " " + arg : kw + " {" + arg + "}";
    }

    if (["text", "mbox", "textrm", "operatorname"].includes(name)) {
      const raw = this.consumeRawGroup();
      return '"' + raw + '"';
    }

    if (name === "mathrm" || name === "rm") {
      const arg = this.parseBracedGroup();
      return "rm {" + arg + "}";
    }

    if (["mathbf", "bf", "boldsymbol"].includes(name)) {
      const arg = this.parseBracedGroup();
      return "bold {" + arg + "}";
    }

    if (name === "mathit" || name === "it") {
      const arg = this.parseBracedGroup();
      return "it {" + arg + "}";
    }

    if (name === "binom") {
      const n = this.parseBracedGroup();
      const k = this.parseBracedGroup();
      return "left ( {" + n + "} atop {" + k + "} right )";
    }

    if (name === "left" || name === "right") {
      const tok = this.i < this.n ? this.next() : "";
      const delim = tok in DELIM_MAP ? DELIM_MAP[tok] : tok;
      return (name === "left" ? "left " : "right ") + delim;
    }

    if (SPACING_COMMANDS.has(name)) {
      return " ";
    }

    if (GREEK.has(name)) return name;
    if (name in VAR_GREEK) return VAR_GREEK[name];
    const lname = name.toLowerCase();
    if (GREEK.has(lname)) return lname;
    if (lname in VAR_GREEK) return VAR_GREEK[lname];

    if (name in SYMBOL_MAP) return SYMBOL_MAP[name];
    if (PASSTHROUGH_WORDS.has(name)) return name;

    // \begin{}, \end{} 은 사전 처리 단계에서 이미 치환되므로 여기 도달하지 않음.
    // 알 수 없는 명령은 이름 그대로 출력 (최선의 노력)
    return name;
  }

  consumeRawGroup() {
    if (this.peek() !== "{") return this.parseSingleToken();
    this.next();
    let depth = 1;
    const buf = [];
    while (this.i < this.n && depth > 0) {
      const tok = this.next();
      if (tok === "{") {
        depth += 1;
        buf.push(tok);
      } else if (tok === "}") {
        depth -= 1;
        if (depth > 0) buf.push(tok);
      } else if (tok.startsWith("\\") && tok.length === 2) {
        buf.push(tok[1]);
      } else if (tok.trim() === "") {
        buf.push("~");
      } else {
        buf.push(tok);
      }
    }
    return buf.join("");
  }
}

function splitTopLevel(s, sep) {
  const parts = [];
  let depth = 0;
  let buf = [];
  let i = 0;
  const n = s.length;
  const seplen = sep.length;
  while (i < n) {
    if (s[i] === "{" || s[i] === "[") {
      depth += 1;
      buf.push(s[i]);
      i += 1;
    } else if (s[i] === "}" || s[i] === "]") {
      depth -= 1;
      buf.push(s[i]);
      i += 1;
    } else if (depth === 0 && s.slice(i, i + seplen) === sep) {
      parts.push(buf.join(""));
      buf = [];
      i += seplen;
    } else {
      buf.push(s[i]);
      i += 1;
    }
  }
  parts.push(buf.join(""));
  return parts;
}

const ENV_RE = /\\begin\{(\w+\*?)\}([\s\S]*?)\\end\{\1\}/g;

const ENV_DELIMS = {
  pmatrix: ["left (", "right )"],
  bmatrix: ["left [", "right ]"],
  Bmatrix: ["left {", "right }"],
  vmatrix: ["left |", "right |"],
  Vmatrix: ["left ||", "right ||"],
  matrix: [null, null],
  smallmatrix: [null, null],
  array: [null, null],
  cases: ["left {", null],
  aligned: [null, null],
  align: [null, null],
  "align*": [null, null],
  eqnarray: [null, null],
  gathered: [null, null],
};

function convertEnvironment(envName, body) {
  const [left, right] = ENV_DELIMS[envName] || [null, null];
  const rows = splitTopLevel(body.trim(), "\\\\");
  const rowStrs = [];
  for (let row of rows) {
    row = row.trim();
    if (!row) continue;
    const cells = splitTopLevel(row, "&");
    const renderedCells = cells.map((c) => latexToHwp(c.trim()));
    rowStrs.push(renderedCells.join(" & "));
  }
  const inner = "matrix{" + rowStrs.join(" # ") + "}";
  if (left && right) return left + " " + inner + " " + right;
  if (left) return left + " " + inner;
  return inner;
}

function preprocessEnvironments(latex) {
  return latex.replace(ENV_RE, (match, envName, body) => {
    const placeholder = convertEnvironment(envName, body);
    return "\x00" + placeholder.replaceAll("\x00", "") + "\x01";
  });
}

export function latexToHwp(latex) {
  latex = latex.trim();
  if (!latex) return "";

  latex = preprocessEnvironments(latex);

  const resultParts = [];
  let pos = 0;
  const markerRe = /\x00([\s\S]*?)\x01/g;
  let m;
  while ((m = markerRe.exec(latex)) !== null) {
    const pre = latex.slice(pos, m.index);
    if (pre) {
      const tokens = tokenize(pre);
      resultParts.push(new Parser(tokens).parseGroupBody(false));
    }
    resultParts.push(m[1]);
    pos = m.index + m[0].length;
  }
  const tail = latex.slice(pos);
  if (tail) {
    const tokens = tokenize(tail);
    resultParts.push(new Parser(tokens).parseGroupBody(false));
  }

  let out = resultParts.join("");
  out = out.replace(/ {2,}/g, " ");
  return out.trim();
}
