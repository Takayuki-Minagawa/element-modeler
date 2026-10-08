# 床振動モデル連携の更新計画・データ契約

対象: Ver.1.7.0 / CAD JSON schema 14。schema 13との互換性を維持し、床振動ツールとのデータ交換項目を追加する。

追補: Ver.1.8.0でパネル接合とせん断変形設定を追加した。[schema 15の仕様](floor-vibration-schema15.md)を参照。

## 更新計画

1. schema 13の合成モデルを回帰用fixtureとして保存し、要素ID・座標・材端条件・既存重量の保持を確認する。
2. 優先度「高」の方向別材端ばねと、「中」の断面メタデータ・せん断面積・面材厚さと重量内訳を実装する。
3. ユーザー定義フォーム・一覧表、CAD保存、ユーザー定義保存、履歴・復元、解析出力まで新しい値を渡す。
4. 単体・解析契約・lint・3ブラウザE2Eを実行し、変更をレビューしてPRにまとめる。

§2-4の `panelDirection` / `endRotationalSpring` / `edgeSprings` / `kv` は、要望書どおり将来相談の対象とする。今回の更新に床の振動解析ソルバーや等価梁化は含まない。

## 既存定義への回答

| 項目 | element-modelerの定義 |
| --- | --- |
| `Iy` | 断面幅 `b`、せい `h` に対し、矩形は `b*h³/12`。水平梁の鉛直曲げに対応。H形断面も同じ軸。 |
| `Iz` | 矩形は `h*b³/12`。水平梁の水平曲げに対応。任意方向の部材ではグローバル鉛直・水平ではなく部材ローカル軸で解釈する。 |
| `J` | ねじり定数（mm⁴）。 |
| `shape` | `rectangle`、`hSection`、`boxSection` の3種類。`box` / `pipe` / `channel` / `angle` は未対応。 |
| 寸法 | 全形状で `b`, `h`（mm）。`hSection` は `webThickness`, `flangeThickness`、`boxSection` は `boxThickness` を使用。 |
| 材料 | `E`, `G`: N/mm²、`density`: kg/m³。 |
| `kr` | 材端曲げの共通回転剛性（N·mm/rad）。方向別未入力時の共通値として保持。 |
| **`kt`** | **既存定義は並進剛性（N/mm）。ねじり剛性ではない。** 旧キーの意味を維持するため変更しない。Beam-TrussStructMaker側の `kt → ねじり` の対応を修正する必要がある。ねじりの省略時条件は取り込み側の規則で決める。 |
| `surfaces[].unitWeight` | 面材の合計重量（N/m²）。質量そのものではない。 |
| 支点 | `dx/dy/dz/rx/ry/rz: true` はその自由度を拘束。 |

## schema 14で追加するキー

### ばね

```json
{"symbol":"ExampleEnd","kr":200000000,"krY":200000000,"krZ":"rigid","kt":null}
```

`krY` / `krZ` は部材ローカルY/Z軸回りの曲げ回転剛性（N·mm/rad）。各方向は `krY ?? kr` / `krZ ?? kr` で解決する。方向値も共通値も `null` なら未入力のまま扱う。

`kr`, `krY`, `krZ`, `kt` は正の有限数値、`"pin"`、`"rigid"`、`null` を受け付ける。0・負数・不正な文字列は拒否する。未入力を0へ変換しない。指数表記の入力も保存時はJSON numberになる。`kt` の単位は従来どおりN/mm。

### 線材断面

| キー | 内容 |
| --- | --- |
| `designation` | 任意の鋼材記号。未入力は `null`。記号による形状の自動変更や新形状の計算は行わない。 |
| `propertySource` | `catalog` / `computed` / `manual` / `null`。断面値の由来を記録。旧データの由来は推測せず `null`。 |
| `Avy`, `Avz` | ローカルY/Z方向のせん断面積（mm²）、正の数値または `null`。曲げモーメントの軸名と取り違えないこと。 |

既存の `A`, `Iy`, `Iz`, `J` の優先順位は維持する（入力値があれば入力値、無ければ寸法から算定）。`propertySource` は由来の記録であり、値の優先順位を変更しない。Hのフィレット・箱形の角Rは既存どおり考慮しない。

解析JSON v2は互換性のため既存の `propertySource: {A,Iy,Iz,J}`（実際の値の解決経路）を維持し、CADの由来は `declaredPropertySource` に渡す。`Avy` / `Avz` があれば解析の `Ay` / `Az` に優先して使い、無ければ既存の面積比設定を使う。

### 面材断面

```json
{"target":"surface","type":"floor","name":"ExampleFloor","material":"ExamplePanel","thickness":75,"selfWeightMode":"fromDensity","additionalWeight":125}
```

`thickness` は正のmm値または `null`。`selfWeightMode` は `manual` / `fromDensity` / `null`。`additionalWeight` は0以上のN/m²値または `null`。材料参照・板厚・付加重量は面材断面で共有する。

`fromDensity` で材料密度・板厚・付加重量が全て入力済みの場合、対応する面材の合計重量を次式で更新する。

```text
unitWeight [N/m²] = density [kg/m³] × thickness [mm] / 1000 × 9.80665 [m/s²]
                   + additionalWeight [N/m²]
```

`additionalWeight: 0` は付加重量なしの明示入力。`null` は未入力として区別する。材料が存在しない、板厚または付加重量が未入力の場合は算定できない旨を画面に表示し、既存の合計重量を維持する。`manual` / `null` は従来の面材ごとの合計重量入力を維持する。断面または材料密度の変更時は配置済み面材にも反映する。

## 互換性と回帰テスト

旧データ読込時に断面名やメモから板厚・付加重量・由来を自動推定しない。新規キーは `null` とし、利用者が明示入力した後から追加機能を使う。

CAD保存の「使用中断面・ばねのみ収録」、ユーザー定義保存の「未使用定義も収録」という既存の範囲も維持する。

回帰テストには単純な合成モデルを用い、実案件の図面・モデル・資料は収録しない。単一梁と分割梁のモデルで、schema 13から14への変換、入力値の保持、密度による重量計算、履歴と失敗時の状態保持を検証する。

## 検証結果

- `npm ci` 実行済み。
- `npm run check`: Node 540件、Python core 9件、version整合・ESLint・HTMLHint・Stylelintが成功。
- `npm run test:e2e`: Chromium / Firefox / WebKitの全279件が成功。
- 公開用fixtureを合成モデルへ差し替え後、`npm run check` と対象E2E 12件を再実行し、すべて成功。
- 別担当によるコードレビューと、入力フォーム・一覧表の目視確認を実施。Firefoxの入力後保存クリックが表示の移動で失われる問題を修正。
