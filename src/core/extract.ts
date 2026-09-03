/**
 * Markdown から `[text](target)` 形式のリンクを抜き出す。
 *
 * 行単位で走査する。Markdown のリンクはほぼ 1 行で閉じるうえ、行単位なら
 * フェンス（``` / ~~~）の内側とインラインコードの内側を同じ仕組みで
 * 「読まない領域」として扱えるため。複数行にまたがって書かれたリンクは
 * 拾わない。
 */

import type { LinkRef } from "../types.js";

/**
 * リンク1件にマッチする。
 *
 * - リンクテキストには、ネストしたブラケットと、丸ごとのリンク／画像
 *   （`[![img](a.png)](b.md)` のようなバッジ記法）を 1 段だけ許す。
 * - target は `<...>` 形式か、空白と丸括弧を含まない文字列。
 * - target のあとの title（`"..."` `'...'` `(...)`）は読み飛ばす。
 */
const LINK_PATTERN =
  /\[(?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\](?:\([^()]*\))?)*\]\(\s*(<[^<>]*>|[^\s()]*)(?:\s+(?:"[^"]*"|'[^']*'|\([^()]*\)))?\s*\)/g;

/** 行頭のフェンス（``` または ~~~）。1 は記号列、2 は info string。 */
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenFence {
  readonly char: string;
  readonly length: number;
}

/**
 * Markdown 文字列からリンクを抽出する。
 *
 * @param markdown ファイルの中身。
 * @param file `LinkRef.file` にそのまま入れる名前。検査を開始した
 *   ディレクトリからの相対パスを渡す。
 */
export function extractLinks(markdown: string, file: string): LinkRef[] {
  const links: LinkRef[] = [];
  const lines = markdown.split(/\r\n|\n|\r/);
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

    collectFromLine(line, index + 1, file, links);
  }

  return links;
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

function collectFromLine(
  line: string,
  lineNumber: number,
  file: string,
  out: LinkRef[],
): void {
  const code = inlineCodeMask(line);

  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_PATTERN.exec(line)) !== null) {
    const start = match.index;
    const previous = start > 0 ? line[start - 1] : undefined;

    // コードスパンの中、エスケープされた `\[`、画像の `![alt](src)` は取らない。
    // 画像を対象にするかは、このイシューの受け入れ条件の外なので広げない。
    if (code[start] || previous === "\\" || previous === "!") continue;

    out.push({
      file,
      line: lineNumber,
      column: start + 1,
      href: stripAngleBrackets(match[1] ?? ""),
    });
  }
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
