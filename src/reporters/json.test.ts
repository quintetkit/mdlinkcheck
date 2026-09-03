import { describe, expect, it } from "vitest";

import type { CheckResult, LinkRef, Report } from "../types.js";
import { toJson } from "./json.js";

function link(file: string, line: number, column: number, href: string): LinkRef {
  return { file, line, column, href };
}

function broken(ref: LinkRef, resolvedPath: string): CheckResult {
  return { link: ref, status: "broken", resolvedPath };
}

function ok(ref: LinkRef, resolvedPath: string): CheckResult {
  return { link: ref, status: "ok", resolvedPath };
}

function external(ref: LinkRef): CheckResult {
  return { link: ref, status: "external" };
}

function report(overrides: Partial<Report> = {}): Report {
  return {
    checkedFiles: 0,
    totalLinks: 0,
    results: [],
    broken: [],
    ...overrides,
  };
}

describe("toJson", () => {
  it("壊れたリンクが0件でも broken を空配列として返す", () => {
    const okResult = ok(link("README.md", 1, 1, "./docs/guide.md"), "/repo/docs/guide.md");

    const json = toJson(report({ checkedFiles: 1, totalLinks: 1, results: [okResult] }));

    expect(json).toEqual({ checkedFiles: 1, totalLinks: 1, broken: [] });
    // キー自体を省略していないことを、値ではなく存在で確かめる。
    expect(Object.keys(json)).toContain("broken");
    expect(json.broken).toEqual([]);
  });

  it("壊れたリンクを file / line / column / target に平坦化する", () => {
    const first = broken(link("README.md", 3, 5, "./missing.md"), "/repo/missing.md");
    const second = broken(link("docs/guide.md", 12, 1, "../nope/index.md"), "/nope/index.md");

    const json = toJson(
      report({
        checkedFiles: 2,
        totalLinks: 4,
        results: [first, second],
        broken: [first, second],
      }),
    );

    expect(json).toEqual({
      checkedFiles: 2,
      totalLinks: 4,
      broken: [
        { file: "README.md", line: 3, column: 5, target: "./missing.md" },
        { file: "docs/guide.md", line: 12, column: 1, target: "../nope/index.md" },
      ],
    });
  });

  it("broken に渡された順序を保つ", () => {
    const items = [
      broken(link("a.md", 1, 1, "./1.md"), "/repo/1.md"),
      broken(link("b.md", 2, 2, "./2.md"), "/repo/2.md"),
      broken(link("c.md", 3, 3, "./3.md"), "/repo/3.md"),
    ];

    const json = toJson(report({ checkedFiles: 3, totalLinks: 3, results: items, broken: items }));

    expect(json.broken.map((entry) => entry.file)).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("ok と external は broken に混ぜない", () => {
    const brokenResult = broken(link("README.md", 4, 1, "./gone.md"), "/repo/gone.md");
    const results = [
      ok(link("README.md", 1, 1, "./docs/guide.md"), "/repo/docs/guide.md"),
      external(link("README.md", 2, 1, "https://example.com")),
      external(link("README.md", 3, 1, "#anchor")),
      brokenResult,
    ];

    const json = toJson(
      report({ checkedFiles: 1, totalLinks: 4, results, broken: [brokenResult] }),
    );

    expect(json.broken).toHaveLength(1);
    expect(json.broken[0]?.target).toBe("./gone.md");
  });

  it("resolvedPath など Report 側の内部構造を出力に漏らさない", () => {
    const item = broken(link("README.md", 1, 1, "./missing.md"), "/repo/missing.md");

    const json = toJson(report({ checkedFiles: 1, totalLinks: 1, results: [item], broken: [item] }));

    expect(Object.keys(json).sort()).toEqual(["broken", "checkedFiles", "totalLinks"]);
    expect(Object.keys(json.broken[0] ?? {}).sort()).toEqual([
      "column",
      "file",
      "line",
      "target",
    ]);
  });

  it("入力の配列を共有せず、独立したオブジェクトを返す", () => {
    const item = broken(link("README.md", 1, 1, "./missing.md"), "/repo/missing.md");
    const input = report({ checkedFiles: 1, totalLinks: 1, results: [item], broken: [item] });

    const json = toJson(input);

    expect(json.broken).not.toBe(input.broken);
    expect(json.broken[0]).not.toBe(input.broken[0]);
  });

  describe("JSON としての妥当性", () => {
    it("broken が0件のとき、往復しても同じ値になる", () => {
      const json = toJson(report({ checkedFiles: 5, totalLinks: 9 }));

      const text = JSON.stringify(json);
      expect(() => JSON.parse(text)).not.toThrow();
      expect(JSON.parse(text)).toEqual(json);
      expect(text).toContain('"broken":[]');
    });

    it("broken が複数件のとき、往復しても同じ値になる", () => {
      const items = [
        broken(link("README.md", 3, 5, "./missing.md"), "/repo/missing.md"),
        broken(link("docs/guide.md", 12, 1, "../nope/index.md"), "/nope/index.md"),
      ];

      const json = toJson(
        report({ checkedFiles: 2, totalLinks: 7, results: items, broken: items }),
      );

      const text = JSON.stringify(json);
      expect(() => JSON.parse(text)).not.toThrow();
      expect(JSON.parse(text)).toEqual(json);
    });

    it("引用符やバックスラッシュを含むパスでも壊れない", () => {
      const item = broken(
        link('weird"dir/a\\b.md', 1, 1, './"quoted"\\path.md'),
        '/repo/"quoted"\\path.md',
      );

      const json = toJson(report({ checkedFiles: 1, totalLinks: 1, results: [item], broken: [item] }));

      const parsed = JSON.parse(JSON.stringify(json));
      expect(parsed.broken[0].file).toBe('weird"dir/a\\b.md');
      expect(parsed.broken[0].target).toBe('./"quoted"\\path.md');
    });

    it("非 ASCII のパスとリンク先を保つ", () => {
      const item = broken(link("ドキュメント/案内.md", 2, 3, "./存在しない.md"), "/repo/存在しない.md");

      const json = toJson(report({ checkedFiles: 1, totalLinks: 1, results: [item], broken: [item] }));

      const parsed = JSON.parse(JSON.stringify(json));
      expect(parsed.broken[0].file).toBe("ドキュメント/案内.md");
      expect(parsed.broken[0].target).toBe("./存在しない.md");
    });

    it("undefined を含まないので stringify でキーが消えない", () => {
      const items = [broken(link("a.md", 1, 1, "./x.md"), "/repo/x.md")];

      const json = toJson(report({ checkedFiles: 1, totalLinks: 2, results: items, broken: items }));
      const parsed = JSON.parse(JSON.stringify(json));

      expect(Object.keys(parsed).sort()).toEqual(["broken", "checkedFiles", "totalLinks"]);
      expect(Object.keys(parsed.broken[0]).sort()).toEqual(["column", "file", "line", "target"]);
    });
  });
});
