# 外部解析・荷重配分・IFC変換 / External analysis tools (F4 / F5 / F7)

この機能は、ブラウザの解析用JSON v2を外部Pythonへ渡し、線形静的解析結果を
ブラウザへ戻すための限定実装です。独立した外部CLIとES Modulesで構成します。
OpenSeesPyやIfcOpenShellはブラウザ内では実行しません。

**初期CAD部材の既定の材端はpinです。解析器の初版は両端rigidのみ対応します。**
支点の固定と部材の材端条件は別です。実モデルのpinを解析のためだけにrigidへ変更せず、
まず同梱のrigid片持梁デモで動作確認してください。

## 最短の実行手順 / Quick start

リポジトリのルートから実行します。ファイル名は任意です。

```sh
python3 -m venv /tmp/element-modeler-analysis
/tmp/element-modeler-analysis/bin/python -m pip install -r scripts/analysis-requirements.txt
python3 scripts/analysis_demo.py --output /tmp/cantilever.analysis.json

# 入力検証と変換のみ。OpenSeesPyのimportは不要。
python3 scripts/analysis_opensees.py /tmp/cantilever.analysis.json \
  --case LL --validate-only --emit-python /tmp/cantilever.ops.py

# 実際の解析、反力・変位・部材端力JSONの出力。
/tmp/element-modeler-analysis/bin/python scripts/analysis_opensees.py \
  /tmp/cantilever.analysis.json --case LL --output /tmp/cantilever.result.json

# IFC4と検証レポートの出力。
/tmp/element-modeler-analysis/bin/python scripts/analysis_ifc.py \
  /tmp/cantilever.analysis.json --project-id my-project-001 --output /tmp/cantilever.ifc
```

固定入力は `test/fixtures/analysis/rigid-cantilever.json` にもあります。
`rigid-cantilever-result.json` は実OpenSeesで生成した結果のテスト用fixtureです。
デモはX方向3,000 mmの梁、100×200 mm矩形断面、E=205,000 N/mm²、節点1が6自由度固定、
節点2にLL=-1,000 N（Z方向）。両材端rigidで、自己重量はこのデモ荷重に含みません。
`includedInDL` は密度自重を追加しない契約で、LLだけを解いています。
このデモの先端変位は `-PL³/(3 E Iy) ≈ -0.6585365854 mm`、固定端反力は
`Fz=+1,000 N`、`My=-3,000,000 N·mm` です。

**Apple Silicon:** 試験したPyPI `openseespymac` wheelはIntel用でした。
macOSのuniversal Python 3.9とRosettaが利用できる環境では、OpenSeesの行を次のように実行できます。
arm64のみのPythonを`arch`でIntel用に切り替えることはできません。

```sh
arch -x86_64 /tmp/element-modeler-analysis/bin/python scripts/analysis_opensees.py \
  /tmp/cantilever.analysis.json --case LL --output /tmp/cantilever.result.json
```

IFCは同じvenvのnative arm64 Pythonで検証しました。Linux/Windowsなど他の環境では
対応するPython・OpenSees wheelが必要です。異なるCPU用のwheelを無理にimportしないでください。
試験環境はPython 3.9.6、OpenSeesPy package 3.7.1.2 / 実engine 3.4.0、
IfcOpenShell 0.8.4.post1。結果の`solver.version`はpackage版でなく実engine版です。

## ブラウザからの操作 / Browser workflow

アプリの `js/analysis/workbench.js` が「解析結果・荷重配分 / Results / load assignment」
ボタンとモーダルを提供します。CLI・数学・描画パネルはその下位の独立モジュールです。

ブラウザで往復確認するには、アプリのCADデモ生成器を使います。これはAppStateの公開APIから
CAD保存ファイルと**正確に対応する**解析JSONを同時生成します。

```sh
node scripts/analysis-cad-demo.mjs /tmp/frame-demo
/tmp/element-modeler-analysis/bin/python scripts/analysis_opensees.py \
  /tmp/frame-demo/cantilever.analysis.json --case LL --output /tmp/frame-demo/cantilever.result.json
```

macOS Intel wheelでは上のPythonコマンドに`arch -x86_64`を付けます。
ブラウザの通常CAD読込で`cantilever.cad.json`を開き、解析結果・荷重配分モーダルから
`cantilever.result.json`を読み込むと、変形図と反力を確認できます。
このデモでは任意の配分済み参照JSONの読込は不要です。出力先に同名ファイルがあると生成器は停止します。

1. CADを読み込み、解析JSONを出力します。解析ケースと、両端rigid・支持条件・物性を確認します。
2. Python CLIで、その出力ファイルを解析します。
3. **同じCADモデルを開いた状態で**「解析結果JSON」から結果を読み込みます。
4. XZ/YZ/XY投影と変形倍率を選びます。灰色が元形状、青が変形形状です。
   節点変位・回転・反力・反力モーメントを表で確認します。部材選択ボタンは元CAD IDと枝番を返します。
5. CADの解析内容を変更すると結果は無効になります。解析し直して読み込んでください。

デモの変位は部材長に比べて小さいため、形状を見分けるには倍率10,000〜100,000程度へ
上げる場合があります。SVGの縦横縮尺は同一で、縦軸だけの引き伸ばしは行いません。

CLIデモは**中立解析JSON**で、CAD保存ファイルではありません。通常のCAD読込へ渡せません。
ブラウザでは上の`analysis-cad-demo.mjs`によるCADデモと、そのCADから作った解析JSONを使います。
中立デモ単体を確認する場合は、下記の`mountResultsPanel`へ中立モデルと結果を直接渡せます。

### 配分済みモデルと結果の照合

F5はCADを変更せず、選んだ面/線荷重を節点荷重へ置き換えた**解析JSON全体**を出力します。
このモデルは元CADの解析JSONと荷重が異なるため、結果のfingerprintも異なります。

1. 元のCADで荷重と作用先を明示選択し、配分をプレビューします。
2. 集中配分の制限に同意し「配分後の節点荷重を出力」を押します。
3. 出力した`distributed-analysis.json`をCLIで解析します。
4. 元CADのモーダルで「配分済み解析JSON（任意）」に、そのファイルを読み込みます。
5. 続いて結果JSONを読み込みます。

workbenchは`meta.sourceModelFingerprint`で現在のCADとの来歴を確認し、荷重以外の
幾何・物性・支持条件が変わっていないことも確認します。結果は配分済みモデルそのものの
`modelFingerprint`と照合します。元の面/線荷重と配分後荷重を同時に残すと二重計上になります。
workbenchの`distributedAnalysisModel()`は選択した元荷重を**置換**し、他の荷重を維持して連番を採り直します。
未配分の線/面荷重が同じ解析ケースに残るとCLIは停止します。

## F4: 解析器の対応範囲

| 項目 | 対応・規約 |
|---|---|
| 入力 | `element-modeler-analysis` version 2 JSON。CAD JSON/CSVは不可 |
| 要素 | 3D `elasticBeamColumn`、Euler–Bernoulli線形弾性。beam/column/hbrace/vbraceを直線フレームとして扱う |
| 材端 | 両端の明示`rigid`のみ。pin、spring、未指定を停止。ブレースもトラスには変換しない |
| 支持 | グローバル6自由度の明示boolean。重複支持は拘束のOR。浮遊節点を拒否 |
| 荷重 | `--case`で指定した1ケースのpointLoadのみ。6成分必須、同一節点の荷重は加算 |
| 作用先 | x1/y1/zから距離1e-7 mm以内の節点がちょうど1点。近傍節点への移動はしない |
| 物性 | 使用E/G/A/Iy/Iz/Jの有限正値が必須。既存JSONの値を使用、未定義値の推定なし |
| 自重 | includedInDLでは密度から追加しない。fromDensityは既定で停止 |
| 明示自重省略 | `--self-weight omit`で荷重のみの検討を実行可。結果に省略警告を保存 |
| 組合せ | 今回は解かない。loadCombinationsを自動適用しない |
| 対象外 | 分布荷重の直接入力、シェル、端部解放、ばね、オフセット、断面回転、P-Delta、せん断変形、塑性、動解析、座屈、設計照査 |

密度・massSourcesは今回の静的計算に使用しません。既存プリフライトは別の品質ゲートです。
たとえば未定義の質量係数はブラウザ出力を止める場合がありますが、外部静的CLIでは使用しません。
別ケースの面/線荷重は解析しません。全荷重のloadCase参照は検査します。
要素には断面回転や偏心を表す`rotation/sectionRotation/offsetI/offsetJ/localAxis`を追加できません。

### 単位と座標・符号

一貫したmm–N静的単位系です。長さmm、力N、モーメントN·mm、E/GはN/mm²、
Aはmm²、Iy/Iz/Jはmm⁴、変位mm、回転rad。JSON内の単位宣言を検査します。
元アプリの線荷重N/m、面荷重N/m²、点モーメントN·mは**既存exporterが換算済み**です。
下位のF5 APIやCLIで再換算しないでください。

座標は右手系Z上向きで、Three.js表示座標への変換は適用しません。
部材local xはI→J。`abs(x.z)<0.999`なら基準ベクトルglobal Z、その他はglobal Y。
`local y = normalize(reference × local x)`、`local z = local x × local y`。
X正方向水平梁ならlocal y=global Y、local z=global Zで、Z曲げにIyを使います。
Z正方向柱ならlocal y=global X、local z=global Y。bはlocal y方向、hはlocal z方向です。
Iyはlocal yまわり、Izはlocal zまわり。鉛直近傍の切替しきい値では断面方向が切り替わります。
任意回転指定は対象外なので、斜材は出力の`axes`を確認してください。

反力は支点がモデルに及ぼす作用、回転・モーメントは右手則です。
部材端力はOpenSeesのlocal resisting end forceで、I端6成分、J端6成分の順です。
途中断面の断面力図と同一の符号表現ではありません。

結果パネルの断面力（`memberInternalForces`）は材端力（節点が要素へ与える力）の符号を反転して求めます。
節点荷重のみの範囲では N・Qy・Qz・T は部材内で一定、My・Mz は直線です（局所 x = I→J の距離 s）。

```text
N(s) = -N_I,  Qy(s) = -Qy_I,  Qz(s) = -Qz_I,  T(s) = -T_I
My(s) = -My_I - s·Qz_I,  Mz(s) = -Mz_I + s·Qy_I
```

J端の値は節点 J が要素へ与える材端力と一致します。引張正、モーメントは局所軸まわりの右手則です。
応力図は局所 +y（Qy）、−y（Mz）、+z（N, Qz, T, My）を正側に描きます。右手則では +My の引張側が局所 +z、+Mz の引張側が局所 −y なので、
曲げモーメントは引張側に表示されます。表示面に直交する成分は部材線上に重なります。
成分の最大絶対値が絶対下限（力 1e-6 N、モーメント 1e-3 N·mm）以下、または同じ単位の最大成分の 1e-6 倍以下のときは数値誤差とみなし、図を描きません。
「材端力CSVを出力」は `member-forces-<case>.csv` に load_case・要素・sourceId/branch・節点・長さ・両端の断面力を書き出します。

### CLIと失敗時の扱い

`--emit-python`は数値を埋め込んだ独立実行可能なOpenSeesPyスクリプトを出力します。
それ単体では節点結果を標準出力に表示します。ブラウザ用結果JSONには`--output`を使います。
`--validate-only`はソルバーを実行しません。剛性行列の正則性まで保証しません。
`--validate-only --output`は出力を更新しません。

solverはPlain拘束、RCM番号付け、ProfileSPD、Linear algorithm、LoadControl=1、Staticの1ステップです。
solver失敗、非有限値、6成分の釣合い不成立は成功結果を出力しません。CLI終了コードは成功0、失敗2。
失敗で以前の結果ファイルは上書きしません。古い結果の存在を今回の成功と判断せず終了コードを確認します。
入力と出力の同一パスは禁止。結果は一時ファイルからatomic replaceします。

全体釣合いは原点まわりの`ΣF`と`Σ(r×F+M)`について、荷重と反力の和で検査します。
力許容値は`1e-6 + 1e-8*forceScale N`、モーメントは`1e-4 + 1e-8*momentScale N·mm`。
forceScaleは作用荷重力成分の絶対値和（最小1）、momentScaleは部材長・力・作用モーメントから決定します。
使用許容値は結果に保存されます。機構・数値条件の問題はsolver側で失敗として扱いますが、
釣合い成功だけで実構造のモデル化が適切とは判定しません。

## 結果JSON v1 / Result contract

```text
format: element-modeler-analysis-result
version: 1
status: success
modelFingerprint: sha256:<hex>
fingerprintVersion: typed-json-binary64-v1
solver: {name, version, analysis: linear-static-3d-frame}
loadCase, generatedAt, warnings[], units, coordinates
nodes[]: {id, position:[x,y,z], displacement:[ux,uy,uz,rx,ry,rz],
          reaction:[Fx,Fy,Fz,Mx,My,Mz]}
elements[]: {id, sourceId, sourceBranch, nodeI, nodeJ,
             axes:{x,y,z,length}, localEndForces:[6 at I,6 at J]}
loadAssignments[]: {loadId, sourceId, nodeId, values:[Fx,Fy,Fz,Mx,My,Mz]}
equilibrium: {applied:[6], reactions:[6], residual:[6], tolerance:[6], passed:true}
```

解析節点は複数CAD節点を共有するため、架空の1対1 `sourceId`を付けません。
部材結果は`sourceId`と`sourceBranch`を必ず保持し、Xブレース由来のprimary/crossを区別します。
同じsourceId/branchの重複は入力で拒否します。

fingerprintはルートの全JSONを対象に、`meta.generatedAt`と`meta.generator`だけ除きます。
オブジェクトキーはUTF-16順、配列順は維持し、数値はIEEE754 binary64のbig-endian hex、-0は0と同一です。
型タグ付きJSONをUTF-8化してSHA-256を計算します。PythonとJSの指数表記差は影響しません。
幾何・材端・支持・物性・荷重・枝番・sourceModelFingerprintの変更はハッシュを変えます。
単なる配列並べ替えやモデル名変更も保守的に結果を無効化します。署名や真正性証明ではありません。

`validateAnalysisResult`はhash、形式、units、座標、ケース、節点・要素の全数・ID・参照・source identity、
結果ベクトルの長さ/有限性、位置、釣合いを検査します。
`buildResultView`は並進と端部回転から3次Hermite補間したEuler–Bernoulli変形曲線を作ります。
節点荷重のみで要素内に分布荷重がないという今回の範囲に対応します。ねじれによる断面の回転表示はありません。

## F5: 一方向矩形床・単一線材の配分

これは荷重の作用先を明示確認するための静的配分です。断面の曲げ応答を再現するFE整合荷重ではありません。

| API | 対応・入力 |
|---|---|
| `previewLineLoad` | 1本の直線部材の全長または同一直線上の部分区間。start/endはglobal mm、intensityはglobal 3成分N/mm |
| `previewRectangularSlab` | 水平・座標軸平行・穴なし矩形、均一global-Z圧力N/mm²、明示spanAxis x/y、完全な支持辺2本 |
| `previewToPointLoads` | previewの配分先をv2 pointLoad配列へ出力。明示`acknowledgeLumping:true`必須 |

線荷重：部材長L、区間の端部パラメータa,b（0〜1）、荷重qなら、合力は`F=q*loadedLength`。
合力位置`t=(a+b)/2`から、端部力は`Fi=(1-t)F`, `Fj=tF`。付加節点モーメントは0です。
荷重方向はglobalの任意3成分、傾斜材・逆順端点も対応。部材外や別階からのスナップは行いません。
幾何の一致許容差は1e-7 mmです。

床：spanAxis=xならx=min/maxの支持辺、spanAxis=yならy=min/maxの支持辺へ配分します。
edgeElementIdsはこの順で指定します。部材のI→J向きは逆でも構いません。
支配幅はspan/2、各支持辺への等分布線荷重は`qz=pressure*span/2`。
合力は`pressure*area`で矩形重心に作用し、節点化では各隅へ1/4ずつ渡します。
支持辺より長い部材・分割された支持辺・張出し・多辺支持・台形・傾斜床・二方向床は拒否/対象外です。

各previewは`targets`, 元荷重と配分後の`conservation.original/assigned`、
`forceResidual`, `momentResidual`, `passed`を返します。節点化前後で全3力・全3モーメントを照合します。
力と原点まわりモーメントを保存しても、変位や部材途中の曲げを保存するとは限りません。
例：等分布荷重の片持梁を両端へ半分ずつ集中すると、全反力と支持モーメントは一致しますが、
先端変位は`qL⁴/(6EI)`となり、実等分布荷重の`qL⁴/(8EI)`とは異なります。

UIの方向は荷重値への±1乗数です。負の入力値に-Zを掛けると正方向になるため、
プレビューの合力の符号を確認します。圧力APIは負値が-Z、正値が+Zです。

## 独立UI・統合API / App integration

```js
import { mountResultsPanel, mountLoadPreview } from './js/analysis/panels.js';
import { previewLineLoad, previewRectangularSlab, previewToPointLoads } from './js/analysis/load-distribution.js';
import { modelFingerprint } from './js/analysis/fingerprint.js';
import { validateAnalysisResult, buildResultView } from './js/analysis/results.js';

const resultPanel = await mountResultsPanel(container, analysisModel, resultJSON, {
  language: 'ja', scale: 50, plane: 'xz', component: 'My', // 'none' | 'N' | 'Qy' | 'Qz' | 'T' | 'My' | 'Mz'
  onSelect: ({ elementId, sourceId, sourceBranch }) => selectCadMember(sourceId),
  onExportForces: (csv, loadCase) => saveTextFile(`member-forces-${loadCase}.csv`, csv), // 任意の保存関数。省略時はボタン非表示
});
// CAD変更時に呼ぶ。workbenchは非同期読込中のモデル変更もfingerprintで再確認する。
resultPanel.invalidate();
resultPanel.dispose();

const preview = previewRectangularSlab(analysisModel, {
  rectangle: { x1: 0, y1: 0, x2: 6000, y2: 4000, z: 3000 },
  spanAxis: 'x', edgeElementIds: [1, 2], pressure: -0.005,
  sourceId: 'LD1', loadCase: 'LL',
});
const loadPanel = mountLoadPreview(container, preview, {
  language: 'ja', plane: 'xy', firstId: 1,
  onSelect: selection => selectCadMember(selection.sourceId),
  onExport: pointLoads => replaceOriginalLoadAndDownload(pointLoads),
});
loadPanel.dispose();
```

mount関数は渡されたcontainer内へsectionを追加し、他の子要素を消しません。
`mountResultsPanel`は非同期、`mountLoadPreview`は同期です。
結果パネルの戻り値は`{dispose,invalidate}`、荷重パネルは`{dispose}`。
`language:'ja'|'en'`を受付。モデル、AppState、履歴、既存viewerは変更しません。
ファイル選択・ダウンロード・CAD選択・変更監視・言語再描画はworkbenchの責務です。
SVGは同一縮尺で投影し、変形倍率だけを掛けます。反力は表表示です。
`component`を指定すると`forceDiagramShapes(view, component)`が部材ごとの四角形（部材線＋両端の縦距）を作り、
最大縦距がモデル範囲の15%になるよう縮尺します。`buildResultView`の各memberは`axes`・`endForces`・`forces{N,Qy,Qz,T,My,Mz:[I,J]}`を持ち、
`extremes`に成分別の最大絶対値を返します。`buildMemberForceCSV(view)`は同じ内容のCSV文字列です。
`getLang()`を使うworkbenchとの接続済みAPIは
`initAnalysisWorkbench({state,host,onSelect})` → `{refresh,applyLanguage,dispose}`です。

`buildResultView`の形状座標はCADと同じZ-up mmなので、アプリが独自3D overlayを作る場合にも使えます。
`segments`は既定24、1〜1000。表示には全結果を扱うため大規模モデルの表仮想化は未実装です。

## F7: IFC4限定外部エクスポート

入力は同じanalysis v2。梁・柱以外の要素は**黙って捨てず停止**します。
出力対象を限定したい場合は別の明示モデルを作ってください。IFCは物理部材形状・属性の出力で、
解析用支持条件・材端・荷重・材料構成則をIFC構造解析モデルへ交換するものではありません。

| 内容 | マッピング |
|---|---|
| 階層 | IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey |
| 階 | levels[].id/name/z。mm単位のElevation、配置も同じz |
| 部材 | beam→IfcBeam、column→IfcColumn。levelIdの階に包含、複層柱は開始側の指定階 |
| 断面 | rectangle→IfcRectangleProfileDef、hSection→IfcIShapeProfileDef、boxSection→IfcRectangleHollowProfileDef |
| 形状 | IfcExtrudedAreaSolid。断面中心を節点線に置きI→Jへ部材長だけ押出し |
| 向き | IFC local Z=構造local x、IFC local X=構造local y、IFC local Y=構造local z |
| ID | UUIDv5をIFC GUIDへ圧縮。project-id、Ifcクラス、sourceId/sourceBranchから安定生成 |
| 属性 | Pset_ElementModelerにSourceId/SourceBranch、SectionId/Name、LevelId、MaterialName、hash、ProjectIdentity、軸規約 |

`--project-id`は**同じプロジェクトでは毎回同じ値**を使います。別プロジェクトは別値です。
幾何編集で部材GUIDは維持されます。sourceId/branchまたはbeam/column種別を変えるとGUIDも変わります。
形状はb/h/tf/tw/tに基づき、明示A/I/Jを使って断面形状を逆算しません。
寸法と明示解析特性が異なる場合、IFCの物理形状断面積と解析Aは一致しない場合があります。
フィレット、角R、切欠き、接合部カット、位置偏心、任意断面回転、材料IfcMaterial関連、仕上げは未対応です。

CLIはIFCを文字列へ保存して再読込し、次を確認してから出力を置き換えます。

- IFC4スキーマとEXPRESSルール、全IfcRootのGUID一意性。
- storey elevation、包含、部材クラス・属性・source identity。
- ワールドI/J座標、部材長、断面軸方向、断面種別・寸法。
- OpenCascadeによる実メッシュ生成と体積。geometry engineのm³をmm³へ換算し理論断面積×長さと比較。

`OUTPUT.ifc.report.json`（`--report`で指定可）に対応表、hash、GUID、寸法、座標、検証結果、制限を保存します。
各ファイルはatomic replaceですが、IFCとレポートの2ファイルをまとめたトランザクションではありません。
IfcOpenShellに加え、独立した交換先web-ifc 0.0.77（Node/WASM）で下記の照合を実施しました。
F7の「1つの独立した交換先」の確認は矩形・I形断面の範囲で完了しています。
Revit、Archicad、Bonsaiなどのデスクトップ製品への読込は未検証です。中空矩形のweb-ifc形状表示には下記の制限があります。

## 検証の再実行 / Verification

### 独立したIFC交換先: web-ifc 0.0.77

[That Open Companyのweb-ifc](https://github.com/ThatOpen/engine_web-ifc)を、IfcOpenShellとは別の
Node/WASMパーサ・形状生成器として使用しました。アプリのnpm依存には追加せず、外部環境に固定版を導入します。

```sh
npm install --prefix /tmp/element-modeler-f457-web-ifc \
  --cache /tmp/element-modeler-f457-npm-cache --no-audit --no-fund web-ifc@0.0.77

# 保存済みの実IFCファイルを独立ライブラリで再検証。
node scripts/analysis_ifc_web_check.mjs \
  test/fixtures/analysis/ifc-web-exchange.ifc \
  test/fixtures/analysis/ifc-web-exchange.ifc.report.json \
  /tmp/element-modeler-f457-web-ifc /tmp/ifc-independent-check.json
```

**成功した範囲:** 矩形断面の水平梁と斜梁、I形断面の柱、2階層、部材3本（梁2・柱1）。
原点からの平面オフセットと上階配置を含みます。IFC4形式・mm単位、GUIDの一致/一意性、
部材クラス、階の高さ/包含、SourceId/SourceBranch、断面クラス/寸法、ModelFingerprint、
ProjectIdentity、配置階層を合成した世界座標の始終点をレポートと照合しました。
さらにweb-ifc自身が生成したメッシュの世界座標範囲と体積も一致しました。
断面の期待軸はIFC配置から借用せず、レポートの元始終点と上記のsolver軸規約だけから導出します。
部材の世界配置軸とsolid/profileを合成した断面軸を、この独立した期待軸へ照合します。
メッシュの境界も元始点・期待軸に投影して検査するため、断面だけの90°回転を受け入れません。
座標許容差1e-6 mm、単位軸成分1e-9、メッシュ境界0.001 mm、体積相対1e-5です。
web-ifcの描画座標（m、Y上向き）を逆変換して、IFCのmm・Z上向き座標で照合します。

実行環境はNode v22.18.0 / web-ifc 0.0.77。証跡は
`docs/analysis-ifc-web-validation.json`（`version:2`, `passed:true`）で、入力IFCのSHA-256、
独立に算出した`expectedSectionBasis`、読取結果の`parsedSectionBasis`、`sectionOrientationPassed`を含みます。
検証器はIfcOpenShellもアプリの幾何モジュールもimportしません。
この独立交換先の成功は、Revit/Archicad/Bonsaiへの読込を保証するものではありません。

配置軸の回帰検証は次のコマンドで再実行できます（アプリ依存の追加なし）。
元の水平梁・柱・斜梁が成功し、IFCの`#43`方向を`(0,1,0)`から`(0,0,1)`へ変えた
90°回転と、部材配置を変えずprofile内だけを90°回転したケースの両方が、元レポートに対して失敗することを検査します。

```sh
node test/analysis-ifc-web-check.mjs /tmp/element-modeler-f457-web-ifc
```

入力から再生成する場合:

```sh
python3 scripts/analysis_demo.py --kind ifc-web-exchange --output /tmp/ifc-web-model.json
/tmp/element-modeler-f457-venv/bin/python scripts/analysis_ifc.py /tmp/ifc-web-model.json \
  --project-id independent-exchange-demo --output /tmp/ifc-web-model.ifc
node scripts/analysis_ifc_web_check.mjs /tmp/ifc-web-model.ifc \
  /tmp/ifc-web-model.ifc.report.json /tmp/element-modeler-f457-web-ifc /tmp/ifc-web-check.json
```

**中空矩形に関する確認済みのconsumer制限:** 全3断面を含む別fixtureでは、
web-ifcは`IfcRectangleHollowProfileDef`のXDim=150、YDim=300、WallThickness=10 mmと
属性・GUID・配置を正しく読み取りました。しかしメッシュは内寸140×290 mm（壁厚5 mm）となり、
正しい内寸130×280 mmと一致しませんでした。理論体積21,065,611.788 mm³に対して
web-ifc形状は10,777,754.883 mm³。IfcOpenShell側の形状・体積検証は成功しています。
[web-ifcの形状ローダー](https://github.com/ThatOpen/engine_web-ifc/blob/main/src/cpp/web-ifc/geometry/IfcGeometryLoader.cpp)
にも、この挙動と一致する内寸の計算があります。エクスポータの正しいWallThicknessを倍にする回避は行いません。

失敗も隠さず`docs/analysis-ifc-web-hollow-limitation.json`に保存しました。
この証跡にはweb-ifcが実際に読み取った`parsedProfileDimensions.WallThickness:10`と、
IfcOpenShellによる`exporterValidation.profiles/geometryVolumes:true`の検証レポートも含めています。
中空矩形を含むIFCのCLIレポートは`consumerWarnings`に既知のweb-ifc 0.0.77制限を記録し、標準エラーにも警告します。
`exchangeFieldsPassed:true`ですが`passed:false`、形状不一致の詳細を含みます。
次のコマンドは**終了コード2となることが期待結果**です。中空矩形のweb-ifc形状表示は受入範囲に含めません。

```sh
node scripts/analysis_ifc_web_check.mjs \
  test/fixtures/analysis/ifc-exchange.ifc \
  test/fixtures/analysis/ifc-exchange.ifc.report.json \
  /tmp/element-modeler-f457-web-ifc /tmp/ifc-hollow-check.json
```

`analysis_demo.py --kind ifc-exchange`は、この全3断面の再現入力を生成します。
形状consumerの修正後にも同じコマンドで確認できます。

### 解析・UIの検証

```sh
# JavaScript：荷重保存則、実結果fixtureの変形曲線、入力拒否、日英パネルイベント。
node --test test/analysis-load-distribution.test.js test/analysis-results-panel.test.js test/analysis-workbench.test.js

# 依存なし：入力、ハッシュのPython/JS一致、F5→CLI境界、失敗時の旧出力保全。
python3 scripts/analysis_tests.py --suite core

# 実solver：片持梁両軸曲げ/軸力/ねじり、単純梁、小L形フレーム、斜材軸力、機構拒否、
# 固定節点荷重、workbenchの配分済み出力→解析まで。
/tmp/element-modeler-analysis/bin/python scripts/analysis_tests.py --suite opensees

# 実IFC：3種類の断面、複数階、柱・斜梁、GUID安定性、座標改変検知。
/tmp/element-modeler-analysis/bin/python scripts/analysis_tests.py --suite ifc
```

Mac/Rosettaではopenseesテスト行にも`arch -x86_64`を付けます。
同一CPUで両依存が使える環境なら`--suite all`で全Pythonテストを実行できます。
Pythonテストは依存不在をskipして成功扱いにはしません。JavaScript全体は`npm test`で実行します。
`npm run test:analysis:core`は依存なしのPython検証、`npm run test:analysis`は同じPythonから全依存を使う検証です。
今回のMacのようにOpenSees/IFCでCPUアーキテクチャが異なる環境では、suiteを分けて上記コマンドを実行します。
解析既知解の比較は相対1e-8・絶対1e-8、IFC体積は相対1e-6です。

この作業環境で成功した正確な呼出しは以下です。native arm64のOpenSees importは
Intel wheelとの不一致で失敗しますが、Rosetta実行は実solverを使用して成功しています。

```sh
python3 scripts/analysis_tests.py --suite core
arch -x86_64 /tmp/element-modeler-f457-venv/bin/python scripts/analysis_tests.py --suite opensees
/tmp/element-modeler-f457-venv/bin/python scripts/analysis_tests.py --suite ifc
```

2026-09-07の実行確認：core 7件、Rosetta上の実OpenSees 7件、native IfcOpenShell 2件成功。
Node.js 22 / 24でJavaScript全体474件、lint:all、version:checkも成功しました。
アプリのCADデモから実solver結果を生成し、ChromiumでCAD読込→workbench結果ファイル読込→
変形倍率変更→SVG/反力表表示まで確認済み（uncaught browser error 0）。
Firefox/WebKitの本機能の実solverファイル往復はこの検証では実行していません。

実装資料：[OpenSees elasticBeamColumn](https://openseespydoc.readthedocs.io/en/latest/src/elasticBeamColumn.html)、
[Linear transformation / local axes](https://openseespydoc.readthedocs.io/en/latest/src/LinearTransf.html)、
[IfcOpenShell validation](https://docs.ifcopenshell.org/autoapi/ifcopenshell/validate/index.html)。

## English summary of limitations

F4 is a runnable external, rigid-ended, linear elastic 3D frame/nodal-load subset in mm/N.
Unsupported releases/springs, unmatched loads and implicit density gravity stop conversion.
F5 requires explicit load/support selection and preserves global force and moment, while its exported
endpoint loads deliberately omit distributed-load member bending; acceptance is required before export.
The full distributed model replaces the original load and is linked to current CAD through the app workbench.
F7 produces validated physical IFC4 beams/columns/storeys with three profile types and stable project-scoped GUIDs.
Independent web-ifc 0.0.77 exchange passes for rectangular/I-profile beams and columns across two storeys; hollow-profile metadata/placements pass, but its tessellated wall thickness is incorrect and is recorded as a failed geometry check. BIM desktop imports remain unverified. No nonlinear, shell, dynamic or design-code analysis is provided.
