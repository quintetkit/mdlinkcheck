import { describe, expect, it } from "vitest";

import type { CheckResult, Report } from "../types.js";
import { formatText } from "./text.js";

function broken(
  file: string,
  line: number,
  column: number,
  href: string,
): CheckResult {
  return {
    link: { file, line, column, href },
    status: "broken",
    resolvedPath: `/abs/${href}`,
  };
}

function ok(
  file: string,
  line: number,
  column: number,
  href: string,
): CheckResult {
  return {
    link: { file, line, column, href },
    status: "ok",
    resolvedPath: `/abs/${href}`,
  };
}

/** テストごとに必要な値だけ書けるようにするための Report の組み立て。 */
function report(partial: Partial<Report>): Report {
  const results = partial.results ?? [];
  return {
    checkedFiles: partial.checkedFiles ?? 1,
    totalLinks: partial.totalLinks ?? results.length,
    results,
    broken: partial.broken ?? results.filter((r) => r.status === "broken"),
  };
}

describe("formatText", () => {
  it("壊れたリンクが 0 件なら 1 行でその旨を伝える", () => {
    const text = formatText(
      report({ checkedFiles: 2, results: [ok("a.md", 1, 1, "./b.md")] }),
    );

    expect(text.split("\n")).toHaveLength(1);
    expect(text).toContain("No broken links");
  });

  it("リンクが 1 件もなくても 0 件として扱う", () => {
    const text = formatText(report({ checkedFiles: 0, results: [] }));

    expect(text.split("\n")).toHaveLength(1);
    expect(text).toContain("No broken links");
  });

  it("壊れたリンクを file:line:column  target の 1 件 1 行で列挙する", () => {
    const text = formatText(
      report({
        checkedFiles: 2,
        totalLinks: 5,
        results: [
          ok("README.md", 1, 1, "./docs/intro.md"),
          broken("README.md", 12, 5, "./docs/missing.md"),
          broken("docs/intro.md", 3, 10, "../nope.png"),
        ],
      }),
    );
    const lines = text.split("\n");

    expect(lines[0]).toBe("README.md:12:5  ./docs/missing.md");
    expect(lines[1]).toBe("docs/intro.md:3:10  ../nope.png");
  });

  it("末尾に N 件中 M 件が壊れている旨の要約を出す", () => {
    const text = formatText(
      report({
        checkedFiles: 2,
        totalLinks: 5,
        results: [
          broken("README.md", 12, 5, "./docs/missing.md"),
          broken("docs/intro.md", 3, 10, "../nope.png"),
        ],
      }),
    );
    const lines = text.split("\n");
    const summary = lines[lines.length - 1] ?? "";

    expect(summary).toContain("2");
    expect(summary).toContain("5");
    expect(summary).toMatch(/broken/);
  });

  it("列挙した行数が broken の件数と一致する", () => {
    const results = [
      broken("a.md", 1, 1, "./x.md"),
      broken("b.md", 2, 2, "./y.md"),
      broken("c.md", 3, 3, "./z.md"),
    ];
    const text = formatText(report({ checkedFiles: 3, totalLinks: 9, results }));
    const listed = text
      .split("\n")
      .filter((l) => /^\S+:\d+:\d+ {2}\S/.test(l));

    expect(listed).toHaveLength(3);
  });

  it("色やエスケープシーケンスを含めない", () => {
    const text = formatText(
      report({
        checkedFiles: 1,
        totalLinks: 2,
        results: [broken("a.md", 1, 1, "./missing.md")],
      }),
    );

    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
  });

  it("末尾に改行を付けない", () => {
    const text = formatText(
      report({
        checkedFiles: 1,
        totalLinks: 1,
        results: [broken("a.md", 1, 1, "./missing.md")],
      }),
    );

    expect(text.endsWith("\n")).toBe(false);
  });
});
