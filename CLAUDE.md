# CLAUDE.md

音声入力で研究日誌をつける Web アプリ．仕様は [docs/spec.md](docs/spec.md) を正とする．

## 構成
```
index.html          アプリ本体（これ1ファイルで動く）
tests/core.test.js  コアロジックのテスト（node --test）
docs/spec.md        仕様書
```
`index.html` の中は2つのスクリプトに分ける：
- `<script id="core">`：**純粋関数だけ**を置く（DOM，fetch，SDK は使わない）．グローバルに `Core` オブジェクトを1つ公開する．
  - 主な関数：`loadEntries(storage)`，`saveEntries`，`upsertEntry(entries, {date, mode, text, summary, now})`（summary が null なら原文のまま），`nextTranscript`，`updateEntry`，`deleteEntry`，`weekRange(baseDate)`，`selectWeekEntries`，`systemPrompt(kind)`，`buildRequest(kind, input, model)`，`buildWeeklyInput`，`extractText(response)`，`ensureHeading`，`monthGrid(year, month0)`，`renderMarkdown`
  - 記録の配列は変更せず，新しい配列を返す．
  - localStorage は引数 `storage` として受け取り，テストでスタブに差し替えられるようにする．
  - 日付は `YYYY-MM-DD` の文字列で扱う．ローカル日付で計算し，`toISOString()` で日付を作らない（UTC にずれるため）．
- `<script type="module" id="app">`：UI，Web Speech API，Claude SDK の呼び出しを置く．`window.Core` を使う．

## テスト
- 実行：`node --test`（npm の依存パッケージはなし．Node 20 以上）
- `tests/core.test.js` は `index.html` を読み込んで `<script id="core">` の中身を正規表現で取り出し，`node:vm` のコンテキストで実行して `Core` を取得する．
- 最低限テストすること：新規作成と追記（区切り線，同じ日付とモードで1件になること，日付が同じでモードが違えば別の記録になること），`summaryEdited` の扱い，7日間の範囲（境界と月またぎ），週次の抽出で日記が除かれること，プロンプトの組み立て，壊れた JSON の退避，`extractText`（refusal と text の連結），カレンダーの日付計算．
- vm で動かした Core が返す配列やオブジェクトは別の realm のものなので，`assert.deepEqual` で `[]` や `{}` のリテラルと比べると失敗する．長さで比べるか，`[...x]`／`{...x}` に展開してから比べる．
- 小見出しの規則（必ず `## ` で始める，話題ごとに分ける）はプロンプトのテストで守る．
- UI と音声は手動で確認する（spec の受け入れ基準を使う）．

## 作業ルール
- **`node --test` がすべて通ったことを確認してから git commit する．** 失敗したまま commit しない．
- ロジックを足すときは，まず `core` に純粋関数として書いてテストを付け，`app` からはそれを呼ぶだけにする．
- 仕様を変えたら `docs/spec.md` も同じ commit で更新する．
- 必要最小限にする．spec の「範囲外」は作らない．
- 外部スクリプトは jsDelivr から**バージョンを固定して**読み込む（`@anthropic-ai/sdk` だけ）．他のライブラリは追加しない．外部のスタイルシートは Google Fonts の「M PLUS Rounded 1c」だけにする．
- デザインはパステル調で親しみやすく（spec 2.2）．色は `:root` の CSS 変数で定義し，ダークモードも一緒に直す．
- iPhone の Safari でも使えるようにする（spec 2.1）．入力欄の文字は 16px 以上，押せる部分は高さ 44px 以上にし，safe-area に配慮する．
- APIキーや個人の日誌データをコード，テスト，commit に含めない．
- Claude API の model ID，パラメーター，ヘッダーは spec の6章に従う．推測で変えない．

## 公開（iPhone で使うため）
- GitHub Pages で `index.html` を公開する（main ブランチのルート）．更新は，テストを通して commit したあとに `git push` する．
- iPhone では公開 URL を Safari で開き，「ホーム画面に追加」して使う．

## 動かし方
- `index.html` をブラウザ（Chrome／Edge）で直接開く．マイクの使用を許可する．
- `file://` だとマイクの許可を毎回求められる場合や，ESM の読み込みに失敗する場合は，ローカルサーバーで開く：`npx serve .` または `python -m http.server`．
