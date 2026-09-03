import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createIgnoreMatcher, parseArgs, run, type CliIo } from "./cli.js";

/**
 * 実際のファイルシステムを使う。
 *
 * CLI の受け入れ条件は「ディレクトリを再帰的に検査する」「存在しない
 * パスで 2 を返す」なので、走査そのものが検査対象になる。ここを偽物に
 * 差し替えると、確かめたい部分がテストから消える。
 */
let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mdlinkcheck-cli-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 出力を溜めるだけの `CliIo`。行ごとに配列へ入れる。 */
function captureIo(): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
}

async function write(relativePath: string, content: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

describe("run", () => {
  it("壊れたリンクがなければ 0 を返す", async () => {
    await write("target.md", "# target\n");
    await write("index.md", "See [target](./target.md).\n");
    const io = captureIo();

    expect(await run([root], io)).toBe(0);
    expect(io.err).toEqual([]);
    expect(io.out.join("\n")).toContain("No broken links.");
  });

  it("壊れたリンクが 1 件以上あれば 1 を返す", async () => {
    await write("index.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root], io)).toBe(1);
    expect(io.out.join("\n")).toContain("index.md:1:5");
    expect(io.out.join("\n")).toContain("./gone.md");
  });

  it("存在しないパスなら 2 とエラーメッセージを返す", async () => {
    const io = captureIo();
    const missing = path.join(root, "no-such-dir");

    expect(await run([missing], io)).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain("cannot read path");
  });

  it("サブディレクトリまで再帰的に検査する", async () => {
    await write("docs/guide/index.md", "See [missing](./missing.md).\n");
    await write("docs/ok.md", "Back to [root](../top.md).\n");
    await write("top.md", "# top\n");
    const io = captureIo();

    expect(await run([root], io)).toBe(1);
    const output = io.out.join("\n");
    // 3 ファイルすべてを読み、壊れているのは 1 件だけ。
    expect(output).toContain("1 of 2 links broken in 3 files.");
    expect(output).toContain(path.join("docs", "guide", "index.md"));
  });

  it("node_modules とドット始まりのディレクトリには入らない", async () => {
    await write("index.md", "# fine\n");
    await write("node_modules/pkg/README.md", "[x](./nope.md)\n");
    await write(".hidden/notes.md", "[y](./nope.md)\n");
    const io = captureIo();

    expect(await run([root], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("--format json で JSON を出す", async () => {
    await write("index.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--format", "json"], io)).toBe(1);
    expect(JSON.parse(io.out.join("\n"))).toEqual({
      checkedFiles: 1,
      totalLinks: 1,
      broken: [{ file: "index.md", line: 1, column: 5, target: "./gone.md" }],
    });
  });

  it("--format=json も同じように扱う", async () => {
    await write("index.md", "# fine\n");
    const io = captureIo();

    expect(await run([root, "--format=json"], io)).toBe(0);
    expect(JSON.parse(io.out.join("\n"))).toEqual({
      checkedFiles: 1,
      totalLinks: 0,
      broken: [],
    });
  });

  it("既定のフォーマットは text", async () => {
    await write("index.md", "# fine\n");
    const io = captureIo();

    await run([root], io);
    expect(io.out.join("\n")).toBe(
      "No broken links. Checked 0 links in 1 file.",
    );
  });

  it("ファイル 1 個を渡すと、その親を起点に解決する", async () => {
    await write("docs/index.md", "Up to [top](../top.md).\n");
    await write("top.md", "# top\n");
    const io = captureIo();

    expect(await run([path.join(root, "docs", "index.md")], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("外部リンクは壊れているとみなさない", async () => {
    await write("index.md", "[a](https://example.com) [b](#anchor)\n");
    const io = captureIo();

    expect(await run([root], io)).toBe(0);
    expect(io.out.join("\n")).toContain("Checked 2 links");
  });

  it("引数が不正なら 2 と使い方を返す", async () => {
    const io = captureIo();

    expect(await run([root, "--format", "yaml"], io)).toBe(2);
    expect(io.err.join("\n")).toContain("Unknown format: yaml");
    expect(io.err.join("\n")).toContain("Usage: mdlinkcheck");
  });

  it("パスがなければ 2 を返す", async () => {
    const io = captureIo();

    expect(await run([], io)).toBe(2);
    expect(io.err.join("\n")).toContain("Missing path.");
  });

  it("--help は 0 で使い方を出す", async () => {
    const io = captureIo();

    expect(await run(["--help"], io)).toBe(0);
    expect(io.out.join("\n")).toContain("Usage: mdlinkcheck");
    expect(io.err).toEqual([]);
  });

  it("--help は --ignore の説明を含む", async () => {
    const io = captureIo();

    expect(await run(["--help"], io)).toBe(0);
    expect(io.out.join("\n")).toContain("--ignore <glob>");
  });
});

/**
 * `--ignore` の受け入れ条件。
 *
 * 見たいのは「壊れたリンクを持つファイルを除外すると 0 で終わる」ことと
 * 「除外したファイルが `checkedFiles` に数えられない」ことの 2 つ。
 * 前者だけだと、読んだうえで結果を捨てているのか、そもそも読んでいないのかを
 * 区別できないので、件数を JSON で直接見る。
 */
describe("run --ignore", () => {
  it("一致したファイルを検査対象から外す", async () => {
    await write("index.md", "# fine\n");
    await write("CHANGELOG.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--ignore", "CHANGELOG.md"], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("除外したファイルは checkedFiles に数えない", async () => {
    await write("index.md", "# fine\n");
    await write("CHANGELOG.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(
      await run([root, "--ignore", "CHANGELOG.md", "--format", "json"], io),
    ).toBe(0);
    expect(JSON.parse(io.out.join("\n"))).toEqual({
      checkedFiles: 1,
      totalLinks: 0,
      broken: [],
    });
  });

  it("--ignore=<glob> の形も同じように扱う", async () => {
    await write("index.md", "# fine\n");
    await write("CHANGELOG.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--ignore=CHANGELOG.md"], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("複数回指定できる", async () => {
    await write("index.md", "# fine\n");
    await write("a/broken.md", "See [gone](./gone.md).\n");
    await write("b/broken.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--ignore", "a/**", "--ignore", "b/**"], io)).toBe(
      0,
    );
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("複数指定のうち一致しなかった側は除外しない", async () => {
    await write("a/broken.md", "See [gone](./gone.md).\n");
    await write("b/broken.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--ignore", "a/**", "--format", "json"], io)).toBe(
      1,
    );
    const report = JSON.parse(io.out.join("\n"));
    expect(report.checkedFiles).toBe(1);
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0].file).toBe(path.join("b", "broken.md"));
  });

  it("* はスラッシュを跨がない", async () => {
    await write("top.md", "See [gone](./gone.md).\n");
    await write("docs/nested.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    // `*.md` はルート直下の top.md にだけ当たり、docs/nested.md は残る。
    expect(await run([root, "--ignore", "*.md", "--format", "json"], io)).toBe(
      1,
    );
    const report = JSON.parse(io.out.join("\n"));
    expect(report.checkedFiles).toBe(1);
    expect(report.broken[0].file).toBe(path.join("docs", "nested.md"));
  });

  it("** はスラッシュを跨ぐ", async () => {
    await write("index.md", "# fine\n");
    await write("docs/guide/deep/broken.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--ignore", "docs/**"], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("? は 1 文字に当たる", async () => {
    await write("a1.md", "See [gone](./gone.md).\n");
    await write("a2.md", "See [gone](./gone.md).\n");
    await write("a10.md", "# fine\n");
    const io = captureIo();

    // `a?.md` は a1.md と a2.md に当たり、2 文字の a10.md には当たらない。
    expect(await run([root, "--ignore", "a?.md", "--format", "json"], io)).toBe(
      0,
    );
    expect(JSON.parse(io.out.join("\n")).checkedFiles).toBe(1);
  });

  it("既定の除外は --ignore を指定しても効いたままになる", async () => {
    await write("index.md", "# fine\n");
    await write("node_modules/pkg/README.md", "[x](./nope.md)\n");
    await write(".hidden/notes.md", "[y](./nope.md)\n");
    await write("CHANGELOG.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(await run([root, "--ignore", "CHANGELOG.md"], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("既定の除外は --ignore がなくても効いたままになる", async () => {
    await write("index.md", "# fine\n");
    await write("node_modules/pkg/README.md", "[x](./nope.md)\n");
    await write(".hidden/notes.md", "[y](./nope.md)\n");
    const io = captureIo();

    expect(await run([root], io)).toBe(0);
    expect(io.out.join("\n")).toContain("in 1 file.");
  });

  it("ファイル 1 個を渡したときにも除外が効く", async () => {
    await write("docs/index.md", "See [gone](./gone.md).\n");
    const io = captureIo();

    expect(
      await run(
        [path.join(root, "docs", "index.md"), "--ignore", "index.md"],
        io,
      ),
    ).toBe(0);
    expect(io.out.join("\n")).toContain("in 0 files.");
  });

  it("値のない --ignore は 2 とエラーメッセージを返す", async () => {
    const io = captureIo();

    expect(await run([root, "--ignore"], io)).toBe(2);
    expect(io.out).toEqual([]);
    expect(io.err.join("\n")).toContain("--ignore needs a value");
    expect(io.err.join("\n")).toContain("Usage: mdlinkcheck");
  });

  it("--ignore= も値なしとして 2 を返す", async () => {
    const io = captureIo();

    expect(await run([root, "--ignore="], io)).toBe(2);
    expect(io.err.join("\n")).toContain("--ignore needs a value");
  });
});

/**
 * glob の展開そのもの。
 *
 * `run` 経由だと 1 件ごとに一時ディレクトリを作ることになるので、
 * 記号の意味とエスケープの確認はここでまとめて行う。
 */
describe("createIgnoreMatcher", () => {
  it("パターンがなければ何も除外しない", () => {
    const isIgnored = createIgnoreMatcher([]);

    expect(isIgnored("index.md")).toBe(false);
    expect(isIgnored("docs/guide/index.md")).toBe(false);
  });

  it("パス全体と一致したときだけ除外する", () => {
    const isIgnored = createIgnoreMatcher(["docs"]);

    expect(isIgnored("docs")).toBe(true);
    // 前方一致で消さない。消したければ `docs/**` と書く。
    expect(isIgnored("docs-old/a.md")).toBe(false);
    expect(isIgnored("docs/a.md")).toBe(false);
  });

  it("* はスラッシュを跨がない", () => {
    const isIgnored = createIgnoreMatcher(["docs/*.md"]);

    expect(isIgnored("docs/a.md")).toBe(true);
    expect(isIgnored("docs/guide/a.md")).toBe(false);
  });

  it("** はスラッシュを跨ぐ", () => {
    const isIgnored = createIgnoreMatcher(["docs/**"]);

    expect(isIgnored("docs/a.md")).toBe(true);
    expect(isIgnored("docs/guide/deep/a.md")).toBe(true);
    expect(isIgnored("other/a.md")).toBe(false);
  });

  it("先頭の ** はディレクトリ 0 段にも当たる", () => {
    const isIgnored = createIgnoreMatcher(["**/CHANGELOG.md"]);

    expect(isIgnored("CHANGELOG.md")).toBe(true);
    expect(isIgnored("docs/CHANGELOG.md")).toBe(true);
    expect(isIgnored("a/b/c/CHANGELOG.md")).toBe(true);
    expect(isIgnored("CHANGELOG.md.bak")).toBe(false);
  });

  it("? はスラッシュ以外の 1 文字に当たる", () => {
    const isIgnored = createIgnoreMatcher(["a?.md"]);

    expect(isIgnored("a1.md")).toBe(true);
    expect(isIgnored("a.md")).toBe(false);
    expect(isIgnored("a10.md")).toBe(false);
    expect(isIgnored("a/.md")).toBe(false);
  });

  it("正規表現のメタ文字をエスケープする", () => {
    // `.` が「任意の 1 文字」に化けると axmd まで消える。
    expect(createIgnoreMatcher(["a.md"])("axmd")).toBe(false);
    expect(createIgnoreMatcher(["a.md"])("a.md")).toBe(true);

    // 記号を含む名前も、そのまま書いてそのまま当たる。
    const isIgnored = createIgnoreMatcher(["notes(1)+draft[v2].md"]);
    expect(isIgnored("notes(1)+draft[v2].md")).toBe(true);
    expect(isIgnored("notesXX1XXdraftXvX2X.md")).toBe(false);

    // `$` や `^` を書いても、位置ではなく文字として扱う。
    expect(createIgnoreMatcher(["a$b.md"])("a$b.md")).toBe(true);
    expect(createIgnoreMatcher(["a$b.md"])("ab.md")).toBe(false);
  });

  it("いずれか 1 つに当たれば除外する", () => {
    const isIgnored = createIgnoreMatcher(["a/**", "b/**"]);

    expect(isIgnored("a/x.md")).toBe(true);
    expect(isIgnored("b/y.md")).toBe(true);
    expect(isIgnored("c/z.md")).toBe(false);
  });

  it("OS の区切りで来たパスも / のパターンで除外できる", () => {
    const isIgnored = createIgnoreMatcher(["docs/**"]);

    expect(isIgnored(path.join("docs", "guide", "index.md"))).toBe(true);
  });
});

describe("parseArgs", () => {
  it("パスとフォーマットを読む", () => {
    expect(parseArgs(["./docs", "--format", "json"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "json",
      ignore: [],
    });
  });

  it("フォーマットの既定は text", () => {
    expect(parseArgs(["./docs"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "text",
      ignore: [],
    });
  });

  it("オプションはパスの前にも書ける", () => {
    expect(parseArgs(["--format", "json", "./docs"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "json",
      ignore: [],
    });
  });

  it("値のない --format を拒む", () => {
    expect(parseArgs(["./docs", "--format"])).toEqual({
      kind: "error",
      message: "--format needs a value (text or json).",
    });
  });

  it("知らないオプションを拒む", () => {
    expect(parseArgs(["./docs", "--verbose"])).toEqual({
      kind: "error",
      message: "Unknown option: --verbose",
    });
  });

  it("2 つ目のパスを黙って捨てない", () => {
    const result = parseArgs(["./docs", "./other"]);
    expect(result.kind).toBe("error");
  });

  it("--ignore を書かれた順に集める", () => {
    expect(parseArgs(["./docs", "--ignore", "a/**", "--ignore", "b/**"])).toEqual(
      {
        kind: "run",
        target: "./docs",
        format: "text",
        ignore: ["a/**", "b/**"],
      },
    );
  });

  it("--ignore=<glob> の形も読む", () => {
    expect(parseArgs(["./docs", "--ignore=a/**"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "text",
      ignore: ["a/**"],
    });
  });

  it("--ignore は --format と混ぜて書ける", () => {
    expect(
      parseArgs(["--ignore", "a/**", "--format", "json", "./docs"]),
    ).toEqual({
      kind: "run",
      target: "./docs",
      format: "json",
      ignore: ["a/**"],
    });
  });

  it("値のない --ignore を拒む", () => {
    expect(parseArgs(["./docs", "--ignore"])).toEqual({
      kind: "error",
      message: "--ignore needs a value (a glob pattern).",
    });
  });

  it("空文字の --ignore= を拒む", () => {
    expect(parseArgs(["./docs", "--ignore="])).toEqual({
      kind: "error",
      message: "--ignore needs a value (a glob pattern).",
    });
  });

  it("--ignore の値はパスとして扱わない", () => {
    // `a/**` を 2 つ目のパスと取り違えると、ここが error になる。
    expect(parseArgs(["--ignore", "a/**", "./docs"]).kind).toBe("run");
  });
});
