# 作業計画: 部材応力図・材端力表と部材リスト/鋼材重量集計 (v1.5.0)

作成日: 2026-09-24　ブランチ: `feature/member-forces-schedule`

## 1. 調査結果(Web・GitHub)

### 比較したブラウザ構造ツール
| ツール | 参照 | 本アプリに無い機能 |
|---|---|---|
| Stabileo (lambdaclass/stabileo) | https://github.com/lambdaclass/stabileo | 変形図に加え応力・利用率の色分け、荷重組合せの包絡 |
| EasyCiv | https://www.easyciv.com/ | モーメント・せん断・軸力・反力・たわみ図 |
| STRIAN 2.1 | https://structural-analyser.com/ | 内力図と変形図 |
| vetin-beam (rasimtemur/vetin-beam) | https://github.com/rasimtemur/vetin-beam | SFD/BMD/AFD のリアルタイム描画 |
| Optimal Beam 2D | https://optimalbeam.com/2d-structural-analysis/ | 部材力図・変位一覧 |
| 構造モデラー+NBUS7 / FRAMEマネージャ | https://www.kozo.co.jp/program/kozo/km/nbus7/index.html ほか | 部材断面リスト・計算結果の CSV 出力 |
| ST-Bridge (stb-kit, HoaryFox, Squid-n) | https://github.com/taisei-oss/stb-kit | STB XML 入出力(次期候補として記録) |

### 本アプリの現状(コード調査)
- 解析結果 JSON v1 は全要素に `localEndForces`(12成分)を持ち、`validateAnalysisResult` で検証しているが、
  結果パネル(`js/analysis/panels.js`)は変形図・変位/反力表のみで **応力図・材端力表が無い**。
- 数量集計(`js/quantities.js`, `js/io.js`)は面材と屋根部材のみ。**全線材の断面別リスト・鋼材重量が無い**。
  材料密度(`materialCatalog.density`)と断面積(`sectionProperties`)は既に存在する。

## 2. スコープ

### A. 部材応力図・材端力表(解析結果パネル)
1. `js/analysis/results.js`
   - `memberInternalForces(localEndForces)`: 材端力(節点が要素に与える力)から断面力の I端/J端値を算出。
     節点荷重のみの線形解析なので N/Qy/Qz/T は一定、My/Mz は直線。
     符号: 引張正、右手系局所軸(結果 JSON の `axes` と同じ)。
     N(s) = -N_i, Qy(s) = -Qy_i, Qz(s) = -Qz_i, T(s) = -T_i, My(s) = -My_i - s·Qz_i, Mz(s) = -Mz_i + s·Qy_i。
     J端の値は要素端 J の力と整合(検証に使う)。
   - `buildResultView` の各 member に `axes`, `endForces`, `forces{N,Qy,Qz,T,My,Mz:[i,j]}` を追加し、
     `extremes`(成分別の最大絶対値)を返す。
   - `buildMemberForceCSV(view)`: 要素・部材ID・枝番・節点 I/J・断面力 I/J 端(N, Qy, Qz, T, My, Mz)の CSV。
2. `js/analysis/panels.js`
   - `component` オプション(`none|N|Qy|Qz|T|My|Mz`)を受け、変形図と同じ投影で部材線に直交する塗り図形として描画。
     正値は局所 +y(Qy/Mz)または +z(Qz/My/N/T)側。My は下側引張(たわみ側)が負値で下に描かれる。
   - 材端力表(要素ごとの N/Qy/Qz/T/My/Mz の I端・J端)を追加。
   - `onExportForces` コールバックで CSV 出力を親へ委譲(ダウンロードは workbench 責務)。
3. `js/analysis/workbench.js`
   - 成分セレクト(`#analysis-result-component`)を追加し再描画。CSV ダウンロード(`member-forces.csv`)。
4. テスト: `test/analysis-results-panel.test.js` に片持ち梁フィクスチャで M_y(0)=3,000,000, M_y(L)=0, Qz=-1000
   を検証、SVG の応力図・表・CSV を検証。`test/analysis-workbench.test.js` に成分セレクトの配線確認。
5. ドキュメント: `docs/analysis-tools.md`(結果 JSON の材端力符号・図の規約)、README、ヘルプ(ja/en)。

### B. 部材リスト・鋼材重量集計
1. `js/quantities.js`
   - `computeMemberSchedule(state)`: 線材を(種別, 断面名)でグループ化し、本数・延長 m・断面積 mm²・
     材料・密度・単位重量 kg/m・重量 kg を返す。密度または断面積が無い場合は重量 null。
     合計(本数・延長・重量)と、重量不明の行数を返す。
2. `js/io.js`
   - `buildMemberScheduleCSV(state)` / `exportMemberScheduleCSV(state)`(`<name>_member_schedule_<ts>.csv`)。
   - 明細行(部材ID・種別・断面・階・長さ・重量)も同 CSV に `member` 行として出力。
3. UI: ファイルメニューに「部材リストCSV出力」ボタン、集計パネルに「部材リスト」テーブル(断面別)。
4. i18n キー(ja/en)、ヘルプ、README。
5. テスト: `test/quantity-summary.test.js` / `test/quantity-csv-export.test.js` に追加。

### C. バージョン
- `package.json` 1.5.0 → `npm run version:sync`。

## 3. 進め方
1. 計画書作成(本ファイル) → 2. A 実装+テスト → 3. B 実装+テスト → 4. ドキュメント・i18n・バージョン →
5. `npm run check` → 6. ブラウザ確認 → 7. PR 作成 → 8. サブエージェントレビュー・修正 → 9. マージ →
10. ブランチと本計画書の削除。

## 4. 次期候補(今回は対象外)
- ST-Bridge 2.x XML 出力(節点・階・通り芯・柱・大梁・小梁・ブレース・床・壁・鋼材断面)。
- 荷重組合せの包絡(複数結果 JSON の重ね合わせ)。
- 3D ビューでの応力図オーバーレイ。
