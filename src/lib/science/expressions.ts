/** A bounded arithmetic language. This module never compiles or executes source code. */
export type Expression =
  | { kind: "number"; value: number }
  | { kind: "variable"; name: string }
  | { kind: "unary"; op: "+" | "-"; value: Expression }
  | {
      kind: "binary";
      op: "+" | "-" | "*" | "/" | "^";
      left: Expression;
      right: Expression;
    }
  | { kind: "call"; name: string; args: Expression[] };
type Token = { type: "number" | "name" | "symbol" | "end"; value: string };
const functions: Record<
  string,
  { arity: number; run: (...args: number[]) => number }
> = {
  sin: { arity: 1, run: Math.sin },
  cos: { arity: 1, run: Math.cos },
  tan: { arity: 1, run: Math.tan },
  asin: { arity: 1, run: Math.asin },
  acos: { arity: 1, run: Math.acos },
  atan: { arity: 1, run: Math.atan },
  sinh: { arity: 1, run: Math.sinh },
  cosh: { arity: 1, run: Math.cosh },
  tanh: { arity: 1, run: Math.tanh },
  exp: { arity: 1, run: Math.exp },
  log: { arity: 1, run: Math.log },
  ln: { arity: 1, run: Math.log },
  sqrt: { arity: 1, run: Math.sqrt },
  abs: { arity: 1, run: Math.abs },
  sign: { arity: 1, run: Math.sign },
  floor: { arity: 1, run: Math.floor },
  ceil: { arity: 1, run: Math.ceil },
  min: { arity: 2, run: Math.min },
  max: { arity: 2, run: Math.max },
  atan2: { arity: 2, run: Math.atan2 },
  pow: { arity: 2, run: Math.pow },
};
const constants: Record<string, number> = { pi: Math.PI, e: Math.E };
export const expressionFunctions = Object.keys(functions);
export function validVariable(name: string) {
  return (
    /^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(name) &&
    ![
      "constructor",
      "prototype",
      "__proto__",
      "window",
      "globalThis",
      "document",
      "process",
      "Function",
      "eval",
      "import",
      "require",
    ].includes(name) &&
    !(name in functions) &&
    !(name in constants)
  );
}
function tokenize(source: string): Token[] {
  if (typeof source !== "string" || !source.trim() || source.length > 512)
    throw new Error("Use a mathematical expression of 1–512 characters.");
  const out: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const space = /^\s+/.exec(rest);
    if (space) {
      i += space[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      if (!Number.isFinite(Number(number[0])))
        throw new Error("Numeric constants must be finite.");
      out.push({ type: "number", value: number[0] });
      i += number[0].length;
    } else {
      const name = /^[A-Za-z][A-Za-z0-9_]*/.exec(rest);
      if (name) {
        out.push({ type: "name", value: name[0] });
        i += name[0].length;
      } else if ("+-*/^(),".includes(source[i])) {
        out.push({ type: "symbol", value: source[i++] });
      } else
        throw new Error(
          `Unsupported character at position ${i + 1}. Only arithmetic expressions are allowed.`,
        );
    }
    if (out.length > 256)
      throw new Error("The expression contains too many tokens.");
  }
  return [...out, { type: "end", value: "" }];
}
export function parseExpression(
  source: string,
  variables: string[] = ["x"],
): Expression {
  if (variables.length > 24 || variables.some((n) => !validVariable(n)))
    throw new Error("Invalid variable names.");
  const allowed = new Set(variables),
    tokens = tokenize(source);
  let index = 0,
    nodes = 0;
  const add = (node: Expression) => {
    if (++nodes > 192)
      throw new Error("The expression is too complex (maximum 192 nodes).");
    return node;
  };
  const parse = (minimum = 0, depth = 0): Expression => {
    if (depth > 32) throw new Error("The expression is nested too deeply.");
    const token = tokens[index++];
    let left: Expression;
    if (token.type === "number")
      left = add({ kind: "number", value: Number(token.value) });
    else if (token.value === "+" || token.value === "-")
      left = add({
        kind: "unary",
        op: token.value,
        value: parse(30, depth + 1),
      });
    else if (token.value === "(") {
      left = parse(0, depth + 1);
      if (tokens[index++].value !== ")")
        throw new Error("A closing parenthesis is missing.");
    } else if (token.type === "name") {
      if (tokens[index].value === "(") {
        const fn = functions[token.value];
        if (!fn) throw new Error(`Function ${token.value} is not supported.`);
        index++;
        const args: Expression[] = [];
        if (tokens[index].value !== ")") {
          args.push(parse(0, depth + 1));
          while (tokens[index].value === ",") {
            index++;
            args.push(parse(0, depth + 1));
            if (args.length > 2)
              throw new Error("Functions accept at most two arguments.");
          }
        }
        if (tokens[index++].value !== ")" || args.length !== fn.arity)
          throw new Error(`${token.value} requires ${fn.arity} argument(s).`);
        left = add({ kind: "call", name: token.value, args });
      } else if (Object.hasOwn(constants, token.value))
        left = add({ kind: "number", value: constants[token.value] });
      else {
        if (!allowed.has(token.value))
          throw new Error(`Unknown variable ${token.value}.`);
        left = add({ kind: "variable", name: token.value });
      }
    } else throw new Error("An operand is missing.");
    while (true) {
      const op = tokens[index].value;
      const precedence =
        op === "+" || op === "-"
          ? 10
          : op === "*" || op === "/"
            ? 20
            : op === "^"
              ? 40
              : -1;
      if (precedence < minimum) break;
      index++;
      const right = parse(op === "^" ? precedence : precedence + 1, depth + 1);
      left = add({
        kind: "binary",
        op: op as "+" | "-" | "*" | "/" | "^",
        left,
        right,
      });
    }
    return left;
  };
  const ast = parse();
  if (tokens[index].type !== "end")
    throw new Error(
      "Unexpected input. Use * for multiplication; statements and property access are not allowed.",
    );
  return ast;
}
export function evaluateExpression(
  ast: Expression,
  scope: Record<string, number>,
): number {
  let budget = 4096;
  const visit = (node: Expression): number => {
    if (--budget < 0) throw new Error("Expression evaluation limit exceeded.");
    switch (node.kind) {
      case "number":
        return node.value;
      case "variable": {
        const value = Object.hasOwn(scope, node.name) ? scope[node.name] : NaN;
        if (!Number.isFinite(value))
          throw new Error(`Missing or nonfinite variable ${node.name}.`);
        return value;
      }
      case "unary":
        return node.op === "-" ? -visit(node.value) : visit(node.value);
      case "call":
        return functions[node.name].run(...node.args.map(visit));
      case "binary": {
        const a = visit(node.left),
          b = visit(node.right);
        switch (node.op) {
          case "+":
            return a + b;
          case "-":
            return a - b;
          case "*":
            return a * b;
          case "/":
            return a / b;
          case "^":
            return a ** b;
        }
      }
    }
  };
  return visit(ast);
}
const number = (value: number): Expression => ({ kind: "number", value });
const binary = (
  op: "+" | "-" | "*" | "/" | "^",
  left: Expression,
  right: Expression,
): Expression => simplify({ kind: "binary", op, left, right });
const call = (name: string, ...args: Expression[]): Expression => ({
  kind: "call",
  name,
  args,
});
function count(ast: Expression): number {
  return (
    1 +
    (ast.kind === "binary"
      ? count(ast.left) + count(ast.right)
      : ast.kind === "unary"
        ? count(ast.value)
        : ast.kind === "call"
          ? ast.args.reduce((s, n) => s + count(n), 0)
          : 0)
  );
}
export function simplify(ast: Expression): Expression {
  if (ast.kind === "number" || ast.kind === "variable") return ast;
  if (ast.kind === "unary") {
    const value = simplify(ast.value);
    if (value.kind === "number")
      return number(ast.op === "-" ? -value.value : value.value);
    if (ast.op === "+") return value;
    return { ...ast, value };
  }
  if (ast.kind === "call") {
    const args = ast.args.map(simplify);
    if (args.every((a) => a.kind === "number")) {
      const value = functions[ast.name].run(
        ...args.map((a) => (a as { value: number }).value),
      );
      if (Number.isFinite(value)) return number(value);
    }
    return { ...ast, args };
  }
  const left = simplify(ast.left),
    right = simplify(ast.right);
  const leftN = left.kind === "number" ? left.value : null,
    rightN = right.kind === "number" ? right.value : null;
  if (leftN !== null && rightN !== null) {
    const value = evaluateExpression({ ...ast, left, right }, {});
    if (Number.isFinite(value)) return number(value);
  }
  if (ast.op === "+" && leftN === 0) return right;
  if ((ast.op === "+" || ast.op === "-") && rightN === 0) return left;
  if (ast.op === "*" && (leftN === 0 || rightN === 0)) return number(0);
  if (ast.op === "*" && leftN === 1) return right;
  if ((ast.op === "*" || ast.op === "/") && rightN === 1) return left;
  if (ast.op === "^" && rightN === 1) return left;
  if (ast.op === "^" && rightN === 0) return number(1);
  return { ...ast, left, right };
}
/** Formal derivative on the real differentiable domain of the original expression. */
export function differentiate(ast: Expression, variable = "x"): Expression {
  let work = 0;
  const d = (node: Expression): Expression => {
    if (++work > 2048) throw new Error("The derivative is too complex.");
    let result: Expression;
    if (node.kind === "number") return number(0);
    if (node.kind === "variable") return number(node.name === variable ? 1 : 0);
    if (node.kind === "unary") result = { ...node, value: d(node.value) };
    else if (node.kind === "binary") {
      const a = node.left,
        b = node.right,
        da = d(a),
        db = d(b);
      if (node.op === "+" || node.op === "-") result = binary(node.op, da, db);
      else if (node.op === "*")
        result = binary("+", binary("*", da, b), binary("*", a, db));
      else if (node.op === "/")
        result = binary(
          "/",
          binary("-", binary("*", da, b), binary("*", a, db)),
          binary("^", b, number(2)),
        );
      else if (b.kind === "number")
        result = binary(
          "*",
          binary("*", b, binary("^", a, number(b.value - 1))),
          da,
        );
      else
        result = binary(
          "*",
          binary("^", a, b),
          binary(
            "+",
            binary("*", db, call("log", a)),
            binary("*", b, binary("/", da, a)),
          ),
        );
    } else {
      const a = node.args[0],
        da = d(a);
      let outer: Expression;
      switch (node.name) {
        case "sin":
          outer = call("cos", a);
          break;
        case "cos":
          outer = binary("*", number(-1), call("sin", a));
          break;
        case "tan":
          outer = binary(
            "/",
            number(1),
            binary("^", call("cos", a), number(2)),
          );
          break;
        case "exp":
          outer = call("exp", a);
          break;
        case "log":
        case "ln":
          outer = binary("/", number(1), a);
          break;
        case "sqrt":
          outer = binary(
            "/",
            number(1),
            binary("*", number(2), call("sqrt", a)),
          );
          break;
        case "asin":
          outer = binary(
            "/",
            number(1),
            call("sqrt", binary("-", number(1), binary("^", a, number(2)))),
          );
          break;
        case "acos":
          outer = binary(
            "/",
            number(-1),
            call("sqrt", binary("-", number(1), binary("^", a, number(2)))),
          );
          break;
        case "atan":
          outer = binary(
            "/",
            number(1),
            binary("+", number(1), binary("^", a, number(2))),
          );
          break;
        case "sinh":
          outer = call("cosh", a);
          break;
        case "cosh":
          outer = call("sinh", a);
          break;
        case "tanh":
          outer = binary(
            "/",
            number(1),
            binary("^", call("cosh", a), number(2)),
          );
          break;
        case "abs":
          outer = call("sign", a);
          break;
        case "pow":
          return d(binary("^", a, node.args[1]));
        default:
          throw new Error(
            `A classical symbolic derivative is not available for ${node.name}; use a smooth expression or piecewise analysis.`,
          );
      }
      result = binary("*", outer, da);
    }
    result = simplify(result);
    if (count(result) > 4096)
      throw new Error("The derivative exceeds the symbolic size limit.");
    return result;
  };
  return simplify(d(ast));
}
export function expressionString(ast: Expression): string {
  switch (ast.kind) {
    case "number":
      return Number.isInteger(ast.value)
        ? String(ast.value)
        : String(Number(ast.value.toPrecision(10)));
    case "variable":
      return ast.name;
    case "unary":
      return `${ast.op}(${expressionString(ast.value)})`;
    case "call":
      return `${ast.name}(${ast.args.map(expressionString).join(", ")})`;
    case "binary":
      return `(${expressionString(ast.left)} ${ast.op} ${expressionString(ast.right)})`;
  }
}
