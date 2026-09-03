/**
 * コマンドラインの入口。
 *
 * ここが持つのは「引数を読む」「対象の Markdown を集める」「コアに渡す」
 * 「レポーターの出力を流す」「終了コードを決める」の 5 つだけ。
 * リンクの抽出・解決・整形はすべて `core` と `reporters` にあり、
 * ここで書き直さない。
 *
 * 終了コードは CI から使われる契約なので、意味を 1 箇所に固定する。
 *
 * | code | 意味                                       |
 * |------|--------------------------------------------|
 * | 0    | 壊れたリンクなし                            |
 * | 1    | 壊れたリンクが 1 件以上                     |
 * | 2    | 実行できなかった（パスがない、引数が不正など） |
 *
 * 「壊れたリンクが見つかった」(1) と「検査そのものができなかった」(2) を
 * 分けているのは、CI で前者だけを許容したい場面があるため。
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { checkLinks, createReport, extractLinks } from "./core/index.js";
import { toJson } from "./reporters/json.js";
import { formatText } from "./reporters/text.js";
import type { LinkRef } from "./types.js";

/** 出力先。テストから差し替えられるように引数で受け取る。 */
export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const defaultIo: CliIo = {
  stdout: (text) => console.log(text),
  stderr: (text) => console.error(text),
};

/** 使えるレポーター。`--format` の値と 1 対 1 で対応する。 */
const FORMATS = ["text", "json"] as const;
type Format = (typeof FORMATS)[number];

/** 検査対象とみなす拡張子。 */
const MARKDOWN_EXTENSION = ".md";

/**
 * 再帰の途中で入らないディレクトリ。
 *
 * `node_modules` は依存パッケージの同梱ドキュメントであって利用者が
 * 書いたものではなく、`.git` などのドット始まりはツールの内部状態。
 * どちらも「自分の書いた Markdown を検査する」という目的の外にある。
 */
function isSkippedDirectory(name: string): boolean {
  return name === "node_modules" || name.startsWith(".");
}

const USAGE = [
  "Usage: mdlinkcheck <path> [--format text|json] [--ignore <glob>]...",
  "",
  "Find broken relative links in Markdown files.",
  "",
  "Arguments:",
  "  <path>                A directory to scan recursively, or a single .md file.",
  "",
  "Options:",
  "  --format text|json    Output format. Default: text.",
  "  --ignore <glob>       Skip files matching the glob. Repeatable.",
  "                        `*` matches within one path segment, `**` across",
  "                        segments, `?` a single character. Paths are matched",
  "                        relative to <path>, with `/` separators.",
  "  -h, --help            Show this help.",
  "",
  "Exit codes:",
  "  0  no broken links",
  "  1  one or more broken links",
  "  2  could not run (missing path, bad arguments)",
].join("\n");

type ParsedArgs =
  | {
      readonly kind: "run";
      readonly target: string;
      readonly format: Format;
      /** `--ignore` に渡された glob。書かれた順。指定がなければ空配列。 */
      readonly ignore: readonly string[];
    }
  | { readonly kind: "help" }
  | { readonly kind: "error"; readonly message: string };

/**
 * 引数を読む。
 *
 * 依存を増やさずに済む範囲の小さな手書きパーサにする。受け付ける形は
 * `--format json` と `--format=json` の 2 つ。知らないオプションや
 * 2 つ目のパスは黙って無視せず、エラーとして返す。CI で打ち間違えたまま
 * 「壊れたリンクなし」と報告されるのが一番まずいため。
 *
 * `--ignore` だけは繰り返せる。`--format` のように後勝ちで上書きすると
 * 「複数のディレクトリを除外する」という一番よくある使い方が書けない。
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let target: string | undefined;
  let format: Format = "text";
  const ignore: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";

    if (arg === "-h" || arg === "--help") {
      return { kind: "help" };
    }

    if (arg === "--format" || arg.startsWith("--format=")) {
      let value: string | undefined;
      if (arg === "--format") {
        value = argv[i + 1];
        i += 1;
      } else {
        value = arg.slice("--format=".length);
      }
      if (value === undefined || value === "") {
        return {
          kind: "error",
          message: `--format needs a value (${FORMATS.join(" or ")}).`,
        };
      }
      if (!isFormat(value)) {
        return {
          kind: "error",
          message: `Unknown format: ${value}. Expected ${FORMATS.join(" or ")}.`,
        };
      }
      format = value;
      continue;
    }

    if (arg === "--ignore" || arg.startsWith("--ignore=")) {
      let value: string | undefined;
      if (arg === "--ignore") {
        value = argv[i + 1];
        i += 1;
      } else {
        value = arg.slice("--ignore=".length);
      }
      if (value === undefined || value === "") {
        return {
          kind: "error",
          message: "--ignore needs a value (a glob pattern).",
        };
      }
      ignore.push(value);
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      return { kind: "error", message: `Unknown option: ${arg}` };
    }

    if (target !== undefined) {
      return {
        kind: "error",
        message: `Unexpected argument: ${arg}. Only one path is accepted.`,
      };
    }
    target = arg;
  }

  if (target === undefined || target === "") {
    return { kind: "error", message: "Missing path." };
  }
  return { kind: "run", target, format, ignore };
}

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

/** 正規表現のメタ文字を打ち消す。glob のうち特別扱いしない文字はここを通す。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * glob を正規表現に直す。
 *
 * 必要なのは `*` `**` `?` の 3 つだけなので、ライブラリを足さずに
 * 1 文字ずつ読んで組み立てる。特別扱いしない文字は必ずエスケープする。
 * これを忘れると `--ignore CHANGELOG.md` の `.` が「任意の 1 文字」になり、
 * 意図しないファイルまで静かに検査対象から消える。
 *
 * | glob  | 正規表現    | 意味                             |
 * |-------|-------------|----------------------------------|
 * | `*`   | `[^/]*`     | `/` を跨がない任意の並び          |
 * | `**`  | `.*`        | `/` を跨ぐ任意の並び              |
 * | `?`   | `[^/]`      | `/` 以外の 1 文字                 |
 *
 * ただし `**` の直後に区切りが続く形（二重アスタリスクとスラッシュ）は、
 * 「0 段でもよい」という意味の省略可能なグループに直す。素直に `.*` と
 * 区切りを並べると、ディレクトリが 1 段以上ないと当たらない。それだと
 * 二重アスタリスク付きの `CHANGELOG.md` がルート直下の `CHANGELOG.md` に
 * 当たらず、「どこにあっても除外したい」という書き手の意図から外れる。
 *
 * パス全体との一致を見る（部分一致にしない）。`docs` と書いたときに
 * `docs-old/a.md` まで消えるのを避けるため。前方一致で消したいときは
 * `docs/**` と書く。
 */
function globToRegExp(pattern: string): RegExp {
  let source = "";

  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? "";

    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          source += "(?:.*/)?";
          i += 2;
        } else {
          source += ".*";
          i += 1;
        }
        continue;
      }
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`);
}

/**
 * `--ignore` の glob 群から「このファイルを飛ばすか」を答える関数を作る。
 *
 * 正規表現の組み立てはパターンの数だけで済ませ、ファイルごとにやり直さない。
 * 突き合わせる前に区切りを `/` に揃えるので、Windows で集めた
 * `docs\guide\index.md` も `docs/**` で除外できる。
 */
export function createIgnoreMatcher(
  patterns: readonly string[],
): (relativePath: string) => boolean {
  if (patterns.length === 0) return () => false;

  const matchers = patterns.map(globToRegExp);
  return (relativePath) => {
    const normalized = relativePath.split(path.sep).join("/");
    return matchers.some((matcher) => matcher.test(normalized));
  };
}

/**
 * ディレクトリ配下の Markdown を再帰的に集める。
 *
 * 返すのは `rootDir` からの相対パスで、`LinkRef.file` にそのまま入る。
 * `readdir` の並び順はファイルシステム任せなので名前で整列させ、
 * 同じ入力に対して常に同じ順の出力が出るようにする。
 *
 * ディレクトリへのシンボリックリンクは `isDirectory()` が false なので
 * 自然に辿らない。循環したリンクで無限に潜らないという性質を、
 * 特別な訪問済み集合なしに得られる。
 */
export async function collectMarkdownFiles(rootDir: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const entries = await readdir(path.join(rootDir, relativeDir), {
      withFileTypes: true,
    });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const relativePath = relativeDir
        ? path.join(relativeDir, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) await walk(relativePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(MARKDOWN_EXTENSION)) {
        found.push(relativePath);
      }
    }
  }

  await walk("");
  return found;
}

/**
 * CLI 本体。終了コードを返し、自分では `process.exit` を呼ばない。
 *
 * こうしておくと、テストから子プロセスを起こさずに終了コードを確かめられる。
 * 出力も `io` 経由なので、標準出力を横取りする仕掛けが要らない。
 */
export async function run(
  argv: readonly string[],
  io: CliIo = defaultIo,
): Promise<number> {
  const args = parseArgs(argv);

  if (args.kind === "help") {
    io.stdout(USAGE);
    return 0;
  }
  if (args.kind === "error") {
    io.stderr(`mdlinkcheck: ${args.message}`);
    io.stderr(USAGE);
    return 2;
  }

  const absoluteTarget = path.resolve(args.target);

  let isDirectory: boolean;
  try {
    isDirectory = (await stat(absoluteTarget)).isDirectory();
  } catch {
    io.stderr(`mdlinkcheck: cannot read path: ${args.target}`);
    return 2;
  }

  // ファイル 1 個を渡されたときは、その親を起点にする。リンクは書かれた
  // ファイルの位置を基準に解決されるので、これで挙動が揃う。
  const rootDir = isDirectory ? absoluteTarget : path.dirname(absoluteTarget);
  const found = isDirectory
    ? await collectMarkdownFiles(rootDir)
    : [path.basename(absoluteTarget)];

  // 除外は収集のあとに掛ける。`collectMarkdownFiles` は「そこにある
  // Markdown を返す」だけの関数のままにしておきたいのと、既定の除外
  // （node_modules・ドット始まり）とは掛かる層が違うことを分けて示すため。
  // どちらも読み込みの前なので、除外したファイルは `checkedFiles` に入らない。
  const isIgnored = createIgnoreMatcher(args.ignore);
  const files = found.filter((file) => !isIgnored(file));

  const links: LinkRef[] = [];
  try {
    for (const file of files) {
      const markdown = await readFile(path.join(rootDir, file), "utf8");
      links.push(...extractLinks(markdown, file));
    }
  } catch (error) {
    io.stderr(`mdlinkcheck: ${describeError(error)}`);
    return 2;
  }

  const report = createReport(files.length, checkLinks(links, rootDir));

  io.stdout(
    args.format === "json"
      ? JSON.stringify(toJson(report), null, 2)
      : formatText(report),
  );

  return report.broken.length > 0 ? 1 : 0;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `bin/mdlinkcheck.js` から呼ばれる入口。
 *
 * `process.exit` ではなく `process.exitCode` を立てる。前者は書き出しの
 * 途中でもプロセスを落とすので、パイプの先に出力が届かないことがある。
 */
export async function main(argv: readonly string[]): Promise<void> {
  process.exitCode = await run(argv);
}
