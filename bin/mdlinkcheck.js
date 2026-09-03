#!/usr/bin/env node
/**
 * `package.json` の `bin` が指す実行ファイル。
 *
 * ここには判断を置かない。ビルド済みの `dist/cli.js` に引数を渡すだけの
 * 薄い層にしておき、CLI の中身は TypeScript 側の 1 箇所（`src/cli.ts`）に
 * 集める。終了コードも `main` が `process.exitCode` に立てたものをそのまま使う。
 */

import { main } from "../dist/cli.js";

await main(process.argv.slice(2));
