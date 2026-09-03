/**
 * コアの公開口。呼び出し側は個別ファイルではなくここを見る。
 */

export { extractLinks } from "./extract.js";
export { isExternal, resolveHref } from "./resolve.js";
export { checkLink, checkLinks, createReport } from "./check.js";
export type { ExistsFn } from "./check.js";
