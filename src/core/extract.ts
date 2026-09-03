/**
 * Markdown からリンクを抜き出す。
 *
 * 対応する形式は 2 つ。
 *
 * - インライン形式 `[text](target)`
 * - reference 形式 `[text][ref]` / `[text][]` / `[ref]` と、その定義 `[ref]: target`
 *
 * 行単位で走査する。Markdown のリンクはほぼ 1 行で閉じるうえ、行単位なら
 * フェンス（``` / ~~~）の内側とインラインコードの内側を同じ仕組みで
 * 「読まない領域」として扱えるため。複数行にまたがって書かれたリンクや、
 * target と title が別の行に分かれた定義は拾わない。
 *
 * reference 形式は定義が参照より後ろに書かれることがあるので、走査は 2 周する。
 * 1 周目で定義を集め、2 周目で参照を解決する。定義が見つからない参照は
 * Markdown でも素のテキストになるため、リンクとして扱わない。
 */

import type { LinkRef } from "../types.js";

/**
 * インライン形式のリンク1件にマッチする。
 *
 * - リンクテキストには、ネストしたブラケットと、丸ごとのリンク／画像
 *   （`[![img](a.png)](b.md)` のようなバッジ記法）を 1 段だけ許す。
 * - target は `<...>` 形式か、空白と丸括弧を含まない文字列。
 * - target のあとの title（`"..."` `'...'` `(...)`）は読み飛ばす。
 */
const LINK_PATTERN =
  /\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\](?:\([^()]*\))?)*\]\(\s*(<[^<>]*>|[^\s()]*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;

/**
 * reference 形式のリンク候補にマッチする。
 *
 * 1 はリンクテキスト（`[text]` の中身）、2 は続く `[ref]` の中身。
 * 2 が undefined なら短縮形 `[ref]`、空文字なら短縮形 `[text][]`。
 * リンクテキストの許容範囲は {@link LINK_PATTERN} と揃えてある。
 */
const REFERENCE_PATTERN =
  /\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\](?:\([^()]*\))?)*)\](?:\[((?:[^[\]\\]|\\.)*)\])?/g;

/**
 * 行まるごとを占める定義 `[ref]: target "title"`。
 *
 * インデントは 3 まで。4 以上はコードブロックなので定義にしない。
 * CommonMark では段落の途中に定義を書けないが、ここでは行単位の判定に留める。
 * 段落状態まで持つと、この走査の単純さが失われるわりに実害が小さい。
 */
const DEFINITION_PATTERN =
  /^ {0,3}\[((?:[^[\]\\]|\\.)+)\]:[ \t]*(<[^<>]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/;

/** 行頭のフェンス（``` または ~~~）。1 は記号列、2 は info string。 */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenFence {
  readonly char: string;
  readonly length: number;
}

/** フェンスの外にある行と、その 1 始まりの行番号。 */
interface ContentLine {
  readonly number: number;
  readonly text: string;
}

/** 行の中で見つけたリンク1件の候補。start / end は行頭からの 0 始まりの位置。 */
interface Candidate {
  readonly start: number;
  readonly end: number;
  readonly href: string;
}

/**
 * Markdown 文字列からリンクを抽出する。
 *
 * @param markdown ファイルの中身。
 * @param file `LinkRef.file` にそのまま入れる名前。検査を開始した
 *   ディレクトリからの相対パスを渡す。
 */
export function extractLinks(markdown: string, file: string): LinkRef[] {
  const lines = readContentLines(markdown);
  const definitions = collectDefinitions(lines);
  const links: LinkRef[] = [];

  for (const line of lines) {
    // 定義の行は、Markdown では本文として描かれない。`[ref]: ./a.md` の
    // `[ref]` を短縮形の参照として拾わないよう、行ごと読み飛ばす。
    if (DEFINITION_PATTERN.test(line.text)) continue;
    collectFromLine(line.text, line.number, file, definitions, links);
  }

  return links;
}

/** フェンスの内側を落として、残りの行を行番号つきで返す。 */
function readContentLines(markdown: string): ContentLine[] {
  const lines = markdown.split(/\r\n|\n|\r/);
  const content: ContentLine[] = [];
  let fence: OpenFence | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = FENCE_PATTERN.exec(line);

    if (fence) {
      if (isClosingFence(fenceMatch, fence)) fence = undefined;
      continue;
    }
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      const info = fenceMatch[2] ?? "";
      // バッククォートのフェンスは info string にバッククォートを含められない。
      if (marker.startsWith("~") || !info.includes("`")) {
        fence = { char: marker.slice(0, 1), length: marker.length };
        continue;
      }
    }

    content.push({ number: index + 1, text: line });
  }

  return content;
}

function isClosingFence(
  fenceMatch: RegExpExecArray | null,
  fence: OpenFence,
): boolean {
  if (!fenceMatch) return false;
  const marker = fenceMatch[1] ?? "";
  const rest = fenceMatch[2] ?? "";
  return (
    marker.startsWith(fence.char) &&
    marker.length >= fence.length &&
    rest.trim() === ""
  );
}

/**
 * 定義を集める。キーは正規化したラベル、値は target。
 *
 * 同じラベルが複数あれば最初のものを採用する。CommonMark と同じ扱い。
 */
function collectDefinitions(lines: readonly ContentLine[]): Map<string, string> {
  const definitions = new Map<string, string>();

  for (const line of lines) {
    const match = DEFINITION_PATTERN.exec(line.text);
    if (!match) continue;

    const label = normalizeLabel(match[1] ?? "");
    if (label === "" || definitions.has(label)) continue;

    definitions.set(label, stripAngleBrackets(match[2] ?? ""));
  }

  return definitions;
}

/**
 * ラベルを比較用に正規化する。
 *
 * 大文字小文字を区別せず、前後の空白を落とし、途中の空白の並びは 1 個に潰す。
 */
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function collectFromLine(
  line: string,
  lineNumber: number,
  file: string,
  definitions: ReadonlyMap<string, string>,
  out: LinkRef[],
): void {
  const code = inlineCodeMask(line);
  const candidates = [
    ...inlineCandidates(line, code),
    ...referenceCandidates(line, code, definitions),
  ].sort((a, b) => a.start - b.start);

  // 候補が重なったら左のものを採る。Markdown も左から読んで確定させるため。
  // 同じ位置から始まったときはインライン形式が先（sort が安定なので並びが保たれる）。
  let claimed = -1;
  for (const candidate of candidates) {
    if (candidate.start < claimed) continue;
    claimed = candidate.end;
    out.push({
      file,
      line: lineNumber,
      column: candidate.start + 1,
      href: candidate.href,
    });
  }
}

function inlineCandidates(line: string, code: readonly boolean[]): Candidate[] {
  const found: Candidate[] = [];

  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(line)) !== null) {
    const start = match.index;

    // コードスパンの中、エスケープされた `\[`、画像の `![alt](src)` は取らない。
    // 画像を対象にするかは、このイシューの受け入れ条件の外なので広げない。
    if (isSkipped(line, code, start)) continue;

    found.push({
      start,
      end: start + match[0].length,
      href: stripAngleBrackets(match[1] ?? ""),
    });
  }

  return found;
}

function referenceCandidates(
  line: string,
  code: readonly boolean[],
  definitions: ReadonlyMap<string, string>,
): Candidate[] {
  const found: Candidate[] = [];

  REFERENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_PATTERN.exec(line)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const text = match[1] ?? "";
    const explicit = match[2];

    if (isSkipped(line, code, start)) continue;
    // `[text](...)` はインライン形式の領分。target が壊れていて
    // インライン形式として成立しない場合も、短縮形には落とさない。
    if (explicit === undefined && line[end] === "(") continue;

    // `[text][ref]` は ref、`[text][]` と `[ref]` は text がラベルになる。
    const label = normalizeLabel(
      explicit !== undefined && explicit.trim() !== "" ? explicit : text,
    );
    const href = definitions.get(label);
    // 定義のない参照は Markdown でも素のテキストなので、リンクにしない。
    if (href === undefined) continue;

    found.push({ start, end, href });
  }

  return found;
}

/** リンクとして読まない位置か。コードスパン内、`\[`、画像の `![` が該当する。 */
function isSkipped(
  line: string,
  code: readonly boolean[],
  start: number,
): boolean {
  const previous = start > 0 ? line[start - 1] : undefined;
  return code[start] === true || previous === "\\" || previous === "!";
}

/** `<a b.md>` のような山括弧つき target から括弧を外す。 */
function stripAngleBrackets(target: string): string {
  return target.startsWith("<") && target.endsWith(">")
    ? target.slice(1, -1)
    : target;
}

/**
 * 行の各文字がインラインコードスパンに属するかを返す。
 *
 * CommonMark と同じく、長さ n のバッククォート列は、次に現れる
 * 「ちょうど長さ n」のバッククォート列で閉じる。閉じ側がなければ、
 * その列はただの文字として扱う。
 */
function inlineCodeMask(line: string): boolean[] {
  const mask = new Array<boolean>(line.length).fill(false);
  let i = 0;

  while (i < line.length) {
    if (line[i] === "\\") {
      i += 2;
      continue;
    }
    if (line[i] !== "`") {
      i += 1;
      continue;
    }

    const open = runLength(line, i);
    const close = findClosingRun(line, i + open, open);
    if (close === -1) {
      i += open;
      continue;
    }
    for (let k = i; k < close + open; k += 1) mask[k] = true;
    i = close + open;
  }

  return mask;
}

function runLength(line: string, start: number): number {
  let n = 0;
  while (line[start + n] === "`") n += 1;
  return n;
}

function findClosingRun(line: string, from: number, length: number): number {
  let j = from;
  while (j < line.length) {
    if (line[j] !== "`") {
      j += 1;
      continue;
    }
    const run = runLength(line, j);
    if (run === length) return j;
    j += run;
  }
  return -1;
}
