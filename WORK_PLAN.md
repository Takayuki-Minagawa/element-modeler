# Element Modeler v1.6.0 作業計画

## 調査と対象

- 作業ブランチ: `codex/improve-model-workflow-20261004`（開始時 main と origin/main は一致）。
- 既存検証: JavaScript 484件、Python core 7件、全Lintが成功。
- GitHub: 未処理のIssue・PRなし。CI/Deployは手動実行・Ubuntuのみ。
- 階・通り芯・荷重組合せのモーダルは履歴を介さず変更するため、既存の編集コマンドに統一する。
- 要素一覧は単一選択のみ。線材の種類・断面の絞り込みと、ページをまたぐ一括選択を追加し、既存の一括編集へ接続する。
- 参考: [Blender公式の選択機能](https://docs.blender.org/manual/en/latest/scene_layout/object/selecting.html)、[対象GitHub](https://github.com/Takayuki-Minagawa/element-modeler)。外部コードの取り込みや依存追加は行わない。

## 実施順序

1. 階・通り芯・荷重組合せの履歴統一をサブエージェントで実装。無変更時のRedo保持とUndo/Redoを検証。
2. 要素一覧の検索処理を純粋関数へ分離。線材種類・断面フィルタと検索結果全件の一括選択を追加。選択した線材が表示されるよう既存ナビゲーションと統合。
3. 単体テスト・ブラウザE2Eを追加し、既存検証を実行。日本語/英語の説明を更新し、v1.6.0へ同期。
4. PRを作成して接続。サブエージェントがPR差分をレビューし、メインが修正・再検証。
5. Linux CIを手動実行し、マージ可能状態を確認。作業計画を削除してPRをマージ、mainを同期し今回の作業ブランチを削除。

## 完了条件

- 実際の利用経路で一括選択から既存一括編集を使える。
- モーダルの有効な変更が一操作一履歴でUndo/Redo可能。無効/無変更は履歴を消費しない。
- 必要な検証とレビューに合格。PRマージ済み、mainとorigin/mainが一致、作業ツリーがクリーン。
- GitHub ActionsはLinuxのみ。既存の手動配信方式を維持。

完了時にこの一時計画は削除する。
