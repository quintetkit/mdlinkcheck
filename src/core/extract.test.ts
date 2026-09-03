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

  describe("reference 形式", () => {
    it("[text][ref] を定義の target で解決する", () => {
      const markdown = [
        "See [the guide][guide] first.",
        "",
        "[guide]: ./guide.md",
      ].join("\n");

      expect(extractLinks(markdown, "docs/index.md")).toEqual([
        { file: "docs/index.md", line: 1, column: 5, href: "./guide.md" },
      ]);
    });

    it("定義が参照より前にあっても解決する", () => {
      const markdown = ["[guide]: ./guide.md", "", "[the guide][guide]"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md")).toEqual([
        { file: "index.md", line: 3, column: 1, href: "./guide.md" },
      ]);
    });

    it("line / column は定義側ではなく参照の位置を指す", () => {
      const markdown = ["[a]: ./a.md", "", "  text [x][a] here"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([
        { file: "index.md", line: 3, column: 8, href: "./a.md" },
      ]);
    });

    it("短縮形 [text][] を解決する", () => {
      const markdown = ["[guide][]", "", "[guide]: ./guide.md"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([
        { file: "index.md", line: 1, column: 1, href: "./guide.md" },
      ]);
    });

    it("短縮形 [ref] 単独を解決する", () => {
      const markdown = ["see [guide] now", "", "[guide]: ./guide.md"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md")).toEqual([
        { file: "index.md", line: 1, column: 5, href: "./guide.md" },
      ]);
    });

    it("定義のない [text][ref] は取らない", () => {
      expect(extractLinks("[a][nope]", "index.md")).toEqual([]);
    });

    it("定義のない短縮形は取らない", () => {
      expect(extractLinks("[nope] and [nope][]", "index.md")).toEqual([]);
    });

    it("定義の重複は最初のものを採用する", () => {
      const markdown = [
        "[a][ref]",
        "",
        "[ref]: ./first.md",
        "[ref]: ./second.md",
      ].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./first.md",
      ]);
    });

    it("ラベルの大文字小文字を区別しない", () => {
      const markdown = ["[x][Ref] and [y][rEf]", "", "[REF]: ./a.md"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./a.md",
        "./a.md",
      ]);
    });

    it("ラベル中の空白の並びを 1 個として比べる", () => {
      const markdown = ["[x][a  b]", "", "[a b]: ./a.md"].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./a.md",
      ]);
    });

    it("定義の title を読み飛ばす", () => {
      const markdown = ["[x][a]", "", '[a]: ./a.md "Title"'].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./a.md",
      ]);
    });

    it("定義の山括弧つき target から括弧を外す", () => {
      const markdown = ["[x][a]", "", "[a]: <./a b.md>"].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./a b.md",
      ]);
    });

    it("インデントが 4 以上の行は定義にしない", () => {
      const markdown = ["[x][a]", "", "    [a]: ./a.md"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("定義の行そのものはリンクとして取らない", () => {
      expect(extractLinks("[a]: ./a.md", "index.md")).toEqual([]);
    });

    it("インライン形式と混在しても出現順に返す", () => {
      const markdown = [
        "[i](./i.md) and [r][ref] and [s]",
        "",
        "[ref]: ./r.md",
        "[s]: ./s.md",
      ].join("\n");

      const links = extractLinks(markdown, "index.md");

      expect(links.map((l) => l.href)).toEqual(["./i.md", "./r.md", "./s.md"]);
      expect(links.map((l) => l.column)).toEqual([1, 17, 30]);
    });

    it("同じラベルの定義があってもインライン形式の target を優先する", () => {
      const markdown = ["[a](./inline.md)", "", "[a]: ./ref.md"].join("\n");

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./inline.md",
      ]);
    });

    it("リンクテキストに画像を含む参照も解決する", () => {
      const markdown = ["[![badge](b.svg)][ref]", "", "[ref]: ./target.md"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md").map((l) => l.href)).toEqual([
        "./target.md",
      ]);
    });

    it("フェンスの中の参照を取らない", () => {
      const markdown = ["```", "[x][ref]", "```", "", "[ref]: ./a.md"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("フェンスの中の定義は定義にしない", () => {
      const markdown = ["[x][ref]", "", "```", "[ref]: ./a.md", "```"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("インラインコードの中の参照を取らない", () => {
      const markdown = ["`[x][ref]` but [y][ref]", "", "[ref]: ./a.md"].join(
        "\n",
      );

      expect(extractLinks(markdown, "index.md").map((l) => l.column)).toEqual([
        16,
      ]);
    });

    it("インラインコードの中の定義は定義にしない", () => {
      const markdown = ["[x][ref]", "", "`[ref]: ./a.md`"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("画像の参照 ![alt][ref] は取らない", () => {
      const markdown = ["![logo][ref]", "", "[ref]: ./a.png"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });

    it("エスケープされた \\[ から始まる参照は取らない", () => {
      const markdown = ["\\[x][ref]", "", "[ref]: ./a.md"].join("\n");

      expect(extractLinks(markdown, "index.md")).toEqual([]);
    });
  });
});
