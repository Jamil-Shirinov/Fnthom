// A small TypeScript tokenizer for function signatures on proposal cards, colored like the editor:
// functions, types, parameters, keywords, strings and numbers, with brackets colored by nesting depth.
// Signatures are one line of code the agent wrote, so a scanner is enough; it never parses.

export type TokenKind = "function" | "type" | "variable" | "property" | "keyword" | "string" | "number" | "bracket" | "punctuation" | "space";
export type Token = { text: string; kind: TokenKind; depth?: number };

const KEYWORDS = new Set([
  "async", "await", "const", "let", "var", "function", "return", "new", "typeof", "keyof", "extends", "readonly",
  "in", "of", "as", "is", "export", "import", "from", "default", "void", "null", "undefined", "true", "false", "this",
]);
const PRIMITIVES = new Set(["number", "string", "boolean", "any", "unknown", "never", "object", "bigint", "symbol"]);
const OPEN = "([{<";

const PATTERN = /(\s+)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\d[\d_.]*)|([A-Za-z_$][\w$]*)|(=>|\?\.|\.\.\.)|([()[\]{}<>])|(.)/g;

export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  let depth = 0;
  for (const m of code.matchAll(PATTERN)) {
    const [text, space, str, num, ident, operator, bracket] = m;
    if (space) tokens.push({ text, kind: "space" });
    else if (str) tokens.push({ text, kind: "string" });
    else if (num) tokens.push({ text, kind: "number" });
    else if (ident) tokens.push({ text, kind: "variable" });
    else if (operator) tokens.push({ text, kind: "punctuation" });
    else if (bracket) {
      if (OPEN.includes(bracket)) tokens.push({ text, kind: "bracket", depth: depth++ });
      else tokens.push({ text, kind: "bracket", depth: (depth = Math.max(0, depth - 1)) });
    } else tokens.push({ text, kind: "punctuation" });
  }

  // Classify identifiers from their neighbours.
  const next = (i: number) => tokens.slice(i + 1).find((t) => t.kind !== "space");
  const previous = (i: number) => [...tokens.slice(0, i)].reverse().find((t) => t.kind !== "space");
  tokens.forEach((token, i) => {
    if (token.kind !== "variable") return;
    const after = next(i)?.text;
    const before = previous(i)?.text;
    if (KEYWORDS.has(token.text)) token.kind = "keyword";
    else if (PRIMITIVES.has(token.text)) token.kind = "type";
    else if (after === "(" || (after === "<" && !before)) token.kind = "function";
    else if (/^[A-Z]/.test(token.text)) token.kind = "type";
    else if (before === ".") token.kind = "property";
  });
  return tokens;
}
