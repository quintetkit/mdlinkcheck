/**
 * 抽出したリンクを検査し、`CheckResult` と `Report` に組み立てる。
 */

import { existsSync } from "node:fs";

import type { CheckResult, LinkRef, Report } from "../types.js";
import { isExternal, resolveHref } from "./resolve.js";

/**
 * パスの存在確認。既定ではファイルシステムを見るが、テストや
 * 別のファイル供給元に差し替えられるように引数で受け取る。
 */
export type ExistsFn = (absolutePath: string) => boolean;

const fileSystemExists: ExistsFn = (absolutePath) => existsSync(absolutePath);

/**
 * リンク1件を検査する。
 *
 * 外部参照は解決も存在確認もしないので `resolvedPath` を持たない。
 * target が空のリンク（`[text]()`）は指す先がないため `broken` とする。
 */
export function checkLink(
  link: LinkRef,
  rootDir: string,
  exists: ExistsFn = fileSystemExists,
): CheckResult {
  if (isExternal(link.href)) {
    return { link, status: "external" };
  }

  const resolvedPath = resolveHref(link.href, link.file, rootDir);
  if (resolvedPath === undefined) {
    return { link, status: "broken" };
  }
  return {
    link,
    status: exists(resolvedPath) ? "ok" : "broken",
    resolvedPath,
  };
}

/** リンクをまとめて検査する。結果は入力の順を保つ。 */
export function checkLinks(
  links: readonly LinkRef[],
  rootDir: string,
  exists: ExistsFn = fileSystemExists,
): CheckResult[] {
  return links.map((link) => checkLink(link, rootDir, exists));
}

/**
 * 検査結果を `Report` にまとめる。
 *
 * `broken` の絞り込みをここ 1 箇所に置き、レポーター側が同じ条件を
 * 書き直さなくて済むようにする。
 */
export function createReport(
  checkedFiles: number,
  results: readonly CheckResult[],
): Report {
  return {
    checkedFiles,
    totalLinks: results.length,
    results: [...results],
    broken: results.filter((result) => result.status === "broken"),
  };
}
