# パネル接合・せん断変形の設定（schema 15）

Ver.1.8.0では、schema 14の方向別材端ばね・断面・重量情報に加え、面材のパネル方向と接合ばねを保存・編集・出力できる。
schema 1～14も読み込める。追加項目は旧データから推測せず未入力とし、既存の荷重方向・架構・重量を変更しない。

## 面材断面と鉛直ばね

```json
{
  "target": "surface", "type": "floor", "name": "ExamplePanel",
  "panelDirection": "y",
  "endRotationalSpring": "PanelEnd",
  "edgeSprings": {"panelToPanel": "PanelJoint", "panelToBeam": "BeamJoint"}
}
```

- `panelDirection`: 平面上のパネル長手方向 `x` / `y` / `null`。既存の面材 `loadDirection` は変更しない。未指定時の長手方向の決定は取り込み側の責務で、二方向床を一方向パネルへ推定しない。
- `endRotationalSpring`: パネル等価梁の端部鉛直曲げに使う `springCatalog.symbol` または `null`。部材ローカルY回りの `krY ?? kr` を参照する。これは全体Y軸ではなく、平面Y方向に長いパネルの鉛直曲げは全体X回りに対応する。
- `edgeSprings.panelToPanel` / `panelToBeam`: パネル間／パネルと梁間の鉛直ばね記号または `null`。いずれも参照ばねの `kv` を使う。
- `springCatalog.kv`: 鉛直並進剛性（N/mm）。正の有限数値、`"pin"`、`"rigid"`、`null`。0や負値を解放の代わりに使わない。`kt` は従来の並進剛性のままで、`kv`やねじり剛性へ自動変換しない。

同じ床でも位置により剛性が異なる場合は、別の面材断面・ばね記号を割り当てる。長手方向のばね配置位置やメッシュは解析側の設定で指定する。このアプリは面材を有限要素へ自動変換しない。

面材だけから参照されるばねもCAD保存へ含める。使用中の記号は削除できない。未登録記号は編集・読込時に保持し、解析出力前に参照先と用途に応じた剛性を検証する。材端は両曲げ方向、パネル端は鉛直曲げ、縁接合は鉛直並進を検証する。

## せん断変形

`analysisSettings.ignoreShearDeformation` は `true`（無視）、`false`（考慮）、`null`（解析側の既定）の三値。文字列・数値・配列は不正入力として拒否する。解析出力設定画面で編集でき、CAD保存、復元、Undo/Redo、解析JSON/CSVに反映される。

せん断面積を登録することと、せん断変形を考慮することは別の設定である。対応する解析器へ明示値を渡し、未対応の要素へ黙って置き換えない。同梱の静解析Python変換器はEuler–Bernoulliの線材部分集合なので、`false`や面材接合が指定されていれば処理を停止する。

## 解析交換形式と連携先

解析JSON v2は既存フィールドを維持し、`surfaceSections`、`surfaces`、`analysisSettings.ignoreShearDeformation`、`springs[].kv`を追加する。面材の材料も `materials` へ含める。
解析JSON/CSVでは面材の `unitWeight` と断面の `additionalWeight` をN/mm²へ換算する。CAD JSONでは従来どおりN/m²である。
CSVは既存28列の順序を維持し、spring行の末尾へkv、新しい面材・解析設定行へ追加情報を出力する。

Beam-TrussStructMakerのCAD取り込みでは、方向別ばね・明示断面値・床厚/密度/付加重量を使用する。`kt`をねじりとして取り込まない。面材を質量化する場合、同じ床重量を表すDL面荷重を二重に加算しない。

有限回転ばねを有効にする接合では、同じ節点対・同じ回転自由度に等変位拘束を重ねない。並進拘束と回転ばねを分けて設定する。

## 検証

合成モデルで、用途別参照の保存・削除防止、値検証、保存/再読込/Undo、密度重量計算、単位換算、解析出力前診断を確認する。3ブラウザの画面操作と全回帰テストを実行する。実案件の資料・モデル・設定YAMLは公開リポジトリに含めない。
