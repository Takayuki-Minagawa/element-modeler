// help-content.js - Help modal HTML content (extracted from i18n dictionaries)

export const helpContentJa = `
<h3>保存・復元履歴</h3>
<p>自動保存は最新5世代を保持します。ツールバーで保存中・保存済・失敗と最終成功時刻を確認し、「復元履歴」で世代を選んで復元します。復元は1回のUndoで取り消せます。保存失敗時は再試行でき、最後の正常世代を保持します。CADファイルへの保存も併用してください。</p>
<h3>診断から対象を確認</h3>
<p>モデルチェックで重要度・対象種別を絞り込み、対象ボタンを押します。対象の階へ移動し、選択・カメラを合わせます。必要な表示フィルタが解除されます。属性を修正したら再診断してください。</p>
<h3>3D切断・単独表示・GLB</h3>
<p>左ドラッグで回転、右ドラッグ（またはShift/Ctrl/⌘＋左ドラッグ）で画面移動、ホイールでカーソル位置へズームします。「全体表示」で表示中のモデルを画面に収め、「斜め / 上 / 正面 / 右」で方向を切り替えます。透視投影のまま、切断・単独表示・表示フィルタは維持します。3D画面にフォーカスがあるときはHomeで全体表示、Fで選択へ移動できます。</p>
<p>切断位置はmm単位で数値入力でき、Enterまたはフォーカス移動で確定します。スライダーとも連動し、空欄・範囲外の入力は直前の有効値へ戻ります。</p>
<p>3Dタブの右サイドバーにある「3D表示・出力」で切断軸X/Y/Zを選び、位置スライダと反転で内部を確認します。軸を解除すると戻ります。「選択を単独表示」「単独表示を解除」「選択へ移動」で対象を確認できます。見出し右端の「− / +」で操作欄を折りたためます。表示操作でCADの幾何は変わりません。GLBは表示対象をm単位で保存し、切断面は開いたままです。</p>
<p>3Dタブへ切り替えると右サイドバーが開きます。操作欄はモデルに重ならず、折りたたみ状態はブラウザに保存されます。サイドバー全体を閉じるには境界の矢印を押してください。</p>
<h3>解析結果・荷重配分</h3>
<p>「解析結果・荷重配分」から、同じCADモデルを外部OpenSeesPyで解析した結果JSONを読み込みます。表示面と変形倍率を指定し、変位・反力を確認できます。モデルが変わった結果は再読込・再解析が必要です。</p>
<p>「応力図」で N / Qy / Qz / T / My / Mz を選ぶと、変形図と同じ投影で部材ごとの断面力を塗り図形として重ね、要素ごとの I端・J端の断面力表を表示します。引張正、モーメントは局所軸まわりの右手則で、正値は局所 +y（Qy）、−y（Mz）、+z（N, Qz, T, My）側に描くため、My・Mz は引張側に表示されます。数値誤差程度の成分は図を省略します。「材端力CSVを出力」で荷重ケース・要素・両端の断面力を CSV に保存できます。</p>
<p>線荷重は作用部材、矩形面荷重は一方向スパンと支持辺2本を明示して配分を確認します。合力・モーメントは保存しますが、端点への集中化は分布荷重の部材内曲げを再現しません。制限を確認して配分済み解析JSONを保存し、解析後は同じJSONを任意の参照モデルとして読み込んでから結果を開きます。</p>
<p>解析は両端rigidの線形線材と節点荷重が対象です。IFCは柱・梁・階・3種の断面の限定出力です。実行手順と対応範囲は <a href="docs/analysis-tools.md" target="_blank" rel="noopener">解析・IFCツール</a>を参照してください。</p>
<h3>平面入力を中心にした画面</h3>
<p>左パネルの「1 入力する階」→「2 作成する部材」→「3 配置条件」の順に設定し、平面図をクリックして部材を作成します。梁・柱・床・壁などのボタンで直接切り替えられます。種類ごとの配置方法は配置条件の先頭に表示されます。入力ボタン・ツール選択・ショートカットのいずれでも、3Dから平面入力へ戻ります。</p>
<p>保存・読込は「ファイル」、元に戻す・接続整理は「編集」、初期モデル生成・階・通り芯・断面定義・階コピーは「モデル」、表示フィルタは「表示 → 表示設定」、解析出力・結果読込は「解析」から操作します。サンプルとマニュアルは「ヘルプ」にあります。</p>
<p>右パネルは「プロパティ / 集計 / チェック」を切り替えます。部材を選択するとプロパティが開き、モデルチェックの結果はチェックに表示されます。パネル境界の矢印で折り畳むと平面図を広く使えます。メニューは矢印キーでも移動でき、Escで閉じます。</p>
<h3>座標入力と要素一覧</h3>
<p>「座標で入力」を開き、X・Yをmmで指定して「この座標を入力」を押します。未確定点数と最後の座標を文字で確認できます。ポリラインは「輪郭を確定」で閉じ、途中の入力は取消ボタンで解除します。右パネルには要素数と選択IDを表示します。</p>
<p>「モデル → 要素一覧」でID・断面・階・種類から探して選択すると、平面図とプロパティを開きます。非表示の要素も含み、必要な表示フィルタは解除されます。<a href="docs/coordinate-input.md" target="_blank" rel="noopener">座標入力と要素一覧の詳しい使い方</a></p>
<h3>基本操作</h3>
<table>
  <tr><td><b>線材作成</b></td><td>「線材」ツール(Mキー)を選択し、キャンバス上で始点をクリック → 終点をクリック</td></tr>
  <tr><td><b>面材作成</b></td><td>「面材」ツール(Fキー)。矩形は対角2点、ポリラインは連続クリック→始点クリックまたはEnterで閉合</td></tr>
  <tr><td><b>荷重作成</b></td><td>「荷重」ツール(Lキー)。面荷重は矩形2点、線荷重は線分2点、点荷重は1点クリック</td></tr>
  <tr><td><b>支点配置</b></td><td>「支点」ツール(Sキー)でキャンバス上をクリック。プロパティパネルで6自由度(DX/DY/DZ/RX/RY/RZ)を設定</td></tr>
  <tr><td><b>選択</b></td><td>「要素」ツール(Vキー)で線材・面材・荷重・支点をクリック。3D表示でも部材・面材をクリックで選択できます</td></tr>
  <tr><td><b>複数選択</b></td><td>Shift+クリックで線材を追加/解除。空白からドラッグで矩形範囲選択。右パネルで一括断面変更・ミラー・回転・配列複製・一括削除</td></tr>
  <tr><td><b>線材の連結</b></td><td>一直線に連続する梁、または上下に連続する柱を2本以上選び、右パネルの「連結」をクリック。断面が異なる場合は連結後の断面を選択</td></tr>
  <tr><td><b>線材の分割</b></td><td>梁または柱を1本選び、右パネルの「分割」をクリック。梁は部材上の分割点をクリック（Escでキャンセル）、柱は中間レイヤーを選択</td></tr>
  <tr><td><b>計測</b></td><td>「計測」ツール(Dキー)で2点をクリックすると距離・dX・dYを表示。Escで消去</td></tr>
  <tr><td><b>移動</b></td><td>選択後、ノードまたは線材をドラッグ（複数選択中はグループごと移動）。またはプロパティパネルで始点/終点のX,Y座標を数値入力</td></tr>
  <tr><td><b>削除</b></td><td>要素を選択してDeleteキー（複数選択にも対応）</td></tr>
</table>

<h3>初期モデル生成（格子フレーム）</h3>
<ol>
  <li>モデル →「初期モデル生成…」を開き、階数を設定します。階数に応じて階別設定テーブルの行が増減します。増加時は最上階の行が複製され、減少時は上の階から削除されます（下層階の入力は保持されます）。</li>
  <li>各階の行で階高（mm）と、柱断面・梁断面・床断面・外壁断面を現在のモデルの断面カタログから選択します。最上部の「一括」行に入力・選択すると、その列の全階へ反映されます。一括欄は反映後に空欄へ戻るため、個別の階を変更した後でも同じ値をもう一度適用できます。</li>
  <li>「生成する要素」の柱・梁・床・外壁・基礎チェックで生成対象を選びます。OFF の要素に対応する断面列は無効表示になります（値は保持）。柱・梁の少なくとも一方を ON にする必要があります。</li>
  <li>X方向・Y方向スパンは mm 単位で、カンマ、読点、空白区切りで入力します。繰り返し記法 <code>N@L</code>（例: <code>3@6000, 5000</code> は <code>6000, 6000, 6000, 5000</code> と同じ）が使えます。</li>
  <li>床は GL を除く各レベルの各スパン区画に生成されます。外壁は各階の外周に1枚の多角形面材として生成されます。</li>
  <li>「基礎」を ON にすると、GL の下に根入れ深さ分だけ下げたレベル <code>FDN</code>（z = −根入れ深さ）が追加され、そこに地中梁が各階の梁と同じ格子で生成されます。あわせて各格子点に <code>FDN</code> から GL までの基礎柱型が生成され、支点は GL ではなく <code>FDN</code> に配置されます。地中梁は定義上 GL より下にあるため、根入れ深さは 1 mm 以上が必要です。基礎柱型は上部の柱を支えるために必ず生成されます（柱チェックが OFF でも支点は付きます）。</li>
  <li>入力値・断面選択・チェック状態は生成成功時に保存され、次回開いたときやリロード後に復元されます。旧形式で保存された入力値・プリセットも自動変換されます。名前付きプリセットは最大20件まで保存・呼出・削除でき、同名保存で上書きできます。</li>
  <li>「生成」で GL から RF までのレイヤー、X/Y通り芯、チェックした要素（柱・梁・床・外壁・基礎）、柱または基礎の生成時は最下レベルの並進3方向を拘束した支点を一括生成します。現在のモデルは置き換えられますが、「元に戻す」で復元できます。</li>
</ol>
<p>「床」「外壁」「基礎」チェックは既定で OFF です。荷重・ブレースは生成されません。生成完了時の通知に柱・梁・床・外壁・基礎柱・地中梁の件数が表示されます。</p>

<h3>通り芯・下絵・軸組図</h3>
<table>
  <tr><td><b>通り芯</b></td><td>モデルメニューの「通り芯管理」でX/Y通りの名前と座標を定義。2Dに一点鎖線で表示され、交点にスナップします</td></tr>
  <tr><td><b>下絵DXF</b></td><td>「下絵DXF読込」でDXF(LINE/POLYLINE/CIRCLE/ARC)を下絵表示。「下絵表示」で切替、「下絵クリア」で削除</td></tr>
  <tr><td><b>軸組図</b></td><td>上部「軸組図」ボタンで通り芯を選び、その構面の立面（柱・梁・ブレース・レベル線）を表示</td></tr>
  <tr><td><b>モデル整形</b></td><td>右パネルの「節点マージ」で近接節点を統合、「交差部材を分割」で交差/T字部の梁・水平ブレースを分割し節点共有</td></tr>
</table>

<h3>荷重ケースと解析エクスポート</h3>
<table>
  <tr><td><b>荷重ケース</b></td><td>荷重ツールとプロパティパネルで DL/LL/EQX/EQY/WX/WY を設定</td></tr>
  <tr><td><b>荷重組合せ</b></td><td>解析 → 荷重組合せ でケースごとの係数を編集・追加</td></tr>
  <tr><td><b>解析出力</b></td><td>「解析JSON出力」「解析CSV出力」で数値ID・元ID・共有3D節点・材料/断面物性・ばね剛性・質量源・支点・荷重・組合せをv2形式で出力（元単位 mm, N）</td></tr>
  <tr><td><b>図面出力</b></td><td>「図面DXF出力」「PNG出力」で平面図を出力</td></tr>
</table>

<h3>画面操作</h3>
<table>
  <tr><td><b>パン（画面移動）</b></td><td>平面図上部の「画面移動」をONにし、左ドラッグで図全体の表示位置を移動。再クリックまたはEscで終了。右ドラッグ / 中ボタンドラッグ / Space + ドラッグも使用できます。部材の座標や選択は変わりません</td></tr>
  <tr><td><b>中央に表示</b></td><td>平面図上部の「中央に表示」で、表示中のモデル全体を画面に収めます</td></tr>
  <tr><td><b>ズーム</b></td><td>マウスホイール（カーソル中心）</td></tr>
  <tr><td><b>原点・軸表示</b></td><td>左下に原点と軸方向（X, Y）を常時表示</td></tr>
  <tr><td><b>3D表示</b></td><td>上部「3D 表示」タブをクリック</td></tr>
</table>

<h3>キーボードショートカット</h3>
<table>
  <tr><td><kbd>V</kbd></td><td>要素ツール（選択・編集・削除）</td></tr>
  <tr><td><kbd>M</kbd></td><td>線材ツール</td></tr>
  <tr><td><kbd>F</kbd></td><td>面材ツール</td></tr>
  <tr><td><kbd>L</kbd></td><td>荷重ツール</td></tr>
  <tr><td><kbd>S</kbd></td><td>支点ツール</td></tr>
  <tr><td><kbd>Enter</kbd></td><td>面材ポリラインを閉じて確定</td></tr>
  <tr><td><kbd>Esc</kbd></td><td>キャンセル / 選択解除 / モーダルを閉じる</td></tr>
  <tr><td><kbd>Delete</kbd></td><td>選択要素を削除</td></tr>
  <tr><td><kbd>Ctrl+Z</kbd></td><td>元に戻す</td></tr>
  <tr><td><kbd>Ctrl+Y</kbd></td><td>やり直し</td></tr>
  <tr><td><kbd>Shift</kbd></td><td>角度制限（0/45/90°）</td></tr>
</table>

<h3>プロパティパネル</h3>
<p>要素を選択すると右パネルで以下を編集できます:</p>
<ul>
  <li><b>線材</b> - 断面 / 始点座標(X,Y) / 終点座標(X,Y) / 端部(I/J) / バネ記号（バネ時）</li>
  <li><b>面材</b> - 断面 / 荷重方向（床のみ）</li>
  <li><b>荷重</b> - 種別 / 座標 / 荷重値(面・線) / 力・モーメント(点) / 色</li>
  <li><b>支点</b> - 位置(X,Y) / 並進拘束(DX,DY,DZ) / 回転拘束(RX,RY,RZ) / プリセット(ピン/剛/全解除)</li>
</ul>
<p>線材の始点・終点座標は数値入力で直接編集でき、ノード位置を正確に指定できます。</p>
<p>線材ツールでは梁・水平ブレースは現在レイヤー、柱・鉛直ブレースは下端レイヤーで管理し、上端レイヤーをツールバーに表示します。</p>
<p>種別・レイヤー・幅/高さ・色は表示専用です。断面を変更すると寸法と色が自動反映され、外壁を含む面材の色は平面図と3D表示へ連動します。</p>

<h3>屋根入力ワークフロー</h3>
<ol>
  <li>床・外壁などの輪郭を選択して屋根面を自動生成するか、面材ツールで屋根面または庇・軒を矩形/ポリライン入力します。自動生成は片流れ、切妻X棟、切妻Y棟、寄棟を選べます。</li>
  <li>切妻/寄棟の自動生成は軸に平行な矩形輪郭が対象です。複雑な屋根や穴付き形状は、共有辺を持つ複数の屋根面に分けます。</li>
  <li>同じ棟・谷・隅木を構成する屋根面には同じ <code>roofGroupId</code> を設定します。</li>
  <li>各屋根面で勾配、登り方向、基準高さを設定し、3D表示で傾斜方向を確認します。</li>
  <li>必要に応じて屋根面ごとに外周梁と登り梁を生成します。同一屋根グループ内の共有辺は外周梁ではなく棟/谷/隅木の対象です。</li>
  <li>屋根グループ単位で棟/谷/隅木、外周庇、外周傾斜辺からの妻壁を生成します。再生成前にはグループ検証で自己交差や共有辺高さ不一致を確認し、生成済み要素を削除してから再生成できます。</li>
  <li>単位重量と風圧/地震重量の対象フラグを確認し、数量集計で投影面積、地震用重量、屋根部材の役割別延長を確認します。面材明細と屋根部材明細はパネル内で展開でき、集計CSV/詳細CSVとして出力できます。</li>
</ol>
<p>片流れ/単一面は矩形とポリゴン輪郭に対応します。切妻X棟、切妻Y棟、寄棟は軸に平行な矩形輪郭に対応し、非矩形・回転矩形・穴付き形状では生成されません。</p>

<h3>表示・選択オプション</h3>
<p>「表示 → 表示設定」では共通・平面・3Dの項目をまとめて変更できます。スナップは左パネルに常時表示し、その他の入力補助は「入力補助」を開いて設定します。入力対象が表示フィルタで隠れている場合は、配置条件欄から表示設定を開けます。</p>
<table>
  <tr><td><b>スナップ</b></td><td>ONにするとグリッド/既存ノードに吸着します</td></tr>
  <tr><td><b>支点表示</b></td><td>OFFにすると支点を2D/3Dの両方で非表示にします。非表示中は支点のクリック選択もスキップされます</td></tr>
  <tr><td><b>広域選択</b></td><td>ONにするとクリックの許容範囲が広がり、グリッドからズレた部材も選択しやすくなります（通常 8px → 20px）</td></tr>
  <tr><td><b>2Dレイヤー表示</b></td><td>全レイヤー、現在レイヤーのみ、他レイヤーの薄表示を切り替えます</td></tr>
  <tr><td><b>他レイヤー選択ロック</b></td><td>薄表示中の他レイヤーを参照表示だけにし、選択やドラッグを防ぎます</td></tr>
  <tr><td><b>表示フィルタ</b></td><td>線材・面材・荷重、線材種別、断面、材端記号、配置ラベルを切り替えます</td></tr>
  <tr><td><b>3D線材表示</b></td><td>線材を断面形状または中心線で表示します。梁3D断面で、梁だけをボックス、H形鋼（強軸）、H形鋼（弱軸）に切り替えられます。面材は面表示のままです</td></tr>
  <tr><td><b>階コピー / モデルチェック</b></td><td>現在階の要素を別階へ複製し、欠落参照・重複・ゼロ長などを確認できます</td></tr>
</table>

<h3>設定 / ユーザー定義</h3>
<p>画面右上の設定ボタンから設定モーダルを開きます。</p>
<ul>
  <li><b>テーマ</b> - ダーク / ライトを切替</li>
  <li><b>言語</b> - 日本語 / English を切替</li>
  <li><b>モデル → ユーザー定義</b> - 材料 / 断面 / バネ定義と解析物性を追加・管理</li>
  <li><b>ヘルプメニュー</b> - この簡易マニュアルとサンプルモデル</li>
</ul>
<p>材料には E・G・密度、線材断面には任意の A・Iy・Iz・J 上書きと、せん断用断面積比 Ay/A・Az/A を設定できます。矩形・H形鋼・ボックス断面を選び、「形状から性能を計算」で整数の断面特性を入力できます。空欄の断面特性は選択した形状から算定されます。H形鋼のフィレット、ボックス断面の角Rは含めません。ばねには kr・kt を設定でき、kr の空欄は解析出力の警告になります。組み込み材料値は試行値なので解析前に確認してください。既定の断面・バネ（例: <code>_G</code>, <code>_C</code>, <code>_SP</code>）は編集・削除できません。</p>
<p>解析メニューの「解析出力設定」では荷重ケース別の質量換算係数と、部材自重を密度から算定するかDLに含めるかを指定します。</p>
<p>解析JSON/CSV出力の直前にはプリフライト検査を行います。元モデルの整合エラー、必須の材料・ばね・質量設定の未定義、線材要素ゼロ、または連結成分に未拘束の剛体運動がある場合は出力を中止し、結果をモデルチェック欄に表示します。支持条件の検査対象は構造全体の剛体6自由度であり、ソルバーによる剛性・内部機構の検査を代替するものではありません。</p>
<p>「同グループ一覧」で現在のグループ定義を別画面で確認できます。</p>
<p>「エクスポート」でユーザー定義をJSONファイルとしてダウンロード、「インポート」で別環境からユーザー定義を読み込めます。</p>

<h3>レイヤー管理</h3>
<p>入力階横の「管理」ボタンからレイヤー管理モーダルを開きます。</p>
<ul>
  <li><b>追加</b> - 新しいレイヤーを追加（z値は自動計算）</li>
  <li><b>編集</b> - レイヤー名とz値（高さ mm）を直接編集</li>
  <li><b>削除</b> - 未使用レイヤーのみ削除可能</li>
</ul>
<p>レイヤーはz値（高さ）の昇順で表示されます。同じz値のレイヤーは作成できません。</p>

<h3>データ入出力</h3>
<p>CADデータ（図面情報）とユーザー定義（材料・断面・バネ）は<b>別ファイルとしても分離管理</b>できます。</p>
<table>
  <tr><td><b>CAD保存</b></td><td>ファイルメニューの「CAD保存」で図面データをJSONファイルとしてダウンロード。材料カタログは全件、断面・バネはデフォルト定義と使用中のカスタム定義を含みます</td></tr>
  <tr><td><b>CAD読込</b></td><td>ファイルメニューの「CAD読込」でJSONファイルを読み込み。既にメモリ上にあるカスタム定義は維持されます</td></tr>
  <tr><td><b>定義エクスポート</b></td><td>モデル → ユーザー定義 →「エクスポート」でカスタム定義を別ファイルに保存</td></tr>
  <tr><td><b>定義インポート</b></td><td>モデル → ユーザー定義 →「インポート」で別環境のカスタム定義を読み込み。CADファイルから読込済みの定義を含め、同名の定義はスキップされます</td></tr>
  <tr><td><b>部材リストCSV</b></td><td>ファイル → 集計 →「部材リストCSV出力」で、線材を種別・断面ごとに本数・延長・単位重量（材料密度 × 断面積）・重量に集計した行と、部材ごとの明細行を出力。右パネルの集計にも同じ「部材リスト」表を表示します。X形の鉛直ブレースは 2 本として数え、断面積または密度が未設定の部材は重量が空欄になります</td></tr>
</table>
<p>定義インポート時、追加件数とスキップ件数が通知されます。断面定義・バネ定義にはメモ（説明テキスト）を付与できます。</p>
<p>ノード・部材・面材・荷重・支点IDはCADファイルに保存され、読込後も保持されます。旧バージョンで保存されたファイルも読み込めます。</p>
`;

export const helpContentEn = `
<h3>Save status and recovery</h3>
<p>Autosave keeps the latest five generations. The status bar shows saving, saved or failed status and the last successful time. Open Recovery history to choose a generation; Undo reverses restoration in one step. Failed saves can be retried and retain the last successful generation. Continue saving CAD files as well.</p>
<h3>Navigate from diagnostics</h3>
<p>Filter Model Check by severity and element type, then select a target button. The app switches level, selects the target and frames it, clearing necessary display filters. Edit its properties and run the check again.</p>
<h3>3D clipping, isolation and GLB</h3>
<p>Left-drag to orbit, right-drag (or Shift/Ctrl/Command + left-drag) to pan, and use the wheel to zoom to the cursor. Fit all frames the displayed model; Oblique / Top / Front / Right changes the viewing direction. Perspective projection, clipping, isolation and display filters are preserved. With focus in the 3D canvas, Home fits all and F focuses the selection.</p>
<p>Enter the clipping position in millimeters and press Enter or leave the field to apply it. The slider stays synchronized. Blank or out-of-range input restores the last valid value.</p>
<p>On the 3D tab, choose X/Y/Z in 3D view and export in the right sidebar, then move or flip the cutting plane. Off restores the full view. Use Isolate selection, Clear isolation and Focus selection to inspect elements. These operations preserve CAD geometry. GLB exports the displayed model in meters with open cut faces.</p>
<p>Switching to 3D opens the right sidebar. The controls stay beside the model. Use the − / + button to collapse and expand them; the browser remembers their collapsed state. Use the arrow on the sidebar boundary to hide the whole sidebar.</p>
<h3>Results and load assignment</h3>
<p>Open Results / load assignment and load the result JSON produced by the external OpenSeesPy CLI from the same CAD model. Choose projection and deformation scale to inspect displacements and reactions. Changed models require new analysis and result import.</p>
<p>Choose N / Qy / Qz / T / My / Mz under "Force diagram" to overlay each member's section forces on the same projection as the deformed shape, together with a table of I-end and J-end section forces per element. Tension is positive and moments follow the right-hand rule about the local axis; positive ordinates are drawn toward local +y (Qy), -y (Mz) or +z (N, Qz, T, My), so My and Mz appear on the tension side. Components at numerical-noise level are not drawn. "Export member forces CSV" saves the load case, element identity and both end forces.</p>
<p>For line loads choose one member; for rectangular area loads choose the one-way span and both supporting edges. The preview preserves resultant forces and moments, but endpoint lumping does not reproduce distributed-load member bending. Accept this limitation before exporting distributed analysis JSON. After solving it, load that same JSON as the optional reference before loading results.</p>
<p>The solver supports rigid-ended linear frame elements and nodal loads. IFC export covers beams, columns, storeys and three section profiles. See <a href="docs/analysis-tools.md" target="_blank" rel="noopener">analysis / IFC tools</a> for commands and supported inputs.</p>
<h3>Plan input workspace</h3>
<p>Choose the input level, choose an element, then set its placement options on the left. Click in plan to create it. The beam, column, floor and wall buttons switch tools directly; the placement guide explains each tool.</p>
<p>Use File for saving and importing, Edit for history and connections, Model for frame generation, levels, axes, definitions and level copying, View → Display settings for display filters, and Analysis for exports and results. Samples and this manual are in Help.</p>
<p>The right panel has Properties, Quantities and Checks tabs. Selection opens Properties; diagnostics open Checks. Collapse or resize either panel to make more room for the plan. Menus support arrow keys and close with Escape.</p>
<h3>Coordinate input and element list</h3>
<p>Expand Coordinate input and enter X/Y in mm using Enter this point. Pending points, the last coordinate, model counts and selection IDs are readable text. Use Finish outline for polygons and Cancel pending input to discard unfinished points.</p>
<p>Model → Element list lets you search by ID or section and filter by level or kind. Select an ID to open its plan and Properties; hidden elements are included and necessary visibility filters are cleared. <a href="docs/coordinate-input.md" target="_blank" rel="noopener">Coordinate input and element list guide</a></p>
<h3>Basic Operations</h3>
<table>
  <tr><td><b>Create line</b></td><td>Select "Line" tool (M key), click start point → click end point</td></tr>
  <tr><td><b>Create surface</b></td><td>Use "Surface" (F). Rectangle: 2 diagonal points. Polyline: click points, then click first point or Enter to close</td></tr>
  <tr><td><b>Create load</b></td><td>Use "Load" (L). Area load: 2-point rectangle. Line load: 2-point line. Point load: single click</td></tr>
  <tr><td><b>Place support</b></td><td>Use "Support" (S). Click to place. Edit 6 DOFs (DX/DY/DZ/RX/RY/RZ) in the property panel</td></tr>
  <tr><td><b>Select</b></td><td>Use "Element" tool (V key), click a line/surface/load/support element. Members and surfaces can also be picked by clicking in the 3D view</td></tr>
  <tr><td><b>Multi-select</b></td><td>Shift+click toggles members; drag from empty space for a marquee selection. The panel offers batch section change, mirror, rotate, array copy, and batch delete</td></tr>
  <tr><td><b>Join members</b></td><td>Select two or more collinear connected beams, or vertically adjacent columns, then click "Join" in the right panel. If their sections differ, select the section for the joined member</td></tr>
  <tr><td><b>Split member</b></td><td>Select one beam or column and click "Split" in the right panel. For a beam, click the split point on the member (Esc cancels); for a column, select an intermediate level</td></tr>
  <tr><td><b>Measure</b></td><td>Use "Measure" (D). Click two points to show length, dX, and dY. Esc clears</td></tr>
  <tr><td><b>Move</b></td><td>After selecting, drag a node or line element (the whole group moves during multi-selection). Or edit start/end X,Y coordinates in the property panel</td></tr>
  <tr><td><b>Delete</b></td><td>Select element(s) and press Delete key</td></tr>
</table>

<h3>Initial Model Generation (Grid Frame)</h3>
<ol>
  <li>Open Settings → "Generate Initial Model…" and set the number of stories. The per-story table grows or shrinks accordingly: added rows duplicate the current top story, and removed rows are taken from the top, so lower-story input is preserved.</li>
  <li>In each story row, enter the story height (mm) and select the column, beam, floor, and exterior wall sections from the current model's section catalog. The "All" row at the top applies its value to every story in that column. Each bulk field clears itself after applying, so you can re-apply the same value after editing individual stories.</li>
  <li>Use the "Elements to generate" checkboxes to choose columns, beams, floors, exterior walls, and the foundation. Section columns for unchecked elements are shown disabled (their values are kept). At least one of columns or beams must be enabled.</li>
  <li>Enter X-direction and Y-direction spans in millimetres, separated by commas, Japanese commas, or spaces. The <code>N@L</code> repeat notation is supported (for example, <code>3@6000, 5000</code> equals <code>6000, 6000, 6000, 5000</code>).</li>
  <li>Floors are generated in every span bay on each level above GL. Exterior walls are generated as one perimeter polygon surface per story.</li>
  <li>Enabling "Foundation" adds a level <code>FDN</code> below GL at z = −(embedment depth) and lays foundation beams there on the same grid as the floor beams. Column stubs are generated at every grid point from <code>FDN</code> up to GL, and the supports move from GL down to <code>FDN</code>. A foundation beam is below GL by definition, so the embedment depth must be at least 1 mm. The column stubs are always generated because they carry the frame above, and supports are created even when the columns checkbox is off.</li>
  <li>Inputs, section selections, and checkbox states are saved after successful generation and restored the next time the dialog opens, including after a reload. Values and presets saved in the old format are converted automatically. You can save, load, and delete up to 20 named presets; saving with the same name overwrites that preset.</li>
  <li>Click "Generate" to create layers from GL through RF, X/Y grid axes, the checked elements (columns, beams, floors, exterior walls, foundation), and — when columns or the foundation are generated — supports restrained in DX/DY/DZ on the lowest level. This replaces the current model; use Undo to restore it.</li>
</ol>
<p>The "Floors", "Exterior walls", and "Foundation" checkboxes are OFF by default. Loads and braces are not generated. The completion notice reports the column, beam, floor, exterior wall, foundation column, and foundation beam counts.</p>

<h3>Grid Axes, Underlay &amp; Elevation</h3>
<table>
  <tr><td><b>Grid axes</b></td><td>Model → Grid Axes defines named X/Y axis lines. They render as dash-dot lines and snap at intersections</td></tr>
  <tr><td><b>DXF underlay</b></td><td>"Import DXF underlay" shows DXF (LINE/POLYLINE/CIRCLE/ARC) beneath the plan. Toggle with "Show underlay", remove with "Clear underlay"</td></tr>
  <tr><td><b>Elevation</b></td><td>The "Elevation" button renders the frame elevation (columns, beams, braces, level lines) of a selected grid axis</td></tr>
  <tr><td><b>Model cleanup</b></td><td>"Merge nodes" unifies nearby nodes; "Split crossing members" splits beams/horizontal braces at crossings and T-junctions to share nodes</td></tr>
</table>

<h3>Load Cases &amp; Analysis Export</h3>
<table>
  <tr><td><b>Load cases</b></td><td>Assign DL/LL/EQX/EQY/WX/WY in the load tool and property panel</td></tr>
  <tr><td><b>Combinations</b></td><td>Analysis → Load Combinations to edit per-case factors</td></tr>
  <tr><td><b>Analysis export</b></td><td>"Analysis JSON" / "Analysis CSV" export v2 numeric/source IDs, shared 3D nodes, material/section properties, spring stiffness, mass sources, supports, loads, and combinations (source units: mm, N)</td></tr>
  <tr><td><b>Drawing export</b></td><td>"Plan DXF" / "Plan PNG" export the plan drawing</td></tr>
</table>

<h3>View Controls</h3>
<table>
  <tr><td><b>Pan view</b></td><td>Enable "Pan view" above the plan and left-drag to move the view. Click again or press Esc to finish. Right-button drag / Middle-button drag / Space + drag also work. Model coordinates and selection stay unchanged</td></tr>
  <tr><td><b>Fit to view</b></td><td>Click "Fit to view" above the plan to center all displayed model elements</td></tr>
  <tr><td><b>Zoom</b></td><td>Mouse wheel (centered on cursor)</td></tr>
  <tr><td><b>Origin & Axes</b></td><td>Origin and axis directions (X, Y) shown at bottom-left</td></tr>
  <tr><td><b>3D view</b></td><td>Click "3D View" tab at top</td></tr>
</table>

<h3>Keyboard Shortcuts</h3>
<table>
  <tr><td><kbd>V</kbd></td><td>Element tool (select / edit / delete)</td></tr>
  <tr><td><kbd>M</kbd></td><td>Line tool</td></tr>
  <tr><td><kbd>F</kbd></td><td>Surface tool</td></tr>
  <tr><td><kbd>L</kbd></td><td>Load tool</td></tr>
  <tr><td><kbd>S</kbd></td><td>Support tool</td></tr>
  <tr><td><kbd>Enter</kbd></td><td>Close and confirm surface polyline</td></tr>
  <tr><td><kbd>Esc</kbd></td><td>Cancel / Deselect / Close modal</td></tr>
  <tr><td><kbd>Delete</kbd></td><td>Delete selected element</td></tr>
  <tr><td><kbd>Ctrl+Z</kbd></td><td>Undo</td></tr>
  <tr><td><kbd>Ctrl+Y</kbd></td><td>Redo</td></tr>
  <tr><td><kbd>Shift</kbd></td><td>Angle constraint (0/45/90°)</td></tr>
</table>

<h3>Property Panel</h3>
<p>Select an element to edit in the right panel:</p>
<ul>
  <li><b>Line</b> - Section / Start point (X,Y) / End point (X,Y) / End condition (I/J) / Spring symbol (when spring)</li>
  <li><b>Surface</b> - Section / Load direction (floor only)</li>
  <li><b>Load</b> - Type / Coordinates / Value (area/line) / Force &amp; Moment (point) / Color</li>
  <li><b>Support</b> - Position (X,Y) / Translation (DX,DY,DZ) / Rotation (RX,RY,RZ) / Presets (Pin/Rigid/Free)</li>
</ul>
<p>Start/end point coordinates can be edited numerically to precisely position nodes.</p>
<p>In the line tool, beams and horizontal braces are managed on the current layer; columns and vertical braces are managed by their base layer, with the top layer shown in the toolbar.</p>
<p>Type, layer, width/height, and color are display-only. Changing section automatically updates dimensions and color, including surface color sync in both plan and 3D views.</p>

<h3>Roof Workflow</h3>
<ol>
  <li>Select a floor or exterior wall outline to auto-generate roof planes, or create roof/eave surfaces manually with the Surface tool. Auto-generation supports single-plane, X-ridge gable, Y-ridge gable, and hip presets.</li>
  <li>Gable and hip auto-generation require axis-aligned rectangular outlines. Split complex roofs or openings into multiple roof planes that share edges.</li>
  <li>Assign the same <code>roofGroupId</code> to roof planes that form the same ridge, valley, or hip system.</li>
  <li>Set slope, up direction, and base height on each roof plane, then confirm the slope direction in 3D view.</li>
  <li>Generate edge beams and slope beams per roof plane as needed. Shared edges inside a roof group are treated as ridge/valley/hip joints, not edge beams.</li>
  <li>Generate ridge/valley/hip members from the roof group, then generate eaves and gable walls from the outer edges. Validate self-intersections and shared-edge height mismatches before removing and regenerating generated elements.</li>
  <li>Confirm unit weight and wind/seismic flags, then review projected areas, seismic weight, and roof member lengths by role in the quantity summary. Expand surface and roof member detail tables, or export summary/detail CSV files.</li>
</ol>
<p>Single-plane generation supports rectangular and polygon outlines. X-ridge gable, Y-ridge gable, and hip presets support axis-aligned rectangles only; non-rectangular, rotated, or opening-based shapes should be split into roof planes first.</p>

<h3>Display &amp; Selection Options</h3>
<p>View → Display settings groups controls into Common, Plan and 3D. Snap is always visible in the left panel; expand Input aids for the other input options. If display filters hide the element you are placing, the placement panel provides a link to display settings.</p>
<table>
  <tr><td><b>Snap</b></td><td>When ON, snaps to grid points and existing nodes</td></tr>
  <tr><td><b>Show Supports</b></td><td>When OFF, hides supports in both 2D and 3D views. Click selection of supports is also skipped</td></tr>
  <tr><td><b>Wide Pick</b></td><td>When ON, widens the click tolerance for easier selection of off-grid elements (8px → 20px)</td></tr>
  <tr><td><b>2D Layers</b></td><td>Switch between all layers, current layer only, or halftone display for other layers</td></tr>
  <tr><td><b>Lock Other Layers</b></td><td>Keeps halftone layers visible for reference while preventing selection and dragging</td></tr>
  <tr><td><b>Display Filters</b></td><td>Toggle members, surfaces, loads, member types, sections, end symbols, and placement labels</td></tr>
  <tr><td><b>3D Lines</b></td><td>Show line members as section solids or center lines. Beam 3D Section switches beams only between box, H-section strong-axis, and H-section weak-axis solids. Surfaces remain as faces</td></tr>
  <tr><td><b>Copy Level / Model Check</b></td><td>Duplicate elements to another level and check missing references, duplicates, and zero-length elements</td></tr>
</table>

<h3>Settings / User Definitions</h3>
<p>Click the ⚙ Settings button at the top right of the screen to open the settings modal.</p>
<ul>
  <li><b>Theme</b> - Switch between Dark / Light</li>
  <li><b>Language</b> - Switch between Japanese / English</li>
  <li><b>Model → User Definitions</b> - Add/manage material, section, spring, and analysis-property definitions</li>
  <li><b>Help menu</b> - Opens this quick manual</li>
</ul>
<p>Default definitions (for example <code>_G</code>, <code>_C</code>, <code>_S</code>, <code>_OW</code>, <code>_IW</code>, <code>_SP</code>) cannot be edited or deleted. Custom names cannot start with <code>_</code>. Line section definitions can set I/J end condition presets used when placing new lines. After registration, fields other than name can be updated (size, color, end presets, memo), and custom definitions can be deleted unless they are currently in use.</p>
<p>Use "Group List" to review registered definitions for the current group in a separate dialog.</p>
<p>Use "Export" to download user definitions as a JSON file, and "Import" to load definitions from another environment.</p>

<h3>Layer Management</h3>
<p>Click Manage next to the input level selector to open the layer management modal.</p>
<ul>
  <li><b>Add</b> - Add a new layer (z value auto-calculated)</li>
  <li><b>Edit</b> - Directly edit layer name and z value (height in mm)</li>
  <li><b>Delete</b> - Only unused layers can be deleted</li>
</ul>
<p>Layers are displayed sorted by z value (ascending). Duplicate z values are not allowed.</p>

<h3>Data I/O</h3>
<p>Materials define E, G, and density; member sections allow explicit A, Iy, Iz, and J overrides plus effective shear-area ratios Ay/A and Az/A. Select rectangle, H-section, or box section and use “Calculate Properties from Shape” to fill integer section properties; blank properties remain calculated from the selected shape. H-section fillets and box corner radii are not included. Springs allow kr and optional kt; blank rotational spring stiffness is exported as a warning. Built-in material values are trial defaults and must be reviewed before analysis.</p>
<p>Use "Analysis Export Settings" to edit load-case mass factors and choose whether member self-weight is calculated from density or already included in DL.</p>
<p>Analysis JSON/CSV export runs a preflight check first. Export is stopped when the source model is inconsistent, required material/spring/mass properties are undefined, no member elements exist, or any disconnected component retains rigid-body motion. The restraint check covers the six whole-body degrees of freedom; it does not replace a solver stiffness or internal-mechanism check. Results are shown in Model Check.</p>
<p>CAD data (drawing) and user definitions (materials/sections/springs) can also be <b>managed as separate files</b>.</p>
<table>
  <tr><td><b>Save CAD</b></td><td>Click File → Save CAD to download drawing data as JSON. The complete material catalog plus default and in-use custom section/spring definitions are included</td></tr>
  <tr><td><b>Load CAD</b></td><td>Click File → Load CAD to load a JSON file. Existing custom definitions in memory are preserved</td></tr>
  <tr><td><b>Export Defs</b></td><td>Model → User Definitions → "Export" to save custom definitions to a separate file</td></tr>
  <tr><td><b>Import Defs</b></td><td>Model → User Definitions → "Import" to load custom definitions from another environment. Definitions with duplicate names (including those loaded from CAD files) are skipped</td></tr>
  <tr><td><b>Member Schedule CSV</b></td><td>File → Summary → "Export Member Schedule CSV" writes one row per member type and section (count, length, unit weight from material density × section area, weight) followed by one row per member. The same "Member Schedule" table appears in the Summary panel. A cross (X) vertical brace counts as two pieces; weight is left blank when the section area or density is unknown</td></tr>
</table>
<p>When importing, the number of added and skipped items is shown. Section and spring definitions can include a memo (description text).</p>
<p>Node, member, surface, load, and support IDs are written to CAD files and preserved when reloaded. Files saved with older versions can still be loaded.</p>
`;

export function getHelpContent(lang) {
  return lang === 'en' ? helpContentEn : helpContentJa;
}
