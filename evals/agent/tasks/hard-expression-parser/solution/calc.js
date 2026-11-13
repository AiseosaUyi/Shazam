function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Unexpected token '${c}' at position ${i}`);
      toks.push({ t: 'num', v: parseFloat(m[0]), text: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
      toks.push({ t: 'id', v: m[0], text: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if ('+-*/%^(),'.includes(c)) { toks.push({ t: c, v: c, text: c, pos: i }); i++; continue; }
    throw new Error(`Unexpected token '${c}' at position ${i}`);
  }
  toks.push({ t: 'end', v: '', text: '', pos: src.length });
  return toks;
}

function roundHalfAway(x, digits) {
  const f = 10 ** digits;
  const s = Math.sign(x);
  return (s * Math.round(Math.abs(x) * f + Number.EPSILON * Math.abs(x) * f)) / f;
}

const FUNCS = {
  min: (a) => { if (!a.length) throw new Error('min needs at least 1 argument'); return Math.min(...a); },
  max: (a) => { if (!a.length) throw new Error('max needs at least 1 argument'); return Math.max(...a); },
  abs: (a) => { if (a.length !== 1) throw new Error('abs takes 1 argument'); return Math.abs(a[0]); },
  sqrt: (a) => {
    if (a.length !== 1) throw new Error('sqrt takes 1 argument');
    if (a[0] < 0) throw new Error('sqrt of negative number');
    return Math.sqrt(a[0]);
  },
  round: (a) => {
    if (a.length < 1 || a.length > 2) throw new Error('round takes 1 or 2 arguments');
    return roundHalfAway(a[0], a.length === 2 ? a[1] : 0);
  },
};

function evaluate(expr, vars = {}) {
  const toks = tokenize(String(expr));
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const unexpected = (tok) => new Error(tok.t === 'end' ? `Unexpected end of input at position ${tok.pos}` : `Unexpected token '${tok.text}' at position ${tok.pos}`);

  function parseExpr() {
    let v = parseTerm();
    while (peek().t === '+' || peek().t === '-') {
      const op = next().t;
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseUnary();
    while (peek().t === '*' || peek().t === '/' || peek().t === '%') {
      const op = next().t;
      const r = parseUnary();
      if (op === '*') v *= r;
      else {
        if (r === 0) throw new Error('Division by zero');
        v = op === '/' ? v / r : v % r;
      }
    }
    return v;
  }
  function parseUnary() {
    if (peek().t === '-') { next(); return -parseUnary(); }
    if (peek().t === '+') { next(); return parseUnary(); }
    return parsePower();
  }
  function parsePower() {
    const base = parsePrimary();
    if (peek().t === '^') { next(); return base ** parseUnary(); }
    return base;
  }
  function parsePrimary() {
    const tok = next();
    if (tok.t === 'num') return tok.v;
    if (tok.t === '(') {
      const v = parseExpr();
      if (peek().t !== ')') throw new Error(`Expected ')' at position ${peek().pos}`);
      next();
      return v;
    }
    if (tok.t === 'id') {
      if (peek().t === '(') {
        next();
        const args = [];
        if (peek().t !== ')') {
          args.push(parseExpr());
          while (peek().t === ',') { next(); args.push(parseExpr()); }
        }
        if (peek().t !== ')') throw new Error(`Expected ')' at position ${peek().pos}`);
        next();
        if (!Object.prototype.hasOwnProperty.call(FUNCS, tok.v)) throw new Error(`Unknown function: ${tok.v}`);
        return FUNCS[tok.v](args);
      }
      if (!Object.prototype.hasOwnProperty.call(vars, tok.v)) throw new Error(`Unknown variable: ${tok.v}`);
      return Number(vars[tok.v]);
    }
    throw unexpected(tok);
  }

  const v = parseExpr();
  if (peek().t !== 'end') throw unexpected(peek());
  return v;
}

module.exports = { evaluate };
