// Minimal formula engine (Phase B.5, v1). A dependency-free, no-eval() recursive-descent
// parser + evaluator for arithmetic over same-record fields. Grammar:
//
//   expr    := term (('+' | '-') term)*
//   term    := factor (('*' | '/') factor)*
//   factor  := NUMBER | FIELD | '(' expr ')' | ('-' | '+') factor
//   FIELD   := '{fld:' <field-id> '}'
//
// The AST is validated once at field create/update time (referenced fields must exist and be
// number/currency/percent — enforced by the engine, not here) and evaluated at read time.
// Division by zero or any null/non-numeric operand makes the whole result null.

import { EngineError } from './types'

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------
export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'field'; id: string }
  | { kind: 'unary'; op: '-' | '+'; operand: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
type Token =
  | { t: 'num'; value: number }
  | { t: 'field'; id: string }
  | { t: 'op'; op: '+' | '-' | '*' | '/' }
  | { t: 'lparen' }
  | { t: 'rparen' }

const FIELD_RE = /^\{fld:([^}]+)\}/
const NUM_RE = /^\d+(\.\d+)?/

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]!
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ t: 'op', op: ch })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ t: 'lparen' })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ t: 'rparen' })
      i += 1
      continue
    }
    const rest = src.slice(i)
    const fieldMatch = FIELD_RE.exec(rest)
    if (fieldMatch) {
      const id = fieldMatch[1]!.trim()
      if (!id) throw new EngineError('Formula: empty field reference {fld:}.', 'bad_options')
      tokens.push({ t: 'field', id })
      i += fieldMatch[0].length
      continue
    }
    const numMatch = NUM_RE.exec(rest)
    if (numMatch) {
      tokens.push({ t: 'num', value: Number(numMatch[0]) })
      i += numMatch[0].length
      continue
    }
    throw new EngineError(`Formula: unexpected character "${ch}" at position ${i}.`, 'bad_options')
  }
  return tokens
}

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------
class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  parse(): FormulaNode {
    const node = this.parseExpr()
    if (this.pos !== this.tokens.length) {
      throw new EngineError('Formula: unexpected trailing tokens.', 'bad_options')
    }
    return node
  }

  private parseExpr(): FormulaNode {
    let left = this.parseTerm()
    for (;;) {
      const tok = this.peek()
      if (tok?.t === 'op' && (tok.op === '+' || tok.op === '-')) {
        this.next()
        const right = this.parseTerm()
        left = { kind: 'binary', op: tok.op, left, right }
      } else break
    }
    return left
  }

  private parseTerm(): FormulaNode {
    let left = this.parseFactor()
    for (;;) {
      const tok = this.peek()
      if (tok?.t === 'op' && (tok.op === '*' || tok.op === '/')) {
        this.next()
        const right = this.parseFactor()
        left = { kind: 'binary', op: tok.op, left, right }
      } else break
    }
    return left
  }

  private parseFactor(): FormulaNode {
    const tok = this.peek()
    if (!tok) throw new EngineError('Formula: unexpected end of expression.', 'bad_options')
    if (tok.t === 'op' && (tok.op === '-' || tok.op === '+')) {
      this.next()
      return { kind: 'unary', op: tok.op, operand: this.parseFactor() }
    }
    if (tok.t === 'num') {
      this.next()
      return { kind: 'num', value: tok.value }
    }
    if (tok.t === 'field') {
      this.next()
      return { kind: 'field', id: tok.id }
    }
    if (tok.t === 'lparen') {
      this.next()
      const inner = this.parseExpr()
      const close = this.next()
      if (close?.t !== 'rparen') throw new EngineError('Formula: missing closing parenthesis.', 'bad_options')
      return inner
    }
    throw new EngineError('Formula: expected a number, field, or "(".', 'bad_options')
  }
}

/** Parse an expression to an AST, throwing EngineError('bad_options') on any syntax error. */
export function parseFormula(expression: string): FormulaNode {
  if (typeof expression !== 'string' || !expression.trim()) {
    throw new EngineError('A formula field requires a non-empty options.expression.', 'bad_options')
  }
  const tokens = tokenize(expression)
  if (tokens.length === 0) {
    throw new EngineError('A formula field requires a non-empty options.expression.', 'bad_options')
  }
  return new Parser(tokens).parse()
}

/** The distinct field ids referenced by a parsed formula (for the same-table/type check). */
export function referencedFieldIds(node: FormulaNode): string[] {
  const out = new Set<string>()
  const walk = (n: FormulaNode): void => {
    switch (n.kind) {
      case 'field':
        out.add(n.id)
        break
      case 'unary':
        walk(n.operand)
        break
      case 'binary':
        walk(n.left)
        walk(n.right)
        break
      case 'num':
        break
    }
  }
  walk(node)
  return [...out]
}

/**
 * Evaluate a formula against a record's raw values. Returns a finite number, or null when any
 * operand is null/absent/non-numeric or a division by zero occurs (null propagates upward).
 */
export function evaluateFormula(node: FormulaNode, values: Record<string, unknown>): number | null {
  const evalNode = (n: FormulaNode): number | null => {
    switch (n.kind) {
      case 'num':
        return n.value
      case 'field': {
        const raw = values[n.id]
        if (raw === null || raw === undefined || raw === '') return null
        const num = typeof raw === 'number' ? raw : Number(raw)
        return Number.isFinite(num) ? num : null
      }
      case 'unary': {
        const v = evalNode(n.operand)
        if (v === null) return null
        return n.op === '-' ? -v : v
      }
      case 'binary': {
        const l = evalNode(n.left)
        const r = evalNode(n.right)
        if (l === null || r === null) return null
        switch (n.op) {
          case '+':
            return l + r
          case '-':
            return l - r
          case '*':
            return l * r
          case '/':
            return r === 0 ? null : l / r
        }
      }
    }
  }
  const result = evalNode(node)
  return result !== null && Number.isFinite(result) ? result : null
}
