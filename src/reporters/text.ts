/**
 * 検査結果を人間が読むためのプレーンテキストに整える。
 *
 * 出力は端末にも、パイプの先のファイルにも同じものを流す。色や
 * エスケープシーケンスは一切含めない。エディタや grep がそのまま
 * 扱えるよう、壊れたリンクは 1 件 1 行の `file:line:column` 形式で書く。
 */

import type { CheckResult, Report } from "../types.js";

/** 壊れたリンク 1 件を `file:line:column  target` の 1 行にする。 */
function formatBrokenLine(result: CheckResult): string {
  const { file, line, column, href } = result.link;
  return `${file}:${line}:${column}  ${href}`;
}

/**
 * `Report` を人間が読める文字列にする。
 *
 * 末尾に改行は付けない。呼び出し側が `console.log` に渡すか、
 * 別のテキストと連結するかを選べるようにするため。
 */
export function formatText(report: Report): string {
  const total = report.totalLinks;
  const brokenCount = report.broken.length;

  if (brokenCount === 0) {
    return `No broken links. Checked ${total} ${pluralize(total, "link")} in ${report.checkedFiles} ${pluralize(report.checkedFiles, "file")}.`;
  }

  const lines = report.broken.map(formatBrokenLine);
  lines.push("");
  lines.push(
    `${brokenCount} of ${total} ${pluralize(total, "link")} broken in ${report.checkedFiles} ${pluralize(report.checkedFiles, "file")}.`,
  );
  return lines.join("\n");
}

/** 数に合わせて単数形と複数形を選ぶ。要約の 1 行を英語として読めるようにするためだけの補助。 */
function pluralize(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
