import { describe, expect, it } from "vitest";

import { extractLinks } from "./extract.js";

describe("extractLinks", () => {
  it("[text](target) を位置つきで抜き出す", () => {
    const markdown = ["# Title", "", "See [the guide](./guide.md) first."].join(
      "\n",
    );

    expect(extractLinks(markdown, "docs/index.md")).toEqual([
      { file: "docs/index.md", line: 3, column: 5, href: "./guide.md" },
    ]);
  });

  it("1 行に複数あってもすべて拾う", () => {
    const links = extractLinks("[a](a.md) and [b](b.md)", "index.md");

    expect(links.map((link) => link.href)).toEqual(["a.md", "b.md"]);
    expect(links.map((link) => link.column)).toEqual([1, 15]);
  });

  it("リンクが 1 つもなければ空配列を返す", () => {
    expect(extractLinks("just text\n", "index.md")).toEqual([]);
  });

  it("CRLF でも行番号がずれない", () => {
    const links = extractLinks("a\r\nb\r\n[c](c.md)", "index.md");

    expect(links[0]?.line).toBe(3);
  });

  it("title つきの target を title 抜きで取る", () => {
    const links = extractLinks('[a](./a.md "Title")', "index.md");

    expect(links[0]?.href).toBe("./a.md");
  });

  it("山括弧つきの target から括弧を外す", () => {
    const links = extractLinks("[a](<./a b.md>)", "index.md");

    expect(links[0]?.href).toBe("./a b.md");
  });

  it("target が空でもリンクとして取る", () => {
    const links = extractLinks("[a]()", "index.md");

    expect(links[0]?.href).toBe("");
  });

  describe("コードブロック", () => {
    it("``` で囲まれた範囲のリンクを取らない", () => {
      const markdown = [
        "[before](before.md)",
        "```",
        "[inside](inside.md)",
        "```",
        "[after](after.md)",
      ].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "before.md",
        "after.md",
      ]);
    });

    it("info string つきのフェンスでも中を取らない", () => {
      const markdown = ["```markdown", "[inside](inside.md)", "```"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("~~~ のフェンスも同じく除外する", () => {
      const markdown = ["~~~", "[inside](inside.md)", "~~~"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("開いたフェンスは、同じ記号の同じ長さ以上でしか閉じない", () => {
      const markdown = [
        "````",
        "```",
        "[inside](inside.md)",
        "````",
        "[after](after.md)",
      ].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "after.md",
      ]);
    });

    it("閉じないフェンスはファイル末尾まで閉じない", () => {
      const markdown = ["```", "[inside](inside.md)"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });
  });

  describe("インラインコード", () => {
    it("backtick に囲まれたリンクを取らない", () => {
      const links = extractLinks("`[a](a.md)` but [b](b.md)", "index.md");

      expect(links.map((l) => l.href)).toEqual(["b.md"]);
    });

    it("二重 backtick の中も取らない", () => {
      const links = extractLinks("``[a](a.md) ` ``", "index.md");

      expect(links).toEqual([]);
    });

    it("閉じない backtick はコードにしない", () => {
      const links = extractLinks("` [a](a.md)", "index.md");

      expect(links.map((l) => l.href)).toEqual(["a.md"]);
    });
  });

  describe("リンクに見えるが違うもの", () => {
    it("画像 ![alt](src) は取らない", () => {
      expect(extractLinks("![logo](logo.png)", "index.md")).toEqual([]);
    });

    it("画像を包むリンクは、外側の target を取る", () => {
      const links = extractLinks("[![badge](b.svg)](./target.md)", "index.md");

      expect(links.map((l) => l.href)).toEqual(["./target.md"]);
    });

    it("エスケープされた \\[ は取らない", () => {
      expect(extractLinks("\\[a](a.md)", "index.md")).toEqual([]);
    });
  });
});
