# Element Modeler (Ver.1.4.0)

ブラウザ上で動作する **2D CAD + 3D Viewer** Webアプリケーションです。
建築の柱・梁・ブレースなどの線材に加えて、床・壁の面材を2D平面上で配置・編集し、同じデータを3Dで可視化できます。

**GitHub Pages** でそのまま動作します（バックエンド不要）。

## Demo

GitHub Pages: [Element Modeler](https://takayuki-minagawa.github.io/element-modeler/)

公開更新はGitHub Actionsの「Deploy to GitHub Pages」を手動実行します。push・PR・マージだけでは公開されません。

## Features

### 2D CAD
- 線材（梁 / 柱 / 水平ブレース / 鉛直ブレース）の作成・選択・移動・削除
- 面材（床 / 外壁 / 壁 / 屋根 / 庇・軒 / 妻壁）の作成・選択・削除（矩形2点指定 / ポリライン閉合）
- 外壁ラインをポリラインで入力し、閉合してポリゴン化（レイヤー管理）
- 壁の高さ種別（全高 / 腰壁 / 垂れ壁 / 任意）を入力し、下端・上端高さを編集
- 屋根面を矩形/ポリラインで入力し、勾配・登り方向・基準高さを設定
- 床・外壁などの輪郭から屋根面を自動生成（片流れ / 切妻X棟 / 切妻Y棟 / 寄棟）
- 庇・軒を屋根面と同じ勾配付き面として入力し、風圧投影面積と地震重量に反映
- 複数の屋根面を屋根グループIDでまとめて管理
- 屋根グループを検証し、空グループ・無効輪郭・自己交差・共有辺高さ不一致を検出
- 屋根グループ単位で生成済みの屋根部材・庇・妻壁を削除/再生成
- 同一屋根グループ内の共有境界から棟木・谷木・隅木系のジョイント部材を生成
- 同一屋根グループの外周屋根端部から妻壁を生成
- 屋根面から外周梁を生成し、3D明示座標を持つ斜め部材として表示
- 屋根面からピッチ指定の登り梁を生成し、勾配方向の3D明示座標部材として表示
- 屋根外周梁と登り梁の交点は外周梁を分割して節点共有
- 屋根部材を外周梁/登り梁/棟木/谷木/隅木などの役割別に色分けし、集計で本数と延長を確認
- X方向/Y方向の風圧用投影面積と、面材単位重量による地震用重量を集計
- 数量集計パネルで面材別・屋根部材別の明細を確認し、集計CSV/詳細CSVとして出力
- 荷重（面荷重 / 線荷重 / 点荷重）の作成・選択・編集・削除
- 支点（境界条件）の配置・編集・削除（6自由度: DX/DY/DZ + RX/RY/RZ をチェックボックスで指定、ピン/剛/全解除プリセット付き）
- 支点の表示/非表示切替（「支点表示」チェックボックス。非表示時は2D/3D描画とクリック選択をスキップ）
- ノード（端点）のドラッグによる形状変更
- 線材のプロパティパネルで始点・終点のX,Y座標を数値入力で直接編集可能
- パン（右ドラッグ / 中ボタン / Space+ドラッグ）・ズーム（マウスホイール）
- グリッド表示 + スナップ（グリッド / 既存ノード吸着）
- 広域選択モード（「広域選択」チェックボックスでON/OFF。ONにするとクリック許容範囲が広がり、グリッドからズレた部材も選択しやすくなる）
- 2Dレイヤー表示モード（全レイヤー / 現在のみ / 他レイヤー薄表示）を切替
- 他レイヤー選択ロックで、薄表示の下階を参照だけにして誤選択を防止
- 表示プリセット（入力用 / 確認用 / 3D確認用）と線材・面材・荷重・線材種別・断面フィルタ
- 原点と軸方向を左下に常時表示（配置の基準）
- レイヤー（Zレベル）管理: 名前・高さの編集、追加・削除（z値ソート表示、重複禁止、使用中レイヤー削除不可）
- 階コピー: コピー元階の線材・面材・荷重・支点をコピー先階へ複製（柱/鉛直ブレースはコピー先階を下端として上端階を再設定）
- ツール選択コンボボックスで要素 / 線材 / 面材 / 荷重 / 支点を切替
- プロパティパネルで線材/面材/荷重/支点属性を編集
- 線材: 断面、始点/終点座標(X,Y)、端部条件 I/J（ピン / 剛 / バネ）、バネ記号を編集
- 線材ツールでは、梁・水平ブレースは現在レイヤー、柱・鉛直ブレースは下端レイヤーで管理し、上端レイヤーを自動表示
- 配置中のプレビューラベルと、2D上の材端条件記号表示を切替可能
- モデルチェック: 欠落ノード/階参照、重複線材、ゼロ長線材、孤立ノードなどを一覧表示
- 解析JSON/CSV出力前プリフライト: 元モデル整合、必須物性、独立成分ごとの剛体6自由度拘束を検査し、解析不能な出力を防止
- 面材: 断面、床のみ荷重方向、壁/妻壁の高さ、屋根/庇勾配、単位重量、風圧/地震重量対象を編集
- 屋根面: 外周梁と登り梁をプロパティパネルから生成
- 荷重: 座標、荷重値、色などを編集
- 種別・レイヤー・断面寸法・断面色は表示専用（断面定義から自動反映）
- 床スラブの荷重方向（X / Y / 2方向）を矢印表示
- 壁要素は梁線と重なりにくいよう平面上でオフセット表示
- 断面変更時に色が更新され、平面図と3D表示の両方へ連動
- Undo / Redo
- 通り芯（X/Y方向のグリッド線）の定義・名前/座標編集・2D表示・交点スナップ（通り芯管理モーダル）
- 複数選択（Shift+クリックで追加/解除、空白ドラッグで矩形範囲選択）と一括編集
  - 一括断面変更（種別ごと）、一括削除、グループドラッグ移動
  - ミラーコピー（X=一定 / Y=一定の対称軸を指定）
  - 回転（選択中心まわりに90/180/270°、その場変換）
  - 配列複製（dX/dY オフセット × 複製数）
- 計測ツール（2点間の距離・dX・dYを表示、`D`キー）
- 節点マージ（許容差内の近接節点を統合）と交差部材の自動分割（交差・T字接合部で梁/水平ブレースを分割し節点共有）
- 荷重ケース（DL/LL/EQX/EQY/WX/WY）を荷重ごとに設定、荷重組合せ（ケース×係数）を管理
- DXF下絵インポート（LINE/POLYLINE/CIRCLE/ARC を下絵表示、表示切替・クリア）
- 軸組図ビュー（通り芯を選んで構面の立面を表示。柱・梁・ブレース・レベル線・直交通り芯）
- 自動保存とクラッシュ復元（IndexedDBへ最新5世代を定期保存、保存状態表示・世代選択）
- サンプルモデル（平屋+切妻屋根 / 2階建フレーム）をヘルプメニューからワンクリック読込
- 階高・X/Yスパンのリストから、レベル・通り芯・柱・梁・支点を持つ初期格子フレームを一括生成（階別に階高・断面を設定でき、床・外壁も選択生成）
- 初期格子フレームの基礎生成（GL 下に基礎レベル `FDN` を追加し、地中梁・基礎柱型を生成して支点を `FDN` へ配置）

### 3D Viewer
- 線材を断面寸法（b x h）を反映した直方体として3D表示
- 線材の3D表示は断面形状と線表示を切替可能（面材は面表示のまま）
- 梁の3D断面表示をボックス / H形鋼（強軸） / H形鋼（弱軸）で切替可能
- 3Dレイヤー表示モード（全レイヤー / 現在のみ / 他レイヤー薄表示）を2Dとは独立して切替
- 面材（床スラブを水平面、壁/妻壁を鉛直面）として3D表示
- 屋根面と庇・軒を勾配付きの傾斜面として3D表示
- 3D明示座標を持つ屋根外周梁・登り梁を傾斜部材として3D表示
- 屋根部材の役割色を2D/3D表示で共通化
- 荷重（面荷重=赤スラブ、線荷重=オレンジ線、点荷重=紫球体）を3D表示
- 支点を3D表示（固定=コーン+プレート、ローラー/部分拘束=コーン+球体）
- 3Dビューで部材・面材をクリックすると2Dと共通の選択状態になり、プロパティパネルに反映（選択要素はハイライト表示）
- OrbitControls によるカメラ操作（回転 / パン / ズーム）
- グリッド床・座標軸・ライティング
- CDNからThree.jsの読み込みに失敗した場合はユーザーにエラー通知

## 保存・診断・解析連携の追加機能

- CAD読込は事前検証後に適用します。読込失敗時はモデル・選択・Undo/Redoを保持します。
- 自動保存はIndexedDBへ最新5世代を保存します。ファイルメニューまたはステータスバーの「復元履歴」で保存状態・最終成功時刻を確認し、世代を選んで復元できます。未使用のカスタム定義も復元対象です。
- モデルチェックは重要度・対象種別で絞り込み、全件を閲覧できます。対象ボタンから階・選択・カメラを移動します。表示に必要なフィルタは解除されます。
- 3Dタブでは「3D表示・出力」からX/Y/Z切断、位置・反転、選択要素の単独表示、選択への移動、GLB出力を操作します。切断面は開いたままで、GLBは表示対象をm単位で出力します。
- 「解析結果・荷重配分」で線形静的解析結果JSONを読み込み、変形倍率・表示面を選び、変位と反力を確認できます。対応するモデル内容が変わった結果は受け付けません。
- 単一部材上の線荷重と一方向の矩形面荷重は、支持部材と荷重方向を明示して配分を確認できます。解析JSON出力は元の荷重を配分荷重で置き換え、二重計上しません。端点への静的な集中化は合力・モーメントを保存しますが、分布荷重による部材内曲げを再現する等価節点荷重ではありません。
- 外部PythonツールでOpenSeesPyの線形静的解析とIFC4の柱・梁出力を行えます。バックエンドは不要です。対応範囲・手順は [解析・IFCツール](docs/analysis-tools.md) を参照してください。

## Roof Workflow

屋根入力は以下の順序で進めると、面材、屋根部材、妻壁、数量集計のつながりを確認しやすくなります。

1. 床・外壁などの輪郭を選択して屋根面を自動生成するか、面材ツールで屋根面または庇・軒を矩形/ポリライン入力します。自動生成は片流れ、切妻X棟、切妻Y棟、寄棟を選べます。
2. 切妻/寄棟の自動生成は軸に平行な矩形輪郭が対象です。複雑な屋根、入隅を持つ屋根、穴付き形状は、共有辺を持つ複数の屋根面に分割します。
3. 同じ棟・谷・隅木を構成する屋根面に同じ `roofGroupId` を設定します。庇・軒は勾配付き面として扱いますが、屋根グループ部材生成の対象外です。
4. 各屋根面で勾配、登り方向、基準高さを設定し、3D表示で傾斜方向を確認します。
5. 屋根面ごとに外周梁を生成します。同一 `roofGroupId` 内の共有辺は外周梁ではなく、棟/谷/隅木のジョイントとして扱われます。
6. 必要なピッチで登り梁を生成します。登り梁端部が外周梁の途中に乗る場合は、外周梁が分割されて節点共有されます。
7. 屋根グループ単位で棟/谷/隅木、外周庇、外周傾斜辺からの妻壁を生成します。再生成前にはグループ検証と生成要素削除を使い、自己交差や共有辺高さ不一致を確認してから再生成できます。
8. 風圧対象、地震重量対象、単位重量を設定し、数量集計でX/Y方向投影面積、地震用重量、屋根部材の役割別本数・延長を確認します。面材明細と屋根部材明細はパネル内で展開でき、集計CSV/詳細CSVとして出力できます。

共有辺を持たない独立した庇や片流れ屋根は、屋根グループを分けるか庇・軒として入力すると、部材生成の意図が明確になります。

### Roof Auto-Generation Notes

- **片流れ/単一面**: 矩形とポリゴン輪郭に対応します。複雑な外形をそのまま1枚の屋根面として作りたい場合に使います。
- **切妻X棟 / 切妻Y棟 / 寄棟**: 軸に平行な矩形輪郭に対応します。非矩形・回転矩形・穴付き形状では生成されません。
- 自動生成は屋根面だけを作成します。外周梁、登り梁、棟/谷/隅木、庇、妻壁は屋根面生成後に屋根グループ単位で生成します。
- 屋根グループ検証は、空グループ、3点未満の無効輪郭、自己交差、共有辺の高さ不一致を検出します。問題がある場合は対象屋根面や勾配/基準高さを見直してください。

### Data I/O

CADデータ（図面情報）とユーザー定義（材料・断面・バネ）は**別ファイルとしても分離管理**できます。

- **CAD保存/CAD読込**（ファイルメニュー）: 図面データ（ノード・線材・面材・荷重・支点・レイヤー・設定）をJSONファイルとして保存/読込
  - 材料カタログは全件、断面・バネはデフォルト定義と使用中のカスタム定義がCADファイルに含まれます
  - CAD読込時、既にメモリ上にあるカスタムユーザー定義は維持されます
  - 旧バージョンで保存されたファイルも後方互換で読込可能
- **ユーザー定義エクスポート/インポート**（モデル → ユーザー定義モーダル）: カスタム材料・断面・バネ定義を別のJSONファイルとして管理
  - インポート時、同名の定義が既に存在する場合（CADファイルから読込済みの定義を含む）はスキップされ、件数が通知されます
  - 断面定義・バネ定義にはメモ（説明テキスト）を付与可能
- **数量CSV/詳細CSV出力**（右パネルの集計）: 集計CSVは階別合計と屋根部材の役割別合計、詳細CSVは面材別・屋根部材別の明細を出力
- **解析用モデル出力**（解析メニュー）: 共有3D節点・要素コネクティビティ・断面・材端条件・支点・荷重ケース別荷重・荷重組合せをソルバー中立のJSON/CSVで出力（単位: mm, N）
  - 出力直前にプリフライトを実行し、未定義材料/ばね/質量源、元モデル整合エラー、要素なし、または独立成分に未拘束の剛体モードがある場合は出力を中止
  - 複数の独立成分や線材に接続しない支点は警告としてモデルチェック欄に表示（剛性行列や内部機構の検査は下流ソルバー側で実施）
- **図面出力**（ファイルメニュー）: 平面図をDXF（R12系 ENTITIES、部材/面材/通り芯をレイヤー分け。レイヤー名は31文字以内）またはPNGで出力
- **DXF下絵読込**（ファイルメニュー）: DXFのLINE/LWPOLYLINE/POLYLINE/CIRCLE/ARCを下絵として取り込み（CADデータに保存される）
- ノード・部材・面材・荷重・支点IDはCAD JSONに保存され、読込後も保持される
- schemaVersion による互換性管理

### UI

- 上部メニューバー: **ファイル / 編集 / モデル / 表示 / 解析 / ヘルプ**。CAD保存・読込、図面出力、定義管理などを目的別に整理
- 左パネル: **入力する階 → 作成する部材 → 配置条件**の順に操作。梁・柱・ブレース・床・壁・屋根をボタンで直接選び、平面図をクリックして配置
- 部材ごとの配置案内、現在の階・高さ・ツール、元に戻す/やり直すボタンを表示。3D表示中に入力ボタン・ツール選択・ショートカットで入力を選ぶと平面入力へ戻る
- 入力途中でツール・種別・階を変更すると、未確定の始点を解除。配置済みモデルは保持
- 右パネル: **プロパティ / 集計 / チェック**のタブ切替。部材選択時はプロパティ、診断実行時はチェックを表示
- 表示フィルタは「表示 → 表示設定」で共通・平面・3Dに分類。階コピー・初期モデル生成・通り芯・ユーザー定義は「モデル」、接続整理は「編集」から操作
- 「座標で入力」でX・Yを数値指定し、通常のクリックと同じ規則・履歴で部材を生成。未確定点数、要素数、選択IDも文字で確認
- 「モデル → 要素一覧」でID・断面・階・種類から要素を探して選択。50件ずつ表示し、選択後はプロパティで編集
- スナップは配置条件の直下に常時表示。入力対象が表示フィルタで隠れている場合は、表示設定への案内を表示
- メニューはクリック・矢印キー・Enterで操作でき、Esc・外側クリックで閉じる。入力パネルと確認パネルは幅調整と折り畳みに対応

- 設定モーダル（右上の設定ボタン）: テーマ切替（ダーク/ライト）、言語切替（日本語/英語）
- レイヤー管理モーダル（モデル → レイヤー管理、または入力階横の管理ボタン）: レイヤーの追加・名前/高さ編集・削除
- 簡易マニュアル（ヘルプ → ヘルプボタンでモーダル表示、多言語対応）
- 設定はブラウザ（localStorage）に保存

座標での入力・要素一覧・ブラウザー操作AI向けの参照は [座標入力と要素一覧](docs/coordinate-input.md) を参照してください。

UIの状態同期と構成を見直した内容は [v1.3.1再点検記録](docs/ui-review-1.3.1.md) を参照してください。

### 材料・断面・バネ定義

- 材料、断面、バネは「モデル → ユーザー定義」で管理
- 材料は E・G・密度、線材断面は A・Iy・Iz・J の明示上書き、バネは kr・kt を設定可能
- 既定値（削除不可）
  - 線材: 梁 `_G` (b=200, h=400), 柱 `_C` (b=105, h=105), 水平ブレース `_H` (b=20, h=20), 鉛直ブレース `_V` (b=20, h=20)
  - 面材: 床 `_S`, 外壁 `_OW`, 壁 `_IW`, 屋根 `_R`, 庇/軒 `_E`, 妻壁 `_GW`
  - バネ: `_SP`（回転バネ）
- ユーザー定義名の先頭に `_` は使用不可
- 既定名と同名のユーザー定義は作成不可
- 同グループ一覧で既定値・ユーザー定義を確認可能
- 線材の断面定義では、配置時に使う I端/J端の材端条件プリセット（ピン / 剛 / バネ）を登録可能
- ユーザー定義は登録後に「名前以外（寸法・色・材端プリセット・メモ）」を更新可能
- ユーザー定義は削除可能（ただし使用中の定義は削除不可）

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `V` | Element tool - 要素（選択・編集・削除） |
| `M` | Line tool - 線材 |
| `F` | Surface tool - 面材 |
| `L` | Load tool - 荷重 |
| `S` | Support tool - 支点 |
| `D` | Measure tool - 計測 |
| `Shift + Click` (Element tool) | Add / remove member in multi-selection |
| `Drag on empty space` (Element tool) | Marquee (rectangle) member selection |
| `Enter` (Surface Polyline) | Close polyline to polygon |
| `Esc` | Cancel / Deselect / Close modal |
| `Delete` | Delete selected element(s) |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Right Drag` / `Middle Drag` / `Space + Drag` | Pan |
| `Shift` (Line tool) | Angle constraint (0/45/90) |

## Tech Stack

- **Vanilla JavaScript** (ES Modules) -- ビルドツール不要
- **Canvas 2D API** -- 2D CAD 描画
- **three.js v0.170.0** (CDN / ESM) -- 3D Viewer
- 単位系: **mm**

## Project Structure

```
element-modeler/
├── index.html          # Entry point / Layout / importmap
├── style.css           # Dark/Light themes / CSS Grid layout / Modal
├── favicon.svg         # Favicon
├── package.json        # Local checks, browser tests, benchmarks
├── LICENSE             # MIT License
├── THIRD_PARTY_LICENSES.md  # Third-party license details
├── js/
│   ├── app.js          # App init / Module wiring / Theme / Lang / Help
│   ├── state.js        # Data model (nodes, members, surfaces, loads, supports, layers) / CRUD / JSON serialization
│   ├── roof-geometry.js # Shared roof plane geometry / projected areas / generated member lines
│   ├── history.js      # Undo/Redo (snapshot, max 50)
│   ├── grid.js         # Grid drawing / Snap calculation
│   ├── canvas2d.js     # 2D canvas (pan/zoom camera, rendering)
│   ├── tools.js        # Select / Member / Surface / Load / Support tools / Keyboard shortcuts
│   ├── viewer3d.js     # 3D scene (three.js, BoxGeometry, OrbitControls)
│   ├── ui.js           # Toolbar / Property panel / Status bar / i18n apply
│   ├── io.js           # JSON export/import
│   ├── i18n.js         # i18n dictionary (ja/en) / t() helper
│   ├── domain/, state/, commands/  # Model contracts and edit transactions
│   ├── persistence/   # Validated imports and recovery generations
│   ├── ui/, tools/    # Feature-specific controls and interaction handlers
│   ├── render/        # Scheduling, indexes, clipping and GLB
│   └── analysis/      # Load assignment and result inspection
├── scripts/           # Local benchmarks, solver and IFC CLIs
├── test/, tests/e2e/   # Unit and browser tests
├── docs/              # Contracts and verification reports
└── README.md
```

### Architecture

公開APIは `AppState` / `UI` / `ToolManager` を維持し、次の責務に分離しています。

| 配置 | 責務 |
|---|---|
| `js/domain/` | モデルの純粋な既定値・正規化、診断形式 |
| `js/commands/` | 実変更の判定、1操作1履歴の編集コマンド |
| `js/persistence/` | 読込の事前検証、内部履歴、非同期世代保存、復元UI |
| `js/ui/properties/` | 線材・面材・荷重・支点のプロパティパネル |
| `js/ui/user-def/` | カスタム定義のフォーム・一覧・編集コマンド |
| `js/tools/` | 選択・配置・荷重・計測などのツール動作 |
| `js/render/` | 変更時描画、表示用索引、切断、GLB出力、資源解放 |
| `js/analysis/` | 荷重配分、モデル照合、結果表示と操作パネル |
| `scripts/analysis_*.py` | ソルバー・IFCの外部CLI |

CAD保存は使用中の定義を中心にまとめ、CAD読込は既存カスタム定義を維持します。
Undoは全内部状態を復元し、自動保存は未使用定義も含む復元データを保存します。この3つの保持範囲を分け、ファイル読込のマージ規則がUndoへ入り込まないようにしています。
描画は変更時に要求し、選択色の変更だけでは3D形状を全再生成しません。テーマ・言語はlocalStorageへ、復元世代はIndexedDBへ保存します。

## Data Format (JSON)

### CADデータ（図面情報）

「CAD保存」で出力されるファイル。材料カタログは全件、断面・バネカタログは
デフォルト定義と使用中のカスタム定義を含みます。

```json
{
  "schemaVersion": 13,
  "meta": {
    "name": "sample",
    "unit": "mm",
    "createdAt": "2026-02-11T00:00:00Z"
  },
  "settings": {
    "gridSize": 1000,
    "snap": true,
    "wallDisplayOffset": 120,
    "showSupports": true,
    "widePick": false
  },
  "levels": [
    { "id": "L0", "name": "GL", "z": 0 },
    { "id": "L1", "name": "2F", "z": 2800 }
  ],
  "nodes": [
    { "id": 1, "x": 0, "y": 0, "z": 0 },
    { "id": 2, "x": 5000, "y": 0, "z": 0 }
  ],
  "materialCatalog": [
    { "name": "steel", "E": 205000, "G": 79000, "density": 7850, "isDefault": true }
  ],
  "sectionCatalog": [
    { "target": "member", "type": "beam", "name": "_G", "material": "steel", "b": 200, "h": 400, "color": "#666666", "memo": "", "defaultEndI": { "condition": "pin", "springSymbol": null }, "defaultEndJ": { "condition": "pin", "springSymbol": null }, "isDefault": true },
    { "target": "member", "type": "beam", "name": "B300x500", "material": "steel", "b": 300, "h": 500, "color": "#123456", "memo": "カスタム梁", "defaultEndI": { "condition": "rigid", "springSymbol": null }, "defaultEndJ": { "condition": "spring", "springSymbol": "_SP" }, "isDefault": false }
  ],
  "springCatalog": [
    { "symbol": "_SP", "kr": null, "kt": null, "memo": "回転バネ", "isDefault": true }
  ],
  "analysisSettings": {
    "massSources": { "DL": 1, "LL": 0.3, "EQX": 0, "EQY": 0, "WX": 0, "WY": 0 },
    "selfWeightMode": "fromDensity"
  },
  "members": [
    {
      "id": "M1",
      "type": "beam",
      "startNodeId": 1,
      "endNodeId": 2,
      "sectionName": "B300x500",
      "levelId": "L0",
      "color": "#123456",
      "topLevelId": null,
      "bracePattern": "single",
      "endI": { "condition": "rigid", "springSymbol": null },
      "endJ": { "condition": "rigid", "springSymbol": null }
    }
  ],
  "surfaces": [
    {
      "id": "S1",
      "type": "wall",
      "sectionName": "_IW",
      "levelId": "L0",
      "topLevelId": "L1",
      "loadDirection": "twoWay",
      "heightMode": "waist",
      "bottomOffset": 0,
      "topOffset": 1200,
      "includeWind": true,
      "includeSeismicWeight": true,
      "unitWeight": 500,
      "color": "#b57a6b",
      "x1": 0,
      "y1": 0,
      "x2": 5000,
      "y2": 0,
      "shape": "line",
      "points": [{ "x": 0, "y": 0 }, { "x": 5000, "y": 0 }]
    }
  ],
  "loads": [ ... ],
  "supports": [
    {
      "id": "SUP1",
      "x": 0, "y": 0,
      "levelId": "L0",
      "dx": true, "dy": true, "dz": true,
      "rx": false, "ry": false, "rz": false
    }
  ]
}
```

- `materialCatalog` には E・G・密度、`sectionCatalog` には断面形状（矩形・H形鋼・ボックス）、形状寸法、任意の A・Iy・Iz・J 上書き、せん断用断面積比 Ay/A・Az/A、`springCatalog` には kr・kt が含まれます
- `materialCatalog` は未使用のカスタム材料も含む全件を保存します
- `sectionCatalog` / `springCatalog` にはデフォルト定義＋使用中のカスタム定義が含まれます（未使用のカスタム定義は含まれません）
- 断面定義には `memo`（説明テキスト）フィールドが含まれます
- `nodes` / `levels` の `id` はJSONに保存されます。節点IDと `members` の節点参照は数値で出力されます
- `members` / `surfaces` / `loads` / `supports` の `id` はCAD保存に含まれ、読込後も保持されます
- 旧バージョンで保存されたファイルも後方互換で読込可能
- schemaVersion 10 以降、`endI` / `endJ` が未指定の線材はピンとして読み込まれます（明示された材端条件は保持されます）

### ユーザー定義ファイル

「モデル → ユーザー定義 → エクスポート」で出力されるファイル。カスタム材料・断面・バネ定義を含みます。

```json
{
  "userDefinitions": true,
  "materials": [
    { "name": "project-steel", "E": 200000, "G": 77000, "density": 7800, "isDefault": false }
  ],
  "sections": [
    { "target": "member", "type": "beam", "name": "H300x150", "material": "steel", "b": 150, "h": 300, "shape": "hSection", "flangeThickness": 9, "webThickness": 6, "shearAreaRatioY": 0.8, "shearAreaRatioZ": 0.6, "color": "#123456", "memo": "カスタム梁", "defaultEndI": { "condition": "rigid", "springSymbol": null }, "defaultEndJ": { "condition": "spring", "springSymbol": "SP1" } }
  ],
  "springs": [
    { "symbol": "SP1", "kr": 500000, "kt": null, "memo": "カスタムバネ" }
  ]
}
```

### 解析エクスポート v2

「解析JSON出力」「解析CSV出力」は `element-modeler-analysis` version 2 を出力します。
要素・支点・荷重は1始まりの数値IDを持ち、CAD上のIDは `sourceId` に保持されます。
形式判定は `*_analysis_*` というファイル名ではなく、JSON/CSV内の `format` と
`version` を正とします。

v2には generator・生成日時・右手系/Z鉛直・節点順・単位宣言、E/G/密度、
A/Iy/Iz/J、断面形状（矩形・H形鋼・ボックス断面）、せん断用断面積比 Ay/A・Az/A、ばねkr/kt、荷重ケース別の質量換算係数、自重の二重計上防止モードが
含まれます。組み込み物性と質量係数は試行値であり、設計適合値ではありません。
解析前に「解析出力設定」と「ユーザー定義」で確認してください。

詳細なフィールド、断面形状の算定式、警告ゲート、v1との差分は
[解析エクスポート v2 仕様](docs/analysis-export-v2.md)を参照してください。

## Getting Started

```bash
# Clone
git clone https://github.com/Takayuki-Minagawa/element-modeler.git
cd element-modeler

# Create a Python environment with uv
uv venv --python 3.13
source .venv/bin/activate

# Start local server (ES Modules require HTTP)
python -m http.server 8080

# Open in browser
# http://localhost:8080
```

## Testing

開発用Node.jsは24 LTS（`.nvmrc`）、互換確認対象は22以降です。アプリの実行自体にNode.jsは不要です。

```bash
npm ci
npm run check

# ローカルのブラウザ検証（初回のみブラウザをインストール）
npx playwright install chromium firefox webkit
npm run test:e2e

# 固定モデル100/1,000/10,000部材の性能測定
npm run benchmark
```

E2Eでは固定版Three.jsをローカル配信し、CDN通信に依存しない検証を行います。
性能計測方法・測定結果は [性能検証](docs/performance.md)、保存の契約は [保存・復元](docs/persistence.md)、状態管理は [モジュール契約](docs/phase1-module-contracts.md) を参照してください。

主なテスト対象:
- 断面/バネの命名ルール（先頭`_`禁止、既定名重複禁止）
- 断面変更時の寸法・色反映
- 線材断面の材端プリセット反映と配置済み部材の材端保持
- CAD JSON保存時のカタログ収録範囲と要素IDのラウンドトリップ
- CAD読込時のカスタム定義保持・後方互換
- 面材色解決の2D/3D共有ロジック（スモーク）

## Version Management

バージョンの正本は `package.json` の `version` です。  
表示用バージョン（`Ver.<semver>`。例: `Ver.1.0.1`）は `index.html` / `README.md` に自動同期します。

```bash
# 例: 1.0.2 -> 1.0.3
npm version 1.0.3

# 表示バージョンを同期
npm run version:sync

# 不整合チェック（CIでも実行）
npm run version:check
```

運用ルール:
- `index.html` と `README.md` のバージョン表記は手編集しない
- バージョン更新時は `package.json` を更新し、`version:sync` を実行する
- `version:check` が失敗した場合は同期漏れまたは `package-lock.json` の不整合を修正する

## Deploy to GitHub Pages

1. GitHubの **Settings > Pages > Source** を **GitHub Actions** に設定します。
2. ローカルで `npm ci`、`npm run check`、`npm run test:e2e` を実行します。
3. 変更をレビューしてmainへマージします。
4. 公開が必要な時だけ **Actions > Deploy to GitHub Pages > Run workflow** でmainを選びます。

Actionsの利用量を抑えるため、CIと配信はともに `workflow_dispatch` のみです。
配信ワークフローはmain以外では実行せず、同一チェックアウトの検証に成功してから配信ファイルを作成します。
日常の修正・レビューにはローカル検証を使用します。CIだけをGitHub上で確認したい場合は **CI > Run workflow** を実行します。

## Browser Support

Chrome / Edge / Safari / Firefox (ES Modules + importmap 対応のモダンブラウザ)

## License

MIT License - 詳細は [LICENSE](LICENSE) を参照

### Third-Party Libraries

| ライブラリ | バージョン | ライセンス | 用途 |
|-----------|-----------|-----------|------|
| [three.js](https://github.com/mrdoob/three.js) | 0.170.0 | MIT | 3D Viewer (CDN) |
| [Playwright](https://github.com/microsoft/playwright) | ^1.63.0 | Apache-2.0 | Browser tests (dev) |
| [ESLint](https://github.com/eslint/eslint) | ^9.0.0 | MIT | JS Lint (dev) |
| [HTMLHint](https://github.com/htmlhint/HTMLHint) | ^1.1.0 | MIT | HTML Lint (dev) |
| [Stylelint](https://github.com/stylelint/stylelint) | ^16.0.0 | MIT | CSS Lint (dev) |

詳細は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照
