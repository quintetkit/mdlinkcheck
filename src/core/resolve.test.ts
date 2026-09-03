import path from "node:path";

import { describe, expect, it } from "vitest";

import { isExternal, resolveHref } from "./resolve.js";

const ROOT = path.resolve("/repo/docs");

describe("isExternal", () => {
  it.each([
    "http://example.com",
    "https://example.com/a",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@example.com",
    "#anchor",
  ])("%s は外部として扱う", (href) => {
    expect(isExternal(href)).toBe(true);
  });

  it.each(["./a.md", "../a.md", "a.md", "/a.md", "", "a.md#anchor"])(
    "%s は外部として扱わない",
    (href) => {
      expect(isExternal(href)).toBe(false);
    },
  );

  it("前後の空白があっても判定は変わらない", () => {
    expect(isExternal("  https://example.com  ")).toBe(true);
  });
});

describe("resolveHref", () => {
  it("リンクを含むファイルの位置を基準に解決する", () => {
    expect(resolveHref("./b.md", "guide/a.md", ROOT)).toBe(
      path.join(ROOT, "guide", "b.md"),
    );
  });

  it("`../` はファイルのディレクトリから上がる", () => {
    expect(resolveHref("../README.md", "guide/a.md", ROOT)).toBe(
      path.join(ROOT, "README.md"),
    );
  });

  it("`./` のない相対パスも同じ基準で解決する", () => {
    expect(resolveHref("b.md", "guide/a.md", ROOT)).toBe(
      path.join(ROOT, "guide", "b.md"),
    );
  });

  it("`/` 始まりは検査の起点ディレクトリを根とする", () => {
    expect(resolveHref("/guide/b.md", "deep/nested/a.md", ROOT)).toBe(
      path.join(ROOT, "guide", "b.md"),
    );
  });

  it("フラグメントを落としてファイルだけを指す", () => {
    expect(resolveHref("./b.md#section", "a.md", ROOT)).toBe(
      path.join(ROOT, "b.md"),
    );
  });

  it("パーセントエンコードを戻す", () => {
    expect(resolveHref("./a%20b.md", "a.md", ROOT)).toBe(
      path.join(ROOT, "a b.md"),
    );
  });

  it("壊れたエスケープはそのままの文字列として扱う", () => {
    expect(resolveHref("./100%.md", "a.md", ROOT)).toBe(
      path.join(ROOT, "100%.md"),
    );
  });

  it("target が空なら解決先はない", () => {
    expect(resolveHref("", "a.md", ROOT)).toBeUndefined();
  });
});
