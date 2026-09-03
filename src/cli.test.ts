import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseArgs, run, type CliIo } from "./cli.js";

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
});

describe("parseArgs", () => {
  it("パスとフォーマットを読む", () => {
    expect(parseArgs(["./docs", "--format", "json"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "json",
    });
  });

  it("フォーマットの既定は text", () => {
    expect(parseArgs(["./docs"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "text",
    });
  });

  it("オプションはパスの前にも書ける", () => {
    expect(parseArgs(["--format", "json", "./docs"])).toEqual({
      kind: "run",
      target: "./docs",
      format: "json",
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
});
