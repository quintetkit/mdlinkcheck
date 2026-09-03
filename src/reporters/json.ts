/**
 * 検査結果を JSON として出力するためのレポーター。
 *
 * ここでは文字列化まではしない。`JSON.stringify` にそのまま渡せる
 * プレーンなオブジェクトを組み立てるところまでを担当する。
 * 文字列にするか、ファイルに書くか、パイプに流すかは呼び出し側が決める。
 */

import type { Report } from "../types.js";

/** 壊れたリンク1件を JSON 出力用に平坦化したもの。 */
export interface JsonBrokenLink {
  /** リンクが書かれていたファイル。検査を開始したディレクトリからの相対パス。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** 1 始まりの桁。 */
  readonly column: number;
  /** 解決できなかったリンク先。`LinkRef.href` をそのまま持つ。 */
  readonly target: string;
}

/** `JSON.stringify` に渡せる形にしたレポート。 */
export interface JsonReport {
  readonly checkedFiles: number;
  readonly totalLinks: number;
  /** 壊れたリンクの一覧。0 件でも空配列を返し、キーは省略しない。 */
  readonly broken: readonly JsonBrokenLink[];
}

/**
 * `Report` を JSON 出力用のオブジェクトに変換する。
 *
 * 出力に含めるのは壊れたリンクだけで、`ok` と `external` は落とす。
 * JSON を読む側が知りたいのは「どこが壊れているか」であって、
 * 検査を通過したリンクの一覧ではないため。
 * 件数の全体像は `checkedFiles` と `totalLinks` が引き受ける。
 *
 * 返す値は入力から切り離した新しい配列・オブジェクトで、
 * `Report` 側の内部構造への参照を漏らさない。
 */
export function toJson(report: Report): JsonReport {
  return {
    checkedFiles: report.checkedFiles,
    totalLinks: report.totalLinks,
    broken: report.broken.map((result) => ({
      file: result.link.file,
      line: result.link.line,
      column: result.link.column,
      target: result.link.href,
    })),
  };
}
