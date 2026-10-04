# 座標入力・要素一覧の使い方

Element Modeler v1.6.0。平面図での入力を中心に、人とブラウザー操作AIが同じフォームを使える構成です。

## 座標で部材を作成する

1. 左パネルで「入力する階」と部材の種類・断面などの配置条件を選びます。
2. 「座標で入力」を開き、X・Yをmmで入力して「この座標を入力」を押します。
3. 梁・ブレース・壁・矩形の床/屋根・線荷重/面荷重は2点、柱・点荷重・支点は1点を入力します。
4. ポリラインの面材は頂点を順に入力し、3点以上で「輪郭を確定」を押します。
5. 右パネルの要素数と選択ID、プロパティ、平面図で結果を確認します。

座標フォームにはグリッドスナップを適用しません。既存の節点を約1mm以内で共有するなど、クリック入力と同じモデル生成の規則は適用します。
柱・鉛直ブレース・壁は上の階が必要です。座標は±1,000,000,000mmの範囲で、小数・負数も入力できます。

未確定の点数と最後の座標を文字で表示します。「未確定入力を取消」は途中の点を解除します。
確定した要素は「元に戻す」「やり直す」で操作します。変更のない入力では履歴を増やしません。
計測は2点を入力すると距離・dX・dYを文字でも確認できます。
マウスと座標フォームは入力途中の点を共有します。操作者を交代するときは、現在の入力を確定または取り消してください。

## 要素を探して編集する

「モデル → 要素一覧」で、線材・面材・荷重・支点のID、種別、階、断面、平面座標を確認します。
種類・階・ID/断面検索で絞り込み、50件ずつ「前へ」「次へ」で移動できます。表示フィルタで隠れている要素も含みます。

IDのボタンを押すと、未確定入力を解除し、その要素の階・平面図・プロパティを表示します。
対象の表示に必要なフィルタは解除されます。ここで座標や断面、荷重値、支点拘束などを編集できます。
線材の始点と終点は、それぞれI端部・J端部のグループ内にあります。

### 検索結果の線材を一括編集する

1. 「要素の種類」で「線材」を選びます。
2. 「線材種別で絞り込み」「断面で絞り込み」、階やID/断面検索を組み合わせます。断面は、その線材種別で使用中の名称から選べます。
3. 「検索結果の線材 N 件を一括選択」を押します。表示中のページだけでなく、全ページの一致する線材が対象です。現在の選択は置き換わります。
4. 平面入力とプロパティが開き、2件以上なら既存の一括断面変更・ミラーコピー・回転・配列複製・削除を利用できます。変更はUndo/Redoできます。

非表示の線材も検索・選択対象です。選択時は必要な線材表示フィルタを解除し、対象が複数階にある場合は2Dレイヤー表示を「全レイヤー」にします。検索・選択そのものはモデル形状やUndo/Redoの履歴を変えません。
一致件数が0の場合は一括選択できません。面材・荷重・支点はIDボタンから個別に選択します。

「モデル」の階・通り芯管理と「解析」の荷重組合せ管理も、追加・編集・削除がUndo/Redoの対象です。管理画面を閉じて「元に戻す」「やり直す」を使います。空欄や不正な数値は変更前の値に戻り、履歴を消費しません。

## ブラウザー操作AI向けの参照

まず画面のアクセシビリティ情報から役割と名前を取得します。
同名のボタンがメニューとショートカットにある場合は、開いているメニュー、ダイアログ、パネルの範囲内で選択します。
現在の言語で表示された名前を使用し、必要に応じて以下のIDも利用できます。

| 操作・確認 | 画面の要素 |
| --- | --- |
| 入力階 | #sel-active-layer / combobox「入力する階」 |
| 入力ツール | #sel-tool / combobox「操作モード」、部材名のbutton |
| 座標入力の展開 | #coordinate-input > summary |
| 座標フォーム | #coordinate-form、group「座標で入力」 |
| X・Y | #coordinate-x、#coordinate-y / spinbutton「X (mm)」「Y (mm)」 |
| 点の入力 | #btn-coordinate-add / button「この座標を入力」 |
| 輪郭の確定・取消 | #btn-coordinate-finish、#btn-coordinate-cancel |
| 未確定状態・入力結果 | #coordinate-state、#coordinate-result / status |
| 要素数・選択ID | #model-summary、#selection-summary / status |
| 要素一覧を開く | #menu-model-trigger → #btn-element-list |
| 一覧 | dialog「要素一覧」、#element-table / table |
| 一覧の絞り込み | #element-kind、#element-level、#element-search |
| 線材の絞り込み | #element-member-type、#element-section（線材を選んだときのみ） |
| 全ページの線材を選択 | #element-select-members / button「検索結果の線材 N 件を一括選択」 |
| 一覧の行 | data-element-kind と data-element-id、IDを名前に含むbutton |
| 右パネル | complementary「モデル情報」、各tabとtabpanel |
| 表示切替 | #tab-2d、#tab-3dのaria-pressed |
| メニューの開閉 | .menu-triggerのaria-expanded |

入力値のエラーはaria-invalidと文字メッセージで、実行できない操作はdisabledで確認できます。
確定後は要素数・選択ID・一覧を再取得し、必要ならCAD保存のJSONで座標を照合してください。
モデルのファイル出力は通常のダウンロード、CAD読込は通常のファイル選択を使います。
window._appなどの開発用内部オブジェクトに依存しない手順を推奨します。

## English quick reference

Use the named buttons and native controls in the same UI as a human operator.
Choose the input level and element, expand **Coordinate input**, and fill X/Y in mm.
Use **Enter this point**, **Finish outline**, and **Cancel pending input**.
Typed points bypass grid snapping and share the normal placement rules and Undo/Redo history.
Polygons close with the explicit Finish outline button. Measurement results and pending point counts are readable text.

Open **Model → Element list…** to search by ID or section, filter by kind/level, and page through 50 rows at a time.
Select an ID to reveal its level and Properties. The list includes hidden elements and clears filters needed to reveal the selected target.
Choose **Line**, then **Filter by member type** and **Filter by section**, and use **Select all N matching members** to replace the selection with matches from every page. Members from multiple levels are revealed in the plan. Use the existing batch controls in Properties to edit two or more members; edits support Undo/Redo.
Level, grid-axis and load-combination management edits also support Undo/Redo after closing the modal. Unchanged or invalid numeric input preserves history.
Use dialog/panel/group scope to distinguish repeated button names and the start/end coordinate fields.
The stable IDs in the table above do not change with the language.
