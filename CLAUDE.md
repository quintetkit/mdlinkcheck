# GitHub Issue ベース開発設定（4人格・並列ワークフロー）

Claude Code に **設計者・実装者・レビュアー・コンフリクト解消担当** という 4 つの人格を
使い分けさせ、GitHub Issue と Git ブランチを軸に並列開発を進めるための設定です。

実装コードは含みません。`CLAUDE.md` と `.claude/agents/`、`.github/ISSUE_TEMPLATE/` を
対象プロジェクトの直下にコピーして使います。

## 何を解決するか

Claude Code に大きめの依頼をすると、こういうことが起きます。

- 頼んでいない範囲まで書き換わり、差分が読めなくなる
- 複数の作業を並列で走らせるとファイルが競合し、あとから解きほぐせなくなる
- 「今どこまで終わったか」が会話の中にしかなく、追跡できない
- 自分で書いたコードを自分でレビューして自分でマージするので、歯止めがない

この設定は、**責務を分けて役割ごとに権限を落とす**ことでこれを防ぎます。
Coder は自分の scope 外を触れず、マージは Reviewer しかできず、コンフリクトは
専任の人格しか解消しません。そして状態はすべて GitHub Issue のラベルに出ます。

## 4つの人格

`.claude/agents/` に定義。役割は明確に分離し、互いの責務を侵しません。

| 人格 | 定義ファイル | 役割 | コードを書くか |
|---|---|---|---|
| **Architect（設計者）** | `architect.md` | 依頼を Issue に分割。scope（担当パス）と依存関係を定義し、並列着手できる組み合わせを決める | 書かない |
| **Coder（実装者）** | `coder.md` | 1 つの Issue を担当し、自分の scope 内だけを変更して PR を出す | 書く |
| **Reviewer（レビュアー）** | `reviewer.md` | PR を受け入れ条件と scope 違反の観点でレビューし、問題なければマージする | 書かない |
| **Conflict Resolver** | `conflict-resolver.md` | マージ時にコンフリクトが起きたときだけ登場し、解消して Reviewer に差し戻す | 書く（解消のみ） |

## 全体フロー

```
依頼・要望
   │
   ▼
[Architect] 要件を分析 → Issue に分割
   ・各 Issue に scope（担当パス）, 依存関係, ブランチ名, 受け入れ条件 を明記
   ・scope が重複しない Issue 群を「並列着手グループ」としてまとめる
   │
   ▼ (並列着手グループごとに同時実行)
[Coder #1] issue/12-xxx  [Coder #2] issue/13-yyy  [Coder #3] issue/14-zzz
   ・各 Coder は自分の Issue の scope 内だけを変更
   ・実装後 PR 作成 (Closes #12) → label: status:review
   │
   ▼ (PR ごとに、1件ずつ順番に)
[Reviewer] 受け入れ条件・scope 遵守を確認
   ├─ 問題なし → main へマージ、Issue クローズ、ブランチ削除
   ├─ 要修正   → status:changes-requested、Coder に差し戻し
   └─ コンフリクト発生
         │
         ▼
     [Conflict Resolver] 両ブランチの意図を保ったまま解消 → テスト
         │
         ▼
     [Reviewer] 解消結果を確認して最終マージ
   │
   ▼
[Architect] 依存が解けた Issue を次の並列着手グループとして解放
```

## コアルール

1. **Issue 起点**: Issue が存在しない変更は行わない。思いつきの実装をしない。
2. **Issue 分割は Architect のみ**が行う。1 Issue = 1 scope = 1 ブランチ。
3. **scope 外は触らない**: Coder は自分の Issue に明記された scope 外のファイルを変更しない。
   必要になったら実装を止め、Architect に新規 Issue として切り出すよう報告する。
4. **並列実行の可否**: scope が重複しない Issue 同士は同時に着手してよい。
   重複または依存がある場合は、依存元が `status:done` になるまで着手しない。
5. **ブランチ命名**: `issue/<issue番号>-<slug>`（例: `issue/12-add-login-form`）。
6. **PR** は対応する Issue を本文で `Closes #<番号>` として参照する。
7. **マージ権限は Reviewer のみ**。Coder も Architect も自分で main にマージしない。
8. **コンフリクトは Conflict Resolver 専任**。Reviewer や Coder が自己判断で解消しない。
9. **状態は GitHub Issue のラベルで可視化**する。
10. 各人格は自分の責務を超える判断（Issue 再分割、マージ方針変更など）をしない。
    判断が必要な場合は Architect に差し戻す。

## ラベルによる状態管理

| ラベル | 意味 | 付与するタイミング |
|---|---|---|
| `status:planned` | Issue 作成済み、未着手 | Architect が Issue 作成時 |
| `status:in-progress` | Coder が実装中 | Coder が着手時 |
| `status:review` | PR 作成済み、レビュー待ち | Coder が PR 作成時 |
| `status:changes-requested` | 修正待ち | Reviewer が差し戻し時 |
| `status:conflict` | コンフリクト解消待ち | Reviewer がコンフリクト検出時 |
| `status:done` | マージ済み・完了 | Reviewer がマージ時 |

依存関係は Issue 本文に `Depends on #<番号>` の形式で明記する。

`./setup.sh` を一度実行すると、これらのラベルを対象リポジトリに作成できます。

## 人格の呼び出し方

各人格は `.claude/agents/` 配下のサブエージェント定義に対応します。Agent (Task) ツールで
`subagent_type` に `architect` / `coder` / `reviewer` / `conflict-resolver` を指定して呼びます。

- 並列着手グループ内の Coder は、**1 メッセージ内で複数の Agent 呼び出しを同時発行**して
  真に並列実行する。順番に呼ぶと並列にならない。
- 各 Coder は独立した作業ツリー（`git worktree`）で作業し、作業ディレクトリ同士も競合させない。
- **Reviewer は 1 PR ずつ順に処理する**。マージをシリアルにすることで main の状態を常に一貫させる。
  ここを並列にするとコンフリクトが多発し、速度がむしろ落ちる。

## 使い方

```bash
# 1. 対象プロジェクトの直下にコピー
cp -R CLAUDE.md .claude .github /path/to/your-project/

# 2. ラベルを作成（gh CLI の認証が必要）
cd /path/to/your-project && ./setup.sh

# 3. Claude Code に依頼する
#    「architect を使って、○○の機能を Issue に分割して」
```

既に `CLAUDE.md` がある場合は、この内容を追記するか、プロジェクト固有の規約と
併記してください（この設定はプロジェクトの技術スタックに依存しません）。

## この設定の範囲

このリポジトリ自体は設定テンプレートであり、実装コードを含みません。

UI を含む開発では、実装より先に UI 仕様を確定させる 5 人格目（UI Designer）を挟むと、
生成 AI にありがちな既定の画面（全画面中央揃えのヒーロー、アイコン付き 3 カラムカード、
紫のグラデーション）を避けられます。そちらは別途配布しています。

参考: [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents)
