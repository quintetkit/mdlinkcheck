/**
 * mdlinkcheck が扱う値の型。
 *
 * ここには実装を置かない。リンクの抽出、解決、レポートの各段が
 * 同じ語彙で会話できるようにするための定義だけを持つ。
 */

/** Markdown 内に書かれたリンク1件と、その記述位置。 */
export interface LinkRef {
  /** リンクが書かれていたファイル。検査を開始したディレクトリからの相対パス。 */
  readonly file: string;
  /** 1 始まりの行番号。 */
  readonly line: number;
  /** 1 始まりの桁。リンクの `[` の位置を指す。 */
  readonly column: number;
  /** `[text](target)` の target を、正規化せずそのまま保持したもの。 */
  readonly href: string;
}

/**
 * リンク1件の検査結果。
 *
 * `external` は「検査しなかった」を意味する。`http:` `https:` `mailto:` や
 * アンカーのみの参照が該当する。存在しないことを確かめていないので、
 * `broken` とは区別する必要がある。
 */
export type CheckStatus = "ok" | "broken" | "external";

export interface CheckResult {
  readonly link: LinkRef;
  readonly status: CheckStatus;
  /**
   * 解決後の絶対パス。`status` が `ok` または `broken` のときだけ入る。
   * `external` では解決を試みていないので `undefined`。
   */
  readonly resolvedPath?: string;
}

/** 1回の検査全体の結果。 */
export interface Report {
  /** 読み込んだ Markdown ファイルの数。 */
  readonly checkedFiles: number;
  /** 抽出したリンクの総数。`external` を含む。 */
  readonly totalLinks: number;
  /** 検査したすべてのリンクの結果。入力の出現順。 */
  readonly results: readonly CheckResult[];
  /** `status` が `broken` のものだけを抜き出したもの。0 件でも空配列を返す。 */
  readonly broken: readonly CheckResult[];
}
