// Builds the function graph from source text with the TypeScript compiler API: which functions,
// methods, routes and entry modules exist, and which of them call each other.
// Pure: it takes file contents, not paths on disk, so tests and the editor share one implementation.

import ts from "typescript";
import type { CodeGraph, GraphEdge, GraphNode, GraphNodeKind, PlannedFunction } from "../shared/schema";
import { contentHash } from "./hash";

export type SourceText = { path: string; content: string };

const ROOT = "/__workspace__/";
const TEST_FILE = /(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/i;
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all", "head", "options", "use"]);

export function isTestPath(path: string): boolean {
  return TEST_FILE.test(path);
}

type Draft = Omit<GraphNode, "status">;

/**
 * Nodes: top-level functions (declarations and const arrow functions), class methods, Express-style
 * route registrations with an inline handler, and a module node for files with top-level calls.
 * Edges: direct calls, calls through an interface or object type a function returns ("dispatch"),
 * and a function registering a route.
 */
export function buildCodeGraph(files: SourceText[], options: { includeTests?: boolean } = {}): Omit<CodeGraph, "builtAt"> {
  const included = files.filter((f) => options.includeTests || !isTestPath(f.path));
  const byName = new Map(included.map((f) => [ROOT + f.path, f.content]));
  const program = ts.createProgram({
    rootNames: [...byName.keys()],
    options: {
      allowJs: true,
      noLib: true,
      noEmit: true,
      types: [],
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
    },
    host: memoryHost(byName),
  });
  const checker = program.getTypeChecker();

  const drafts: Draft[] = [];
  const ids = new Set<string>();
  /** Declarations (and handler functions) that own a graph node. */
  const owners = new Map<ts.Node, string>();
  /** Interface or type alias declarations, keyed to the functions whose return type includes them. */
  const implementers = new Map<ts.Node, Set<string>>();
  /** Names of those declarations per graph node. */
  const returns = new Map<string, Set<string>>();
  const edges = new Map<string, GraphEdge>();
  const skipped: string[] = [];

  const addEdge = (from: string, to: string, kind: GraphEdge["kind"]) => {
    if (from === to) return;
    const key = `${from}->${to}`;
    const existing = edges.get(key);
    // A direct call says more than a dispatch guess; keep the strongest kind for a pair.
    if (existing && (existing.kind === "call" || kind === "dispatch")) return;
    edges.set(key, { id: key, from, to, kind });
  };

  const sources = program.getSourceFiles().filter((sf) => byName.has(sf.fileName));
  for (const sf of sources) {
    const path = sf.fileName.slice(ROOT.length);
    const add = (name: string, kind: GraphNodeKind, range: ts.Node, exported: boolean, docNode?: ts.Node): string => {
      let id = `${path}#${name}`;
      for (let n = 2; ids.has(id); n += 1) id = `${path}#${name}#${n}`;
      ids.add(id);
      const purpose = docNode ? leadingDoc(sf, docNode) : undefined;
      drafts.push({
        id,
        name,
        kind,
        path,
        startLine: sf.getLineAndCharacterOfPosition(range.getStart(sf)).line + 1,
        endLine: sf.getLineAndCharacterOfPosition(range.getEnd()).line + 1,
        exported,
        bodyHash: contentHash(range.getText(sf)),
        ...(purpose ? { purpose, purposeSource: "comment" as const } : {}),
      });
      return id;
    };

    try {
      for (const statement of sf.statements) {
        const exported = hasExport(statement);
        if (ts.isFunctionDeclaration(statement)) {
          const name = statement.name?.text ?? "default";
          const id = existingId(path, name, ids) ?? add(name, "function", statement, exported, statement);
          owners.set(statement, id);
        } else if (ts.isVariableStatement(statement)) {
          for (const decl of statement.declarationList.declarations) {
            const fn = decl.initializer && unwrapFunction(decl.initializer);
            if (!fn || !ts.isIdentifier(decl.name)) continue;
            const id = add(decl.name.text, "function", statement, exported, statement);
            owners.set(decl, id);
            owners.set(fn, id);
          }
        } else if (ts.isClassDeclaration(statement) && statement.name) {
          for (const member of statement.members) {
            const memberName =
              ts.isConstructorDeclaration(member) ? "constructor" : member.name && ts.isIdentifier(member.name) ? member.name.text : undefined;
            const isMethod =
              ts.isMethodDeclaration(member) ||
              ts.isConstructorDeclaration(member) ||
              (ts.isPropertyDeclaration(member) && !!member.initializer && !!unwrapFunction(member.initializer));
            if (!memberName || !isMethod) continue;
            const id = add(`${statement.name.text}.${memberName}`, "method", member, exported, member);
            owners.set(member, id);
            if (ts.isConstructorDeclaration(member)) owners.set(statement, id);
          }
        }
      }
    } catch {
      skipped.push(path);
    }
  }

  // Implementers: functions whose declared or inferred return type includes an interface or type alias.
  for (const [declaration, id] of owners) {
    const fn = functionOf(declaration);
    if (!fn) continue;
    const signature = checker.getSignatureFromDeclaration(fn);
    if (!signature) continue;
    for (const typeDecl of namedTypeDeclarations(signature.getReturnType())) {
      if (!implementers.has(typeDecl)) implementers.set(typeDecl, new Set());
      implementers.get(typeDecl)!.add(id);
      const name = (typeDecl as ts.InterfaceDeclaration | ts.TypeAliasDeclaration).name.text;
      if (!returns.has(id)) returns.set(id, new Set());
      returns.get(id)!.add(name);
    }
  }

  const targetsOf = (callee: ts.Node): { id: string; kind: GraphEdge["kind"] }[] => {
    let symbol = checker.getSymbolAtLocation(callee);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const found: { id: string; kind: GraphEdge["kind"] }[] = [];
    for (const decl of symbol?.declarations ?? []) {
      const direct = owners.get(decl);
      if (direct) {
        found.push({ id: direct, kind: "call" });
        continue;
      }
      const container = decl.parent;
      const typeDecl = ts.isInterfaceDeclaration(container)
        ? container
        : ts.isTypeLiteralNode(container) && ts.isTypeAliasDeclaration(container.parent)
          ? container.parent
          : undefined;
      if (typeDecl) for (const id of implementers.get(typeDecl) ?? []) found.push({ id, kind: "dispatch" });
    }
    return found;
  };

  // Walk every file with an owner stack: calls belong to the nearest enclosing graph node.
  for (const sf of sources) {
    const path = sf.fileName.slice(ROOT.length);
    let moduleId: string | undefined;
    const moduleOwner = () => {
      if (moduleId) return moduleId;
      moduleId = `${path}#(module)`;
      ids.add(moduleId);
      drafts.push({
        id: moduleId,
        name: path.split("/").pop()!,
        kind: isTestPath(path) ? "test" : "module",
        path,
        startLine: 1,
        endLine: sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1,
        exported: false,
        bodyHash: contentHash(sf.text),
      });
      return moduleId;
    };

    const visit = (node: ts.Node, owner: string | undefined) => {
      const own = owners.get(node) ?? owner;

      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        // Top-level code only gets a module node when it actually connects to something.
        const from = () => own ?? moduleOwner();
        const route = ts.isCallExpression(node) ? routeOf(node) : undefined;
        if (route) {
          const id = `${path}#${route.name}`;
          if (!ids.has(id)) {
            ids.add(id);
            drafts.push({
              id,
              name: route.name,
              kind: "route",
              path,
              startLine: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              endLine: sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1,
              exported: false,
              bodyHash: contentHash(node.getText(sf)),
              ...leadingDocField(sf, node.parent),
            });
          }
          addEdge(from(), id, "registers");
          for (const handler of route.handlers) {
            if (ts.isIdentifier(handler)) for (const t of targetsOf(handler)) addEdge(id, t.id, t.kind);
            else owners.set(handler, id);
          }
        } else {
          const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression;
          for (const t of targetsOf(callee)) addEdge(from(), t.id, t.kind);
        }
      } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        for (const t of targetsOf(node.tagName)) addEdge(own ?? moduleOwner(), t.id, t.kind);
      }
      ts.forEachChild(node, (child) => visit(child, owners.get(child) ?? own));
    };
    try {
      ts.forEachChild(sf, (child) => visit(child, owners.get(child)));
    } catch {
      if (!skipped.includes(path)) skipped.push(path);
    }
  }

  const known = new Set(drafts.map((d) => d.id));
  return {
    nodes: drafts.map((d) => {
      const types = returns.get(d.id);
      return { ...d, ...(types ? { returns: [...types].sort() } : {}), status: "unchanged" as const };
    }),
    edges: [...edges.values()].filter((e) => known.has(e.from) && known.has(e.to)),
    skipped,
  };
}

/**
 * Marks what the feature added or changed (against the graph built before implementation) and fills in
 * purposes: the accepted plan first, then the code's own doc comment, then agent descriptions.
 */
export function annotateGraph(
  graph: Omit<CodeGraph, "builtAt">,
  context: { baseline?: Omit<CodeGraph, "builtAt"> | null; planned?: PlannedFunction[]; descriptions?: Record<string, string> },
): Omit<CodeGraph, "builtAt"> {
  const before = new Map((context.baseline?.nodes ?? []).map((n) => [n.id, n]));
  const planned = (context.planned ?? []).filter((f) => f.status === "accepted");
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const previous = before.get(node.id);
      const status = !context.baseline ? "unchanged" : !previous ? "new" : previous.bodyHash === node.bodyHash ? "unchanged" : "changed";
      const plan = planned.find((f) => f.name === node.name && f.path === node.path);
      if (plan) return { ...node, status, purpose: plan.purpose, purposeSource: "plan" as const };
      if (node.purpose) return { ...node, status };
      const described = context.descriptions?.[node.id];
      return described ? { ...node, status, purpose: described, purposeSource: "agent" as const } : { ...node, status };
    }),
  };
}

// ---------------------------------------------------------------- helpers

function memoryHost(files: Map<string, string>): ts.CompilerHost {
  return {
    getSourceFile: (name, version) => {
      const text = files.get(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, version, true, scriptKind(name));
    },
    getDefaultLibFileName: () => "/__lib__/lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => ROOT,
    getDirectories: () => [],
    fileExists: (name) => files.has(name),
    readFile: (name) => files.get(name),
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
  };
}

function scriptKind(name: string): ts.ScriptKind {
  if (/\.tsx$/i.test(name)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(name)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/i.test(name)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function hasExport(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function existingId(path: string, name: string, ids: Set<string>): string | undefined {
  // Overload signatures share the implementation's node.
  const id = `${path}#${name}`;
  return ids.has(id) ? id : undefined;
}

function unwrapFunction(expr: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let current: ts.Expression = expr;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return ts.isArrowFunction(current) || ts.isFunctionExpression(current) ? current : undefined;
}

function functionOf(node: ts.Node): ts.SignatureDeclaration | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
  return undefined;
}

/** Interface and type alias declarations named anywhere in a return type (unions, intersections, Promise-like wrappers). */
function namedTypeDeclarations(type: ts.Type, seen = new Set<ts.Type>()): ts.Node[] {
  if (seen.has(type)) return [];
  seen.add(type);
  const found: ts.Node[] = [];
  const pick = (symbol: ts.Symbol | undefined) => {
    for (const decl of symbol?.declarations ?? []) {
      if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) found.push(decl);
    }
  };
  pick(type.aliasSymbol);
  pick(type.getSymbol());
  if (type.isUnionOrIntersection()) for (const part of type.types) found.push(...namedTypeDeclarations(part, seen));
  for (const arg of type.aliasTypeArguments ?? []) found.push(...namedTypeDeclarations(arg, seen));
  const reference = type as ts.TypeReference;
  if (reference.typeArguments) for (const arg of reference.typeArguments) found.push(...namedTypeDeclarations(arg, seen));
  return found;
}

/** `app.get("/path", handler)` and friends: a string path plus at least one function argument. */
function routeOf(call: ts.CallExpression): { name: string; handlers: ts.Node[] } | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  if (!ROUTE_METHODS.has(method)) return undefined;
  const [first, ...rest] = call.arguments;
  if (!first || !(ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) return undefined;
  const handlers = rest.filter((arg) => unwrapFunction(arg) || ts.isIdentifier(arg)).map((arg) => unwrapFunction(arg) ?? arg);
  if (handlers.length === 0) return undefined;
  return { name: `${method.toUpperCase()} ${first.text}`, handlers };
}

function leadingDocField(sf: ts.SourceFile, node: ts.Node) {
  const purpose = ts.isExpressionStatement(node) ? leadingDoc(sf, node) : undefined;
  return purpose ? { purpose, purposeSource: "comment" as const } : {};
}

/** The comment block directly above a declaration: a JSDoc block or consecutive line comments. */
function leadingDoc(sf: ts.SourceFile, node: ts.Node): string | undefined {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
  if (ranges.length === 0) return undefined;
  const last = ranges[ranges.length - 1]!;
  // A comment separated by a blank line (a file header, say) does not describe this declaration.
  if (sf.text.slice(last.end, node.getStart(sf)).split("\n").length > 2) return undefined;
  let text: string;
  if (last.kind === ts.SyntaxKind.MultiLineCommentTrivia) {
    const raw = sf.text.slice(last.pos, last.end);
    if (!raw.startsWith("/**")) return undefined;
    text = raw
      .replace(/^\/\*\*|\*\/$/g, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, ""))
      .filter((line) => !line.trim().startsWith("@"))
      .join(" ");
  } else {
    // Consecutive // lines with nothing but whitespace between them.
    const lines: string[] = [];
    for (let i = ranges.length - 1; i >= 0; i -= 1) {
      const r = ranges[i]!;
      if (r.kind !== ts.SyntaxKind.SingleLineCommentTrivia) break;
      const next = ranges[i + 1];
      if (next && sf.text.slice(r.end, next.pos).split("\n").length > 2) break;
      lines.unshift(sf.text.slice(r.pos + 2, r.end).trim());
    }
    text = lines.join(" ");
  }
  const cleaned = text.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}
