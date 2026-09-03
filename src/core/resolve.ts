/**
 * リンクの target を「検査しないもの」と「ファイルとして解決するもの」に
 * 分け、後者を絶対パスに直す。
 */

import path from "node:path";

/**
 * 存在確認をしない target のスキーム。
 *
 * 受け入れ条件で挙がっているものだけに限る。ここを「`:` を含むものは
 * すべて外部」と広げると、`C:\...` のような書き間違いや、まだ知らない
 * 相対パスの書き方まで黙って見逃してしまう。
 */
const EXTERNAL_SCHEME = /^(?:https?|mailto):/i;

/**
 * その target を外部参照（＝存在を確かめない）として扱うか。
 *
 * `http://` `https://` `mailto:` で始まるもの、および `#anchor` のように
 * 同一ファイル内のアンカーだけを指すものが該当する。
 */
export function isExternal(href: string): boolean {
  const target = href.trim();
  return target.startsWith("#") || EXTERNAL_SCHEME.test(target);
}

/**
 * target を絶対パスに直す。
 *
 * 相対パスは、そのリンクが書かれていたファイルの位置を基準に解決する。
 * `/` で始まるパスは検査の起点ディレクトリを根として解決する（Markdown を
 * サイトとして配信する書き方に合わせる。ファイルシステムの根ではない）。
 *
 * @param href リンクの target。
 * @param file リンクが書かれていたファイル。`rootDir` からの相対パス。
 * @param rootDir 検査を開始したディレクトリ。
 * @returns 絶対パス。target が空で指す先がないときは `undefined`。
 */
export function resolveHref(
  href: string,
  file: string,
  rootDir: string,
): string | undefined {
  const target = stripFragment(href.trim());
  if (target === "") return undefined;

  const decoded = decodePath(target);
  if (decoded.startsWith("/")) {
    return path.resolve(rootDir, `.${decoded}`);
  }
  return path.resolve(rootDir, path.dirname(file), decoded);
}

/** `a.md#section` の `#section` を落とす。指す先はファイル。 */
function stripFragment(target: string): string {
  const hash = target.indexOf("#");
  return hash === -1 ? target : target.slice(0, hash);
}

/** `%20` などを戻す。壊れたエスケープはそのままの文字列として扱う。 */
function decodePath(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}
