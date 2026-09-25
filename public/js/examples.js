// examples.js — 예시 모음. 무엇을 어떻게 쓰면 되는지 갈래별로 하나씩 보여 준다.
//
// 본문은 String.raw 로 감싼다. 그냥 템플릿 문자열에 넣으면 \frac 의 \f 가
// 폼피드로, \n 이 줄바꿈으로 먹혀 LaTeX 가 조용히 망가진다. String.raw 는
// 백슬래시를 글자 그대로 두므로 원문을 그대로 적을 수 있고, 줄바꿈은 진짜
// 줄바꿈을 쓰면 된다.
//
// 딱 하나 주의할 것: String.raw 도 `${` 는 여전히 치환 구문으로 읽는다.
// 조합 기호를 ${}_5 C_2$ 처럼 적으면 파일 전체가 SyntaxError 로 죽는다.
// 빈 밑자리는 {} 없이 $_5 C_2$ 로 적으면 되고(변환기와 KaTeX 모두 처리한다),
// 정말 `${` 가 필요하면 '$' + String.raw`{...}` 로 끊어 붙인다.
// 아래 selfCheck() 가 이 실수를 빌드 없이 잡아 준다.
export const EXAMPLES = [
  {
    name: '이차방정식의 해 (해설 포함)',
    text: String.raw`1. 다음 이차방정식의 해를 구하시오.
$x^2 - 3x + 2 = 0$

[해설]
근의 공식에 의해 $x = \frac{3 \pm \sqrt{9-8}}{2}$ 이므로 $x=1$ 또는 $x=2$ 이다.`,
  },
  {
    name: '정적분 (블록 수식)',
    text: String.raw`2. $0 < \theta < \frac{\pi}{2}$ 이고 $\sin\theta \ge \frac{1}{2}$ 일 때, 다음 값을 구하시오.
$$\int_0^1 x^2 \, dx = \frac{1}{3}$$`,
  },
  {
    name: '객관식 · 보기 ①~⑤',
    text: String.raw`3. 그림과 같이 $\overline{AB} = 3$, $\overline{BC} = 4$이고 $\angle B = \frac{\pi}{2}$인 직각삼각형 $ABC$가 있다. $\overline{AC}$의 길이는? [4점]
① $4$
② $5$
③ $6$
④ $7$
⑤ $8$`,
  },
  {
    name: '집합 기호 · 조건 막대',
    text: String.raw`4. 집합 $A = \{x \mid x^2 - 5x + 6 = 0\}$에 대하여 $n(A)$의 값을 구하시오. [3점]`,
  },
  {
    name: '수열 · 시그마',
    text: String.raw`5. 수열 $\{a_n\}$이 $a_1 = 2$, $a_{n+1} = a_n + 3$을 만족시킬 때, $\sum_{k=1}^{10} a_k$의 값을 구하시오. [4점]`,
  },
  {
    name: '대문자 그리스 · 도형 이름',
    text: String.raw`6. $\Delta ABC$와 $\Delta DEF$에 대하여 $\Delta ABC \equiv \Delta DEF$이고 $\angle A = 50^\circ$, $\angle B = 60^\circ$일 때, $\angle F$의 크기를 구하시오.`,
  },
  {
    name: '경우의 수 · 조합 기호',
    text: String.raw`7. 서로 다른 $5$개의 공에서 $2$개를 고르는 경우의 수 $_5 C_2$의 값을 구하시오.`,
  },
  {
    name: '극한 · 미분계수',
    text: String.raw`8. 함수 $f(x) = x^3 - 2x$에 대하여 $\lim_{h \to 0} \frac{f(1+h) - f(1)}{h}$의 값을 구하시오. [3점]`,
  },
  {
    name: '로그 · 지수',
    text: String.raw`9. $\log_2 8 + \log_3 \frac{1}{9}$의 값은? [3점]
① $-1$
② $0$
③ $1$
④ $2$
⑤ $3$`,
  },
  {
    name: '벡터 · 내적',
    text: String.raw`10. 두 벡터 $\vec{a} = (1, 2)$, $\vec{b} = (3, -1)$에 대하여 $\vec{a} \cdot \vec{b} + |\vec{a}|^2$의 값을 구하시오.`,
  },
  {
    name: '행렬 (여러 줄 배열)',
    text: String.raw`11. 행렬 $A = \begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}$에 대하여 $\det A$의 값을 구하시오.`,
  },
  {
    name: '구간별 정의 함수 (cases)',
    text: String.raw`12. 함수
$$f(x) = \begin{cases} x^2 & (x \ge 0) \\ -x & (x < 0) \end{cases}$$
에 대하여 $f(-2) + f(3)$의 값을 구하시오.`,
  },
  {
    name: '확률 · 조건부확률',
    text: String.raw`13. 두 사건 $A$, $B$에 대하여 $P(A) = \frac{1}{2}$, $P(B \mid A) = \frac{1}{3}$일 때, $P(A \cap B)$의 값은? [4점]`,
  },
  {
    name: '개념 정리 (근과 계수의 관계)',
    text: String.raw`이차방정식의 근과 계수의 관계
이차방정식 $ax^2+bx+c=0$의 두 근을 $\alpha$, $\beta$라 하면
$$\alpha+\beta=-\frac{b}{a}, \quad \alpha\beta=\frac{c}{a}$$
가 성립한다. (단, $a \neq 0$)`,
  },
  {
    name: '표 형식 개념 (대문자 rm · 소문자 it)',
    text: String.raw`정규분포와 표준화
확률변수 $X$가 정규분포 $N(m, \sigma^2)$을 따를 때
$$Z = \frac{X - m}{\sigma}$$
로 놓으면 $Z$는 표준정규분포 $N(0, 1)$을 따른다.
이때 $P(0 \le Z \le 1.96) = 0.475$이다.`,
  },
];

// 실수 방지용 자기 점검. 위 주석의 두 함정(폼피드 같은 제어문자, 남아 있는
// 치환 자취)이 들어오면 콘솔에 바로 알린다. String.raw 를 빠뜨린 항목은
// \f·\n·\t 가 실제 제어문자로 변해 있으므로 그것으로 잡아낼 수 있다.
function selfCheck() {
  const bad = [];
  for (const ex of EXAMPLES) {
    if (/[\f\v\b\0]/.test(ex.text)) bad.push(`${ex.name}: String.raw 없이 적혀 제어문자가 섞였습니다`);
    if (!ex.text.trim()) bad.push(`${ex.name}: 본문이 비었습니다`);
  }
  if (bad.length) console.warn('[examples.js] 점검 실패\n- ' + bad.join('\n- '));
}
selfCheck();
