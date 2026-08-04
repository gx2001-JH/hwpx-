// HWP 프로그램 없이 hwpx 파일을 순수 JavaScript로 생성한다.
// hwpx_builder_web.py의 1:1 이식본.
import * as tpl from "./hwpxTemplates.mjs";
import { latexToHwp } from "./converter.mjs";
import { buildZip } from "./zipWriter.mjs";

function xmlEscape(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const MATH_SPLIT_RE =
  /(?<dd>\$\$(?<dd_body>[\s\S]+?)\$\$)|(?<db>\\\[(?<db_body>[\s\S]+?)\\\])|(?<ib>\\\((?<ib_body>[\s\S]+?)\\\))|(?<id>(?<!\\)\$(?<id_body>(?:[^$\\]|\\.)+?)(?<!\\)\$)/g;

export function splitSegments(text) {
  const segments = [];
  let pos = 0;
  for (const m of text.matchAll(MATH_SPLIT_RE)) {
    if (m.index > pos) {
      segments.push([false, text.slice(pos, m.index)]);
    }
    const g = m.groups;
    const body = g.dd_body ?? g.db_body ?? g.ib_body ?? g.id_body;
    segments.push([true, body]);
    pos = m.index + m[0].length;
  }
  if (pos < text.length) {
    segments.push([false, text.slice(pos)]);
  }
  return segments;
}

export function splitIntoParagraphs(text) {
  const segments = splitSegments(text);
  const paragraphs = [[]];
  for (const [isMath, content] of segments) {
    if (isMath) {
      paragraphs[paragraphs.length - 1].push([true, content]);
    } else {
      const parts = content.split("\n");
      parts.forEach((part, i) => {
        if (i > 0) paragraphs.push([]);
        if (part !== "") paragraphs[paragraphs.length - 1].push([false, part]);
      });
    }
  }
  return paragraphs;
}

const SIZE_TOKEN_RE = /"[^"]*"|[A-Za-z]+|[0-9]+\.?[0-9]*|\s+|./g;

const BASE_H = 975;
const ATOM_W = 600;
const MIN_ATOM_W = 600;
const CHAR_W = 480;
const OP_W = 850;
const SPACE_W = 220;
const KEYWORD_GLYPH_W = 650;

// 하나의 기호 글리프로 렌더링되는 키워드들 (단어 길이와 무관하게 폭이 일정함)
const KEYWORD_GLYPHS = new Set([
  "times", "div", "cdot", "cdots", "vdots", "ddots", "pm", "mp", "circ", "bullet",
  "star", "approx", "sim", "simeq", "cong", "equiv", "propto", "in", "ni", "not",
  "subset", "subseteq", "supset", "supseteq", "UNION", "INTER", "FORALL", "exists",
  "infty", "partial", "nabla", "therefore", "because", "angle", "bot", "parallel",
  "wedge", "vee", "oplus", "ominus", "otimes", "oslash", "aleph", "hbar", "Re", "Im",
  "prime", "neq", "Rightarrow", "Leftarrow", "phi", "theta", "pi", "alpha", "beta",
  "gamma", "delta", "epsilon", "zeta", "eta", "iota", "kappa", "lambda", "mu", "nu",
  "xi", "rho", "sigma", "tau", "upsilon", "chi", "psi", "omega",
  // 함수 이름도 글자 수만큼 넓어지지 않고 압축된 기호처럼 렌더링된다
  // (실측: "sin theta"=1875, "cos x + sin y"=5080 — 문자수 폭 공식보다 훨씬 좁음).
  "sin", "cos", "tan", "csc", "sec", "cot", "sinh", "cosh", "tanh",
  "arcsin", "arccos", "arctan", "log", "ln", "lg", "exp", "max", "min",
  "sup", "inf", "gcd", "det", "deg", "mod",
]);
// 뒤따르는 그룹/토큰에 강세표시를 얹는 접두 키워드 (그 자체는 폭을 거의 차지하지 않음)
const ACCENTS = new Set([
  "bar", "vec", "dot", "ddot", "hat", "tilde", "check", "breve", "acute",
  "grave", "under", "rm", "bold", "it",
]);
// 위/아래첨자(극한)가 붙으면 훨씬 더 큰 세로 공간이 필요한 큰 연산자 기호
const BIG_OPS = new Set(["int", "oint", "sum", "prod", "lim", "iint", "iiint"]);

function szTokenize(script) {
  return script.match(SIZE_TOKEN_RE) || [];
}

function szFindClose(tokens, openIdx) {
  let depth = 1;
  let j = openIdx + 1;
  while (j < tokens.length) {
    if (tokens[j] === "{") depth += 1;
    else if (tokens[j] === "}") {
      depth -= 1;
      if (depth === 0) return j;
    }
    j += 1;
  }
  return tokens.length;
}

function szSplit(tokens, sep) {
  const parts = [];
  let cur = [];
  let depth = 0;
  for (const t of tokens) {
    if (t === "{") depth += 1;
    else if (t === "}") depth -= 1;
    if (t === sep && depth === 0) {
      parts.push(cur);
      cur = [];
    } else {
      cur.push(t);
    }
  }
  parts.push(cur);
  return parts;
}

function isAlnum(ch) {
  return /[A-Za-z0-9]/.test(ch);
}

function szClassifyPlain(tok) {
  if (tok.trim() === "") return [tok.length * SPACE_W, BASE_H, "ws"];
  if (tok.startsWith('"') && tok.endsWith('"')) {
    const text = tok.slice(1, -1);
    return [Math.max(MIN_ATOM_W, text.length * CHAR_W), BASE_H, null];
  }
  if (BIG_OPS.has(tok)) return [KEYWORD_GLYPH_W, BASE_H, "bigop"];
  if (KEYWORD_GLYPHS.has(tok)) return [KEYWORD_GLYPH_W, BASE_H, null];
  if (tok.length === 1 && !isAlnum(tok)) return [OP_W, BASE_H, null];
  return [Math.max(MIN_ATOM_W, tok.length * CHAR_W), BASE_H, null];
}

function szMeasure(tokens) {
  const out = []; // [w, h, tag]
  let i = 0;
  const n = tokens.length;

  const takeBase = () => {
    // "num} over {den"처럼 연산자 앞에 남는 의미 없는 공백 항목은 버리고 진짜
    // 직전 항목(분자 등)을 가져온다 (그렇지 않으면 공백을 분자로 오인하고,
    // 진짜 분자는 그대로 out에 남아 폭에 중복 합산된다).
    while (out.length && out[out.length - 1][2] === "ws") out.pop();
    if (out.length) return out.pop();
    return [0, BASE_H, null];
  };

  const nextArg = (rawIdx) => {
    let idx = rawIdx;
    // 변환기가 만드는 스크립트는 항상 "over {denom}"처럼 키워드와 여는 중괄호 사이에
    // 공백이 하나 있다. 그 공백 토큰을 건너뛰지 않으면 공백 자체를 인자로 오인하고,
    // 진짜 {내용}은 뒤에 남아 별도 항목으로 중복 합산되어 폭이 크게 부풀려진다.
    while (idx < n && /^\s+$/.test(tokens[idx])) idx += 1;
    if (idx < n && tokens[idx] === "{") {
      const j = szFindClose(tokens, idx);
      const [w, h] = szMeasure(tokens.slice(idx + 1, j));
      return [w, h, null, j + 1];
    }
    if (idx < n) {
      const [w, h, tag] = szClassifyPlain(tokens[idx]);
      return [w, h, tag, idx + 1];
    }
    return [ATOM_W, BASE_H, null, idx];
  };

  while (i < n) {
    const tok = tokens[i];

    if (tok === "{") {
      const j = szFindClose(tokens, i);
      const [w, h] = szMeasure(tokens.slice(i + 1, j));
      out.push([w, h, null]);
      i = j + 1;
      continue;
    }

    if (tok === "^" || tok === "_") {
      const [baseW, baseH, baseTag] = takeBase();
      const [cw, ch, , newI] = nextArg(i + 1);
      i = newI;
      let newW, newH;
      if (baseTag === "bigop") {
        // 큰연산자(sum/int/lim 등)의 위·아래첨자는 실제로는 작은 글꼴로 압축되어
        // 렌더링된다. "sum^{n}" 단독과 "sum_{i=1}^{n}" 전체를 실측해 역산해보면
        // 위첨자가 아래첨자보다 조금 더 크게 잡히는데, 이전처럼 두 항목 모두 거의
        // 동일한 큰 고정폭(ch+500)을 매번 더하면 3~4배까지 부풀려졌다(위/아래
        // 첨자가 옆이 아니라 위아래로 쌓이는데 옆으로 이어붙이듯 계산했기 때문).
        if (tok === "^") {
          newH = baseH + Math.max(700, ch * 1.05);
          newW = baseW + Math.max(400, cw * 0.9);
        } else {
          newH = baseH + Math.max(500, ch * 0.65);
          newW = baseW + Math.max(150, cw * 0.10);
        }
      } else {
        // 실측 4건("x^2..", "x^{10}", "log_{2} x", "angle..^{circ}")이 전부
        // baseH+195(=BASE_H*0.20) 근처로 일관되게 나와, 첨자가 붙을 때 실제로
        // 늘어나는 높이는 ch에 크게 비례하지 않는다(계수 0.55는 실측보다 훨씬 컸다).
        const addH1 = Math.max(150, ch * 0.20);
        const addW1 = cw * 0.55 + 100;
        const other = tok === "^" ? "_" : "^";
        if (i < n && tokens[i] === other) {
          // "x^{2}_{i}"처럼 위·아래첨자가 같은 밑에 동시에 붙으면 옆으로
          // 이어붙는 게 아니라 같은 세로줄에 위아래로 쌓인다. 실측(975)이 거의
          // 밑 하나("x"=600)에 첨자 한 칸만 더한 수준이라, 폭은 둘 중 더 넓은
          // 쪽만 차지하고(둘을 더하면 크게 부풀려진다) 높이만 위아래로 쌓이므로
          // 그대로 더한다.
          const [cw2, ch2, , newI2] = nextArg(i + 1);
          i = newI2;
          const addH2 = Math.max(150, ch2 * 0.20);
          const addW2 = cw2 * 0.55 + 100;
          newW = baseW + Math.max(addW1, addW2);
          newH = baseH + addH1 + addH2;
        } else {
          newW = baseW + addW1;
          newH = baseH + addH1;
        }
      }
      out.push([newW, newH, baseTag]);
      continue;
    }

    if (tok === "over" || tok === "atop") {
      const [numW, numH] = takeBase();
      const [denW, denH, , newI] = nextArg(i + 1);
      i = newI;
      const gap = tok === "over" ? 300 : 220;
      out.push([Math.max(numW, denW) * 1.08 + 280, numH + denH + gap, null]);
      continue;
    }

    if (tok === "sqrt") {
      const [cw, ch, , newI] = nextArg(i + 1);
      i = newI;
      out.push([cw + 550, ch + 200, null]);
      continue;
    }

    if (ACCENTS.has(tok)) {
      const [cw, ch, , newI] = nextArg(i + 1);
      i = newI;
      out.push([cw + 150, ch + 200, null]);
      continue;
    }

    if (tok === "matrix") {
      i += 1;
      let inner = [];
      if (i < n && tokens[i] === "{") {
        const j = szFindClose(tokens, i);
        inner = tokens.slice(i + 1, j);
        i = j + 1;
      }
      const rows = szSplit(inner, "#");
      const rowSizes = [];
      for (const row of rows) {
        const cells = szSplit(row, "&");
        let rowW = 0;
        let rowH = BASE_H;
        for (const cell of cells) {
          // 변환기는 항상 "a & b"처럼 구분자 앞뒤에 공백을 넣는데, 셀 앞뒤의 공백
          // 토큰을 벗겨내지 않으면 내용 폭에 공백까지 중복 합산된다.
          let trimmed = cell.slice();
          while (trimmed.length && trimmed[0].trim() === "") trimmed = trimmed.slice(1);
          while (trimmed.length && trimmed[trimmed.length - 1].trim() === "") trimmed = trimmed.slice(0, -1);
          const [cw, ch] = szMeasure(trimmed);
          rowW += cw;
          rowH = Math.max(rowH, ch);
        }
        // 셀 "개수"가 아니라 셀 "사이 간격" 개수(n-1)만큼만 간격을 더한다.
        rowW += 200 * Math.max(0, cells.length - 1);
        rowSizes.push([rowW, rowH]);
      }
      const mw = rowSizes.length ? Math.max(...rowSizes.map(([w]) => w)) : ATOM_W;
      const mh =
        rowSizes.reduce((acc, [, h]) => acc + h, 0) + 250 * Math.max(0, rowSizes.length - 1);
      out.push([mw + 150, mh + 150, null]);
      continue;
    }

    if (tok === "left" || tok === "right") {
      // 변환기는 항상 "left ("처럼 구분 기호 앞에 공백을 하나 넣는데, "다음 토큰"을
      // 그 공백으로 착각해 건너뛰면 진짜 구분 기호(괄호 등)가 그대로 남아 별도의
      // 연산자 폭으로 한 번 더 중복 합산된다.
      i += 1;
      while (i < n && tokens[i].trim() === "") i += 1;
      if (i < n) i += 1; // 진짜 구분 기호 건너뛰기
      out.push([350, BASE_H, null]);
      continue;
    }

    const [w, h, tag] = szClassifyPlain(tok);
    out.push([w, h, tag]);
    i += 1;
  }

  const totalW = out.reduce((acc, [w]) => acc + w, 0);
  const totalH = out.length ? Math.max(...out.map(([, h]) => h)) : BASE_H;
  return [totalW, totalH];
}

export function estimateEquationSize(script) {
  // 실제 한글로 다양한 수식을 렌더링해 얻은 (width, height) 표본에 근사하도록
  // 구성한 추정기. 약간의 여유 배율을 적용하되(과소평가로 인한 텍스트 겹침 방지),
  // 배율을 1.22/1.12로 크게 잡았을 때 36개 실측 샘플 평균이 실제보다 약 11%
  // 더 크게 나와 분수/비교연산 수식에서 우측에 뚜렷한 여백이 생기는 것을
  // 확인했다. 1.10/1.03으로 낮추면 그 평균이 실제값에 훨씬 가까워진다.
  const tokens = szTokenize(script);
  const [w, h] = szMeasure(tokens);
  const width = Math.max(600, Math.trunc(w * 1.10));
  const height = Math.max(975, Math.trunc(h * 1.03));
  return [width, height];
}

// hp:equation의 baseLine(글상자 내 텍스트 기준선 위치, %). 분수/행렬처럼
// 상하로 내용이 쌓이는 수식은 실제 한글에서 66~68 정도로 훨씬 낮게 저장되는데,
// 고정값을 쓰면 그런 수식만 기준선보다 위로 붕 떠 보인다(실제 버그로 확인됨).
// over/atop/matrix가 있으면 낮게, 위아래첨자가 붙는 큰 연산자(int, sum 등)도
// 상하로 내용이 쌓이므로 함께 낮게 잡고, 그 외 단순 한 줄 수식은 높게 둔다.
export function estimateBaseline(script) {
  const tokens = szTokenize(script);
  const tokenSet = new Set(tokens);
  if (tokenSet.has("over") || tokenSet.has("atop") || tokenSet.has("matrix")) {
    return 67;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (BIG_OPS.has(tokens[i]) && (tokens[i + 1] === "^" || tokens[i + 1] === "_" || tokens[i + 2] === "^" || tokens[i + 2] === "_")) {
      return 60;
    }
  }
  return 88;
}

class Counters {
  constructor() {
    this.eqId = 2000000001;
    this.zOrder = 0;
  }
  nextEqId() {
    this.eqId += 1;
    return this.eqId;
  }
  nextZOrder() {
    const z = this.zOrder;
    this.zOrder += 1;
    return z;
  }
}

function equationXml(latex, counters) {
  const script = latexToHwp(latex);
  if (!script) return "";
  const [width, height] = estimateEquationSize(script);
  const baseline = estimateBaseline(script);
  const eqId = counters.nextEqId();
  const zOrder = counters.nextZOrder();
  return (
    `<hp:equation id="${eqId}" zOrder="${zOrder}" numberingType="EQUATION" ` +
    'textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" ' +
    `version="Equation Version 60" baseLine="${baseline}" textColor="#000000" baseUnit="1000" ` +
    'lineMode="CHAR" font="HancomEQN">' +
    `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" ` +
    'heightRelTo="ABSOLUTE" protect="0"/>' +
    '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" ' +
    'holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="PARA" vertAlign="TOP" ' +
    'horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
    '<hp:outMargin left="56" right="56" top="0" bottom="0"/>' +
    "<hp:shapeComment>수식입니다.</hp:shapeComment>" +
    `<hp:script>${xmlEscape(script)}</hp:script>` +
    "</hp:equation>"
  );
}

function paragraphXml(paragraph, counters, secPr = "") {
  if (!paragraph.length && !secPr) {
    return (
      '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" ' +
      'merged="0"><hp:run charPrIDRef="0"/></hp:p>'
    );
  }

  const bodyParts = [];
  for (const [isMath, content] of paragraph) {
    if (isMath) {
      bodyParts.push(equationXml(content, counters));
    } else {
      bodyParts.push(`<hp:t>${xmlEscape(content)}</hp:t>`);
    }
  }

  const runInner = secPr + bodyParts.join("");
  return (
    '<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" ' +
    `merged="0"><hp:run charPrIDRef="0">${runInner}</hp:run></hp:p>`
  );
}

export function buildSectionXml(inputText) {
  const paragraphs = splitIntoParagraphs(inputText);
  const counters = new Counters();

  const parts = [`<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec ${tpl.SECTION_XML_NS}>`];
  paragraphs.forEach((para, i) => {
    const secPr = i === 0 ? tpl.SEC_PR : "";
    parts.push(paragraphXml(para, counters, secPr));
  });
  parts.push("</hs:sec>");
  return parts.join("");
}

export function buildHwpxBytes(inputText, title = "문서") {
  const sectionXml = buildSectionXml(inputText);
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const contentHpf = tpl.contentHpf(xmlEscape(title), created);
  const preview = inputText.replace(/\$+|\\\[|\\\]|\\\(|\\\)/g, "").slice(0, 500);

  const files = [
    { name: "mimetype", data: tpl.MIMETYPE },
    { name: "version.xml", data: tpl.VERSION_XML },
    { name: "settings.xml", data: tpl.SETTINGS_XML },
    { name: "Contents/header.xml", data: tpl.HEADER_XML },
    { name: "Contents/section0.xml", data: sectionXml },
    { name: "Contents/content.hpf", data: contentHpf },
    { name: "META-INF/container.xml", data: tpl.CONTAINER_XML },
    { name: "META-INF/container.rdf", data: tpl.CONTAINER_RDF },
    { name: "META-INF/manifest.xml", data: tpl.MANIFEST_XML },
    { name: "Preview/PrvText.txt", data: preview },
  ];

  return buildZip(files);
}
