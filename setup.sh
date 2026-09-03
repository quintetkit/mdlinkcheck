#!/usr/bin/env bash
# このワークフローが使うラベルを、対象リポジトリに作成する。
# 前提: gh CLI が認証済みで、カレントディレクトリが対象リポジトリであること。
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI が見つかりません。https://cli.github.com/ からインストールしてください。" >&2
  exit 1
fi

if ! gh repo view >/dev/null 2>&1; then
  echo "error: GitHub リポジトリではないか、gh が認証されていません。" >&2
  echo "       'gh auth login' を実行し、対象リポジトリ内で実行してください。" >&2
  exit 1
fi

repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
echo "対象リポジトリ: ${repo}"
echo

# ラベル名|色|説明
labels=(
  "status:planned|ededed|Issue 作成済み、未着手"
  "status:in-progress|1d76db|Coder が実装中"
  "status:review|fbca04|PR 作成済み、レビュー待ち"
  "status:changes-requested|d93f0b|Reviewer が差し戻し、修正待ち"
  "status:conflict|b60205|コンフリクト解消待ち"
  "status:done|0e8a16|マージ済み・完了"
)

created=0
updated=0
for entry in "${labels[@]}"; do
  IFS='|' read -r name color desc <<< "${entry}"
  if gh label create "${name}" --color "${color}" --description "${desc}" >/dev/null 2>&1; then
    echo "  作成: ${name}"
    created=$((created + 1))
  else
    # 既存の場合は色と説明を現在の定義に揃える
    gh label edit "${name}" --color "${color}" --description "${desc}" >/dev/null
    echo "  更新: ${name}"
    updated=$((updated + 1))
  fi
done

echo
echo "完了: ${created} 件作成, ${updated} 件更新"
echo
echo "次にやること:"
echo "  Claude Code に「architect を使って <やりたいこと> を Issue に分割して」と依頼する。"
