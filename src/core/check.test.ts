import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LinkRef } from "../types.js";
import { checkLink, checkLinks, createReport } from "./check.js";
import { extractLinks } from "./extract.js";

const ROOT = path.resolve("/repo");

function link(href: string, file = "docs/a.md"): LinkRef {
  return { file, line: 1, column: 1, href };
}

/** 与えたパスだけが存在する、という存在確認。 */
function only(...paths: string[]) {
  const known = new Set(paths.map((p) => path.resolve(ROOT, p)));
  return (absolutePath: string) => known.has(absolutePath);
}

describe("checkLink", () => {
  it.each(["https://example.com", "http://example.com", "mailto:a@b.com", "#x"])(
    "%s は external にして解決しない",
    (href) => {
      const result = checkLink(link(href), ROOT, () => {
        throw new Error("外部参照で存在確認をしてはいけない");
      });

      expect(result.status).toBe("external");
      expect(result.resolvedPath).toBeUndefined();
    },
  );

  it("存在するファイルは ok と解決先を返す", () => {
    const result = checkLink(link("./b.md"), ROOT, only("docs/b.md"));

    expect(result.status).toBe("ok");
    expect(result.resolvedPath).toBe(path.join(ROOT, "docs", "b.md"));
  });

  it("存在しないファイルは broken と解決先を返す", () => {
    const result = checkLink(link("./missing.md"), ROOT, only("docs/b.md"));

    expect(result.status).toBe("broken");
    expect(result.resolvedPath).toBe(path.join(ROOT, "docs", "missing.md"));
  });

  it("target が空のリンクは broken にする", () => {
    const result = checkLink(link(""), ROOT, () => true);

    expect(result.status).toBe("broken");
    expect(result.resolvedPath).toBeUndefined();
  });

  it("同じ target でも、書かれたファイルが違えば解決先が変わる", () => {
    const exists = only("docs/guide/b.md");

    expect(checkLink(link("./b.md", "docs/guide/a.md"), ROOT, exists).status).toBe(
      "ok",
    );
    expect(checkLink(link("./b.md", "docs/a.md"), ROOT, exists).status).toBe(
      "broken",
    );
  });
});

describe("checkLinks", () => {
  it("入力の順を保って結果を返す", () => {
    const results = checkLinks(
      [link("https://example.com"), link("./b.md"), link("./missing.md")],
      ROOT,
      only("docs/b.md"),
    );

    expect(results.map((r) => r.status)).toEqual(["external", "ok", "broken"]);
  });
});

describe("createReport", () => {
  it("件数を数え、broken だけを抜き出す", () => {
    const results = checkLinks(
      [link("https://example.com"), link("./b.md"), link("./missing.md")],
      ROOT,
      only("docs/b.md"),
    );
    const report = createReport(2, results);

    expect(report.checkedFiles).toBe(2);
    expect(report.totalLinks).toBe(3);
    expect(report.results).toHaveLength(3);
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]?.link.href).toBe("./missing.md");
  });

  it("broken が 0 件でも空配列を返す", () => {
    expect(createReport(0, []).broken).toEqual([]);
  });
});

describe("実際のファイルに対する検査", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "mdlinkcheck-"));
    mkdirSync(path.join(root, "guide"));
    writeFileSync(path.join(root, "README.md"), "root\n");
    writeFileSync(path.join(root, "guide", "b.md"), "b\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("抽出から解決までを通す", () => {
    const markdown = [
      "[up](../README.md)",
      "[sibling](./b.md)",
      "[gone](./gone.md)",
      "[site](/README.md)",
      "[ext](https://example.com)",
      "`[code](./gone.md)`",
      "```",
      "[fenced](./gone.md)",
      "```",
    ].join("\n");

    const links = extractLinks(markdown, path.join("guide", "a.md"));
    const report = createReport(1, checkLinks(links, root));

    expect(report.totalLinks).toBe(5);
    expect(report.results.map((r) => r.status)).toEqual([
      "ok",
      "ok",
      "broken",
      "ok",
      "external",
    ]);
    expect(report.broken).toHaveLength(1);
    expect(report.broken[0]?.link.line).toBe(3);
    expect(report.broken[0]?.resolvedPath).toBe(
      path.join(root, "guide", "gone.md"),
    );
  });
});
