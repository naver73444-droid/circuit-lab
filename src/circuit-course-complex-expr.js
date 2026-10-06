// Safe complex-number expression evaluator for the "복소수 계산기" tool (no eval): + − × ÷ ( ) ∠ ° j, sqrt/conj/abs/re/im.
import { add, sub, multiply, divide, conjugate, polar, magnitude, rectangularPolar } from './circuit-course-model.js';
import { sqrtComplex } from './circuit-course-complex.js';

const MAX_LENGTH = 200, MAX_DEPTH = 24;
const FUNCTIONS = {
  sqrt: sqrtComplex, conj: conjugate, abs: z => ({ re: magnitude(z), im: 0 }), re: z => ({ re: z.re, im: 0 }), im: z => ({ re: z.im, im: 0 })
};
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i;

function tokenize(text) {
  const source = text.replace(/\s+/g, '').replace(/−/g, '-').replace(/[×·*]/g, '*').replace(/÷/g, '/').replace(/[<∠]/g, '∠').replace(/deg/gi, '°').replace(/√/g, 'sqrt');
  const tokens = [];
  for (let at = 0; at < source.length;) {
    const rest = source.slice(at), c = source[at];
    const number = NUMBER.exec(rest);
    if (number) { tokens.push({ type: 'num', value: Number(number[0]) }); at += number[0].length; continue; }
    const word = /^[a-z]+/i.exec(rest);
    if (word) {
      const name = word[0].toLowerCase();
      if (name === 'j' || name === 'i') { tokens.push({ type: 'j' }); at += 1; continue; }
      // "j4" must not swallow letters: split a leading j off a longer word only when it is exactly j/i.
      if (!Object.hasOwn(FUNCTIONS, name)) throw new RangeError('알 수 없는 이름입니다: ' + word[0] + ' (지원: j, sqrt, conj, abs, re, im).');
      tokens.push({ type: 'fn', name }); at += word[0].length; continue;
    }
    if ('+-*/()∠°'.includes(c)) { tokens.push({ type: c }); at += 1; continue; }
    throw new RangeError('허용되지 않는 문자입니다: ' + c);
  }
  return tokens;
}

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; this.depth = 0; }
  peek() { return this.t[this.i]; }
  take() { return this.t[this.i++]; }
  fail(message) { throw new RangeError(message); }
  expression() {
    if (++this.depth > MAX_DEPTH) this.fail('식이 너무 깊게 중첩되었습니다.');
    let value = this.term();
    while (this.peek() && (this.peek().type === '+' || this.peek().type === '-')) {
      const op = this.take().type, right = this.term();
      value = op === '+' ? add(value, right) : sub(value, right);
    }
    this.depth--;
    return value;
  }
  term() {
    let value = this.unary();
    for (;;) {
      const next = this.peek();
      if (!next) return value;
      if (next.type === '*' || next.type === '/') {
        this.take();
        const right = this.unary();
        if (next.type === '/' && magnitude(right) === 0) this.fail('0으로 나눌 수 없습니다.');
        value = next.type === '*' ? multiply(value, right) : divide(value, right);
      } else if (next.type === '(' || next.type === 'fn') value = multiply(value, this.unary());
      else return value;
    }
  }
  unary() {
    const next = this.peek();
    if (next && (next.type === '+' || next.type === '-')) {
      this.take();
      const value = this.unary();
      return next.type === '-' ? { re: -value.re, im: -value.im } : value;
    }
    return this.primary();
  }
  angle() {
    let sign = 1;
    if (this.peek()?.type === '-') { this.take(); sign = -1; } else if (this.peek()?.type === '+') this.take();
    const number = this.take();
    if (number?.type !== 'num') this.fail('∠ 뒤에는 각도(도)를 써야 합니다.');
    if (this.peek()?.type === '°') this.take();
    return sign * number.value;
  }
  primary() {
    const token = this.take();
    if (!token) this.fail('식이 끝나기 전에 값이 필요합니다.');
    if (token.type === '(') {
      const value = this.expression();
      if (this.take()?.type !== ')') this.fail('닫는 괄호가 필요합니다.');
      return value;
    }
    if (token.type === 'fn') {
      if (this.take()?.type !== '(') this.fail(token.name + ' 뒤에는 ( ) 가 필요합니다.');
      const value = this.expression();
      if (this.take()?.type !== ')') this.fail('닫는 괄호가 필요합니다.');
      return FUNCTIONS[token.name](value);
    }
    if (token.type === 'j') {
      if (this.peek()?.type === 'num') return { re: 0, im: this.take().value };
      return { re: 0, im: 1 };
    }
    if (token.type === 'num') {
      if (this.peek()?.type === '∠') { this.take(); return polar(token.value, this.angle()); }
      if (this.peek()?.type === 'j') { this.take(); return { re: 0, im: token.value }; }
      return { re: token.value, im: 0 };
    }
    return this.fail('여기에는 숫자, j, 괄호가 올 수 없는 기호입니다.');
  }
}

export function evaluateComplexExpression(text) {
  try {
    const source = String(text ?? '');
    if (!source.trim()) throw new RangeError('식을 입력하세요. 예: sqrt(40∠50° + 20∠-30°)');
    if (source.length > MAX_LENGTH) throw new RangeError('식은 ' + MAX_LENGTH + '자 이하여야 합니다.');
    const parser = new Parser(tokenize(source));
    const value = parser.expression();
    if (parser.peek()) throw new RangeError('식을 끝까지 읽지 못했습니다. 연산자나 괄호를 확인하세요.');
    if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) throw new RangeError('결과가 수치 범위를 벗어났습니다.');
    return { status: 'valid', value, polar: rectangularPolar(value) };
  } catch (e) { return { status: 'invalid', reason: e.message }; }
}
