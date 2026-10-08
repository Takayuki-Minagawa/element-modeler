# 解析エクスポート v2 仕様

`element-modeler-analysis` version 2 は、element-modeler の幾何モデルを
下流の床振動解析 adapter へ渡すための交換形式です。JSON と CSV は同じ
mm-N 系の値を持ちます。

## 識別と責務境界

- ファイル名は従来どおり `<model>_analysis_<timestamp>.json|csv` です。
- 消費側はファイル名ではなく、JSON の `format` と `version`、または
  CSV の `meta,format` と `meta,version` を使って形式を判定します。
- CSVでも生成器・座標系・節点順・警告を`meta`行、単位宣言を`unit`行として
  出力します。
- element-modeler は幾何、接続、元単位、物性、質量換算前提を出力します。
- 解析メッシュ生成、mm から m へのSI正規化、固有値解析、歩行応答、TMD
  設計は下流 adapter / solver の責務です。
- 未定義値は推定しません。`null` または空欄と `meta.warnings` を出力し、
  下流 validator が停止判断できるようにします。

## ルートフィールド

| フィールド | 内容 |
|---|---|
| `format` | 常に `element-modeler-analysis` |
| `version` | 常に `2` |
| `units` | 各量の元単位 |
| `meta` | 来歴、座標系、節点順、警告 |
| `levels` / `nodes` | レベルと共有3D節点 |
| `elements` | 線材要素 |
| `sections` / `materials` | 使用断面と使用材料 |
| `springs` | 使用中の材端ばね |
| `supports` | 支点 |
| `loadCases` / `loads` / `loadCombinations` | 荷重情報 |
| `massSources` / `selfWeight` | 固有値解析用の質量換算前提 |

## ID と節点順

- `elements[].id`、`supports[].id`、`loads[].id` は、それぞれ独立した
  1始まりの連番数値です。
- 使用断面も `sections[].id` で1始まりに採番し、各要素は `sectionId` で
  参照します。同じ断面名が梁・柱など別種別に存在しても参照は一意です。
- 既存の `sectionName` と `sections[].name` / `type` は互換用に維持します。
- CAD上のIDは各行の `sourceId` に保持されます。
- 通常の部材要素は `sourceBranch: "primary"` です。
- Xブレースは1つのCAD部材から2要素へ展開されます。両要素の `sourceId`
  は同じで、2本目を `sourceBranch: "cross"` として一意に復元できます。
- `nodes` は `id` 昇順です。`meta.nodeOrder` は `ascending-id` であり、
  下流の `node_order_hash` はこの順序を入力とします。
- 節点参照 `nodeI` / `nodeJ` / `nodeId` は数値節点IDです。

## 来歴と座標系

`meta` には次を含みます。

```json
{
  "generator": {
    "name": "element-modeler",
    "formatVersion": 2,
    "appVersion": "1.1.0"
  },
  "generatedAt": "2026-08-08T00:00:00.000Z",
  "coordinates": {
    "verticalAxis": "z",
    "handedness": "right"
  },
  "nodeOrder": "ascending-id"
}
```

`generatedAt` はエクスポート実行時刻の ISO 8601 文字列です。

## 単位

| 量 | 単位 |
|---|---|
| 長さ | `mm` |
| 力 | `N` |
| 線荷重 | `N/mm` |
| 面荷重 | `N/mm2` |
| モーメント | `N*mm` |
| 質量 | `kg` |
| E、G | `N/mm2` |
| 密度 | `kg/m3` |
| A | `mm2` |
| Ay、Az、Avy、Avz | `mm2` |
| Iy、Iz、J | `mm4` |
| 回転ばね kr、krY、krZ | `N*mm/rad` |
| 並進ばね kt | `N/mm` |

画面入力が N/m、N/m²、N·m の荷重だけは、従来どおりエクスポート時に
上表の mm-N 系へ変換されます。

## 材料と断面

使用中の材料は `materials` に出力されます。組み込みの試行値は次のとおりで、
ユーザー定義画面から編集できます。

| name | E (N/mm²) | G (N/mm²) | density (kg/m³) |
|---|---:|---:|---:|
| `steel` | 205000 | 79000 | 7850 |
| `rc` | 24000 | 10000 | 2400 |
| `wood` | 10000 | 650 | 500 |

値が組み込み値と一致すると `isDefault: true` です。変更または追加した材料は
`isDefault: false` です。未登録材料を参照する既存モデルでは E/G/density を
`null` とし、材料名を `undefinedMaterialNames` に列挙します。

`sections` は `shape`、形状寸法、せん断用断面積比と、`A` / `Iy` / `Iz` / `J` を持ちます。
`shape` は `rectangle`、`hSection`、`boxSection` のいずれかです。明示値がない
断面特性は、選択した形状から算定します。H形鋼のフィレット、ボックス断面の
溶接・角Rは含めません。

矩形断面（`shape: "rectangle"`）は次の式です。

- `A = b h`
- `Iy = b h³ / 12`
- `Iz = h b³ / 12`
- `J = a t³ {1/3 - 0.21(t/a)[1 - (t/a)⁴/12]}`、`a=max(b,h)`、`t=min(b,h)`

H形鋼（`shape: "hSection"`）では、`flangeThickness=tf`、`webThickness=tw`、
`hw=h-2tf` として、次の式を用います。

- `A = 2 b tf + hw tw`
- `Iy = {b h³ - (b-tw) hw³} / 12`
- `Iz = 2(tf b³ / 12) + hw tw³ / 12`
- `J = {2 b tf³ + hw tw³} / 3`

ボックス断面（`shape: "boxSection"`）では、`boxThickness=t`、
`bi=b-2t`、`hi=h-2t` として、次の式を用います。

- `A = b h - bi hi`
- `Iy = {b h³ - bi hi³} / 12`
- `Iz = {h b³ - hi bi³} / 12`
- `J = 2t(b-t)²(h-t)² / {b+h-2t}`（薄肉閉断面の近似）

`shearAreaRatioY` と `shearAreaRatioZ` は 0 より大きく 1 以下の小数で、
それぞれ `Ay = A × shearAreaRatioY`、`Az = A × shearAreaRatioZ` を表します。
CADに明示せん断面積 `Avy` / `Avz` がある場合、対応する `Ay` / `Az` は明示値を優先します。
比率と明示値は元のまま併記し、どちらも未入力の方向では `Ay` / `Az` を `null` とします。
`Avy` / `Ay` は local y 方向せん断力、`Avz` / `Az` は local z 方向せん断力に対する面積です。
これは曲げの回転軸とは異なり、水平梁の鉛直曲げは `Iy` と local z 方向せん断に対応します。

`propertySource` は従来どおり `A` / `Iy` / `Iz` / `J` ごとの算定経路を持つオブジェクトで、
各値は `rectangle`、`hSection`、`boxSection`、または `explicit` です。
CAD schema 14 の断面全体の申告由来 `propertySource` は別名 `declaredPropertySource`
（`catalog` / `computed` / `manual` / `null`）で出力し、解析 v2 の既存オブジェクトを置換しません。
任意の鋼材記号 `designation` もそのまま出力し、未入力は `null` とします。
鋼材記号や申告由来から数値を推定・置換する処理は行いません。
明示された b/h、形状寸法、A/Iy/Iz/J/Avy/Avz、せん断面積比が不正な場合は読込を拒否します。

CSV の `sect_header` / `sect` 行では、従来列の後ろに `shape`、
`flange_thickness_mm`、`web_thickness_mm`、`box_thickness_mm`、
`shear_area_ratio_y`、`shear_area_ratio_z`、`Ay_mm2`、`Az_mm2` を出力します。
さらに `designation`、`declared_property_source`、`Avy_mm2`、`Avz_mm2` を末尾に追加します。

## ばね

使用ばねは `symbol`、`kr`、`krY`、`krZ`、`kt`、`memo`、`isDefault` を持ちます。
`kr` は両曲げ方向に共通の材端回転ばね基本値です。`krY` は local y まわり
（水平梁の鉛直曲げ）、`krZ` は local z まわり（水平梁の水平曲げ）の上書き値です。
方向値が `null` の場合は `kr` にフォールバックします。出力JSON/CSVは明示値と `null` を
保持するため、下流側でも `effectiveKrY = krY ?? kr`、`effectiveKrZ = krZ ?? kr` を適用してください。

剛性欄は有限正数、`"pin"`（解放）、`"rigid"`（剛結）、`null`（未入力）を受け付けます。
0や負数を解放・未入力の代用にはしません。両曲げ方向のいずれかがフォールバック後も
未入力の場合、`meta.warnings.undefinedSpringStiffness` が `true` となり、対象記号を
`undefinedSpringSymbols` に列挙して出力を停止します。

`kt` は従来どおり任意の **並進剛性（N/mm）** です。ねじり剛性ではなく、`null` に
ねじり剛結の意味はありません。ねじり回転ばねへの読み替えや単位換算は行わないでください。
CSVでは既存 `spring` 列の末尾に `krY_N_mm_rad`、`krZ_N_mm_rad` を追加します。
同梱OpenSees変換器は引き続き明示 `condition: rigid` のみ対応し、ばね値がすべて
`"rigid"` の場合も `condition: spring` を自動変換せず停止します。

## 質量源と自重

`massSources` は荷重ケースごとの無次元換算係数です。既定値は次です。

```json
{
  "DL": 1.0,
  "LL": 0.3,
  "EQX": 0.0,
  "EQY": 0.0,
  "WX": 0.0,
  "WY": 0.0
}
```

空欄にした係数は `null` となり、`undefinedMassSources` と
`undefinedMassSourceCases` で検知できます。

`selfWeight.mode` は次のいずれかです。

- `fromDensity`: 下流が density × A × L から部材自重を算定します。
- `includedInDL`: 自重はDLに含むものとし、密度から再計上しません。

`selfWeight.isDefault` は自重モードが組み込み既定の `fromDensity` かどうかを
示します（質量換算係数の変更とは独立です）。この指定は重力の二重計上を防ぐ
ための契約です。

## 床面区画候補

既存の `areaLoad` は `x1` / `y1` / `x2` / `y2`、`levelId`、`z` を保持します。
下流 adapter はこれを矩形の床面区画候補 (`source_rect`) として利用できます。
独立した床区画エンティティ、床解析メッシュ、合成・非合成、有効幅、直交異方性
は v2 の対象外です。

## 警告ゲート

下流 validator は少なくとも次の真偽値を検査してください。

- `meta.warnings.undefinedSpringStiffness`
- `meta.warnings.undefinedMassSources`
- `meta.warnings.undefinedMaterialProperties`

いずれかが `true` の場合は、対応する配列で対象を表示し、値を推定して解析を
続行しないことを推奨します。

## アプリ側プリフライト

画面からJSON/CSVを出力する直前に、同一の解析モデルを使って次を検査します。

- 元CADモデルの参照整合エラー
- 線材要素が1件以上存在すること
- 使用材料の E/G/density、使用ばねの両曲げ方向（krY/krZ を kr で補完）、全荷重ケースの質量換算係数
- 各要素連結成分の支持条件が、並進3・回転3の剛体6自由度を拘束すること
- 解析断面を参照できない要素がないこと

エラーがある場合、ブラウザからのダウンロードを中止してモデルチェック欄に詳細を表示します。
複数の独立成分と、線材節点に接続しない支点は警告に留めます。剛体拘束は支持点位置から
作る拘束行列のランクで判定し、要素剛性、材端解放による内部機構、数値条件は評価しません。
これらは下流 adapter / solver で別途検証してください。

## v1 からの変更

- `version` を1から2へ変更しました。
- 要素・支点・荷重IDを文字列から数値へ変更し、旧IDを `sourceId` に保存します。
- 既存の節点、接続、b/h、材端、荷重値、荷重組合せフィールドは維持します。
- メタデータ、物性、断面特性、ばね剛性、質量源は追加フィールドです。
- CSVは既存列の並びを維持し、追加列と追加セクションを後置します。
