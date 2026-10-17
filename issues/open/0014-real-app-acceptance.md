# 0014: 固定実アプリ Moji / jmd の起動閉包・受入・データ保護

Status: open
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: impl/0014-app-inventory-baselines

## 概要

固定した Moji / jmd の source、build 出力、起動依存、API と操作結果を結び付ける実装・調査 issue。最初の成果物は N0 の machine-readable inventory と upstream baseline の再現条件であり、完成した Node-less runtime がなくても着手できる。

| 分類 | 決定 |
| --- | --- |
| 性質 | 初回は source/build 調査と収集器実装、後続は native 実アプリ受入 |
| 優先度 | P0: A1/A2・EP-05、P1: A3〜A6・EP-21/23/27 |
| 利用者に見える成果 | Moji の編集・native open・保存・再起動と日本語入力を、明示 adapted 範囲で使えるか判断できる |
| 初回 branch | `impl/0014-app-inventory-baselines`（提案、未作成） |
| 最初の対象 | 固定 2 app の source/lock/entry graph、Moji typecheck/emit の別記録、jmd の protocol 拒否条件 |

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / design |
| 優先度 | P0（N0 起動閉包・差分確定）、P1（N4 Moji 操作）、P1（N5 配布受入） |
| 作成 / 更新 | 2026-10-17 |
| 上位 | [0004 実用化ロードマップ](0004-production-readiness-roadmap.md) |
| 依存 | [0006 profiles](0006-runtime-architecture-and-profiles.md)、[0008 runtime / loader](0008-nodeless-runtime-and-module-loader.md)、[0011 origin / storage](0011-app-loading-origin-and-storage.md)、[0012 OS services](0012-os-services-and-desktop-integration.md) |
| 関連 | [0007 bridge](0007-context-bridge-feasibility-and-security.md)、[0015 evidence](0015-oracle-ci-and-evidence.md)、[0016 packaging / update](0016-packaging-release-and-updates.md)、[0019 native interaction](0019-native-interaction-and-accessibility.md) |

## 背景

### 1. 目的と選定済み事項

実アプリの main / preload / renderer / build input を特定し、実装する API を起動と操作の因果関係から決める。サンプル fixture の成功から Electron アプリ全体の互換を推定しない。

[PR #3](https://github.com/f4ah6o/electron.mbt/pull/3) の HEAD `49ec04fac8f1db7212f98ade5a82128f1c4692e5` の対象と profile を維持する。文書中の対象は選定済みであり、別の簡単なアプリへ置き換えて成功と報告しない。

| 対象 | 固定 revision | ライセンス | 役割 |
| --- | --- | --- | --- |
| [alexishida/Moji v1.0.5](https://github.com/alexishida/Moji/tree/b7b1d585d61772a0f791f165c8d07a420443b65b) | `b7b1d585d61772a0f791f165c8d07a420443b65b` | MIT、Copyright 2026 Alex Ishida [M-L] | TypeScript / React 一次対象、M1〜M3 |
| [jojonki/jmd v0.2.3](https://github.com/jojonki/jmd/tree/f875fc616feb89ea803a0fc140ec770a2ade041e) | `f875fc616feb89ea803a0fc140ec770a2ade041e` | MIT、Copyright 2026 jonki [J-L] | plain CJS 二次対象、J1 診断・負例 |

1. 主対象は `electron-nodeless-adapted-v1`。元 preload の任意 closure / 同期 function proxy を一般的に再現するとは主張しない。
2. `electron-nodeless-v1` strict は既存 ADR の blocked を維持する。実アプリの adapted 成功で strict gate を閉じない。
3. code source、配布 JS、renderer asset、生成 adapter、追加 build config の各 hash と差分を分ける。
4. アプリ root の MIT は確認済み。npm 依存・同梱 font / icon / sample 等のライセンス一覧の完全性は、実配布物で別に検証する。
5. 以下の source / lock 読取は実施した。アプリ build、native 実行、E2E、署名、Node-free artifact audit は未実行。

### 2. 2026-10-17 に読んだ一次入力

| アプリ | 確認した入力 | 読取で分かること | まだ分からないこと |
| --- | --- | --- | --- |
| Moji | `package.json / package-lock.json / electron.vite.config.ts` | main entry、lock 解決版、upstream build 定義 | build 出力の module kind、tree shaking、external dependency の実結果 |
| Moji | `electron/main.ts / preload.ts / shared.ts` | Electron / Node import、IPC 名、window / quit path | native の event order と実動作 |
| Moji | `electron/settings.ts / updater.ts / export.ts / png.ts` | eager import、sync settings I/O、Buffer / zlib の起動影響 | npm package の実際の評価閉包 |
| Moji | `src/App.tsx` | 初期 API 呼出、listener cleanup、readonly guide、save / close 操作 | 全 renderer component の網羅、WebKit の実表示 |
| jmd | `package.json / package-lock.json / electron/main.js / preload.js / updater.js` | CJS、custom protocol、IPC、lazy updater / unref timer | 原本の安全な positive 起動、全 renderer の動作 |
| 両者 | revision 固定の `LICENSE` | root license | 全依存とアセットの SBOM |

この inventory は「確認済み source の静的調査」であり、アプリ全体の実行 trace ではない。未読 renderer module、computed import、package install script、generated output を unknown として残す。

### 3. lockfile と oracle を分離する

| 項目 | Moji | jmd |
| --- | --- | --- |
| package-lock format | 3 | 3 |
| lockfile Git blob SHA | `dde54e276b56e9ebb4c2d9f119fc36e7870f7007` | `705d5cd5bc3cbc02989e949ec6ce06f03d1efded` |
| package の main | `out/main/main.js` | `electron/main.js` |
| locked Electron | **43.1.0** | **35.7.5** |
| locked electron-updater | 6.8.9 | 6.8.9 |
| locked build | electron-vite 5.0.0、Vite 7.3.6、TypeScript 5.9.3 | Vite 6.4.3 |
| input mode | C: upstream TS build | A: CJS main + upstream-built renderer |
| upstream build command | `npm run build` → `electron-vite build` | `npm run build` → `vite build` |
| 型チェック | `npm run typecheck` → `tsc --noEmit -p tsconfig.json` | package script に独立 typecheck はない |

上記は package range から推定せず、fixed lockfile を読んだ値である。[M-P], [M-K], [J-P], [J-K]

1. 既存 core fixture の Electron **44.7.0 / embedded Node 24.21.0** は維持する。
2. real-app の upstream baseline は上表の locked Electron を別 oracle として記録する。embedded Node / Chrome は実 executable から取得し、推測しない。
3. 44.7.0 で上流アプリを再実行する場合は、upstream pin からの upgrade compatibility test とする。元版の結果を上書きしない。
4. oracle は build/test 専用の隔離環境で使う。いずれの Electron / Node executable も Node-less 製品へ含めない。
5. baseline 自体が失敗したシナリオを candidate の合格証拠にしない。環境起因・upstream起因・candidate divergence を切り分ける。

## 問題

実 app の main はウィンドウ表示前に settings、updater、export 関連 module を評価する。UI の対象操作を減らすだけでは必要な Node symbol を除けず、元 preload の同期 disposer をすべて Promise にすると renderer の cleanup が変わる。保存についても、通常 save は save dialog を呼ばないため、open-for-edit 時の write 権限と再保存を受け入れ条件へ含める必要がある。

以下は実 source の静的調査であり、実行 trace による全閉包の確定ではない。未知部分を先に隠さず N0 の入力とする。

### 4. Moji：main の boot dependency 閉包

| 経路 | source で確認した依存 | 起動に与える意味 |
| --- | --- | --- |
| `main.ts` | `electron`、`node:fs/promises`、`node:fs`、`node:path`、`node:url` | 起動時に module resolution が必要 |
| `main.ts → shared.ts` | 型と定数、language / IPC / file extension | build 後に実行定数が残る |
| `main.ts → settings.ts` | `electron.app`、`readFileSync / writeFileSync`、`path.join` | window 作成前・settings IPC で sync fs に到達 |
| `main.ts → updater.ts` | `electron-updater` の eager default import | macOS の update 機能が unsupported でも package の import は必要 |
| `main.ts → export.ts` | `BrowserWindow / dialog / screen`、fs / path、`./png` | export をクリックしないだけでは import を除けない |
| `export.ts → png.ts` | `node:zlib.createDeflate` | top-level import。未対応 builtin として拒否すると boot で失敗し得る |
| `png.ts` top-level | `Buffer.from`、`Int32Array`、CRC table 作成 | Buffer は export 時だけの依存ではない |
| `main.ts` startup | `app.setName / setPath / requestSingleInstanceLock` | 表示前の同期 API と filesystem namespace を要求 |

これは元 source の import 閉包である。`electron-vite` 出力がそれぞれを inline / external / eliminated のどれにするかは、N0 の build 後に確定する。[M-M], [M-S], [M-U], [M-E], [M-N]

#### 4.1 updater の宣言依存閉包

両 lockfile の `electron-updater@6.8.9` から依存を辿ると、updater を含め 16 package instance になる。これは lockfile graph の結果であり、16 個すべてが startup に実行されるという意味ではない。[M-K], [J-K]

| package | Moji lock | jmd lock |
| --- | --- | --- |
| electron-updater | 6.8.9 | 6.8.9 |
| builder-util-runtime | 9.7.0 | 9.7.0、updater 配下の nested instance |
| fs-extra | 10.1.0 | 10.1.0、updater 配下の nested instance |
| js-yaml | 4.3.0 | 4.3.1 |
| lazy-val | 1.0.5 | 1.0.5 |
| lodash.escaperegexp | 4.1.2 | 4.1.2 |
| lodash.isequal | 4.5.0 | 4.5.0 |
| semver | 7.7.4、updater 配下 | 7.7.4、updater 配下 |
| tiny-typed-emitter | 2.1.0 | 2.1.0 |
| debug / ms | 4.4.3 / 2.1.3 | 4.4.3 / 2.1.3 |
| sax | 1.6.0 | 1.6.1 |
| graceful-fs | 4.2.11 | 4.2.11 |
| jsonfile / universalify | 6.2.1 / 2.0.1 | 6.2.1 / 2.0.1、updater 配下 |
| argparse | 2.0.1 | 2.0.1 |

root の `semver@6.3.1` や jmd root の `fs-extra@8.1.0` を updater の解決版と取り違えない。0014 の生成 inventory は package path / resolved integrity / parent edge まで持つ。

#### 4.2 boot blocker の扱い

1. **まず unchanged build output で preflight / launch を試す。** 未実装 `node:zlib` や updater dependencies に到達したら、module chain と source location を記録する。
2. export / updater を操作範囲外に指定しても、起動 import が残るなら boot gate は未達。
3. 解消は「必要な本当の symbol 実装」または「明示した build / dependency adaptation」の別 PR とする。
4. build alias / module replacement を使うなら、差分 manifest に `mainDependencyAdapted:true` と replacement source / reason / hash / unsupported exports を含める。
5. 空 module / successful no-op に置き換えて無改修互換を主張しない。updater replacement が必要なら `autoUpdater` 利用時の明示 unsupported、network / update の不実行を検証する。
6. adapted preload だけの計画から main dependency 変更へ広がった場合、公開説明も変更する。`source input unchanged` と `executed dependency graph changed` を両方表示する。
7. main dependency adaptation を採らない場合は、必要 dependency 実装の完了まで Moji positive は BLOCKED のままにする。

### 6. Moji の startup / first-use side effect

1. `app.setName('Moji')` の直後、`app.setPath('userData', join(app.getPath('appData'), 'moji'))` を実行する。runtime の既定 userData namespace だけでは旧 Moji のデータを隔離できない。
2. `requestSingleInstanceLock` を実行し、二重起動、open-file、before-quit の handler を登録する。
3. ready 後に IPC 登録、application menu、window 作成、updater controller 作成が行われる。
4. window 作成時に settings を同期 read し、locale / theme / bounds を使う。
5. `show:false` の window を `ready-to-show` で表示する。renderer 初回 script / API 初期化が遅れると実アプリが表示できても操作不能になり得る。
6. resize / move 後 400 ms で bounds を settings に書く。settings 書込例外は上流が catch するため、UI が動くことだけで永続化 PASS にしない。
7. updater は 3 秒後に `check()` が呼ばれる。macOS では `supportsAutomaticUpdates()` が false だが、eager package import の負荷・失敗とは別問題である。
8. guide 表示は `readSample` を経由し、renderer は document を **`readOnly:true`** で追加する。guide 自体の編集を M1 の期待値にしない。[M-M], [M-S], [M-U], [M-A]

### 7. jmd：positive を強制しない診断対象

#### 7.1 boot と差分

1. `main.js` は `electron` から `app / BrowserWindow / dialog / ipcMain / Menu / net / protocol / screen / shell / nativeTheme` を CJS require する。
2. `node:path / node:fs/promises / node:fs / node:url`、local `./updater` を require する。
3. ready 前のトップレベルで `protocol.registerSchemesAsPrivileged` を呼ぶ。その `jmd-file` には `standard / secure / supportFetchAPI / bypassCSP:true` がある。
4. ready 後の `protocol.handle` は request URL から absolute path を復元し、`net.fetch(pathToFileURL(...))` へ渡す。
5. この privileged protocol を unsupported として正しく拒否するなら、原本は画像を操作する前でも起動時に止まる。
6. updater package 自体は lazy require。packaged の起動では 8 秒後の `setTimeout(...).unref()` が登録され、実行時に条件を満たすと package / network / update path に進む。
7. `JMD_SMOKE` があると任意指定 script を require する開発専用経路がある。製品環境では採用しない。[J-M], [J-U]

**J1 の当初 positive 目標は、既知の protocol gate が解決するまで BLOCKED。** 同じ原本が明示 unsupported で止まり、native protocol / unrestricted file access が登録されないことを負例の PASS とする。これは `App Scenario Supported` ではない。

#### 7.2 後続で必要になる surface

| 区分 | 確認した要求 |
| --- | --- |
| windows | 複数 window、focus tracking、bounds / size / position、title / edited / represented-file、destroy、fromWebContents |
| layout / theme | hiddenInset、trafficLightPosition、screen nearest point、nativeTheme.shouldUseDarkColors |
| file | read / write、`fs.watch(persistent:false)`、rename 後の再 arm、watch cleanup |
| IPC | invoke に加え send、sender、webContents destroyed event、renderer listener off |
| navigation | setWindowOpenHandler、will-navigate、getURL、external URL |
| renderer synchronous pure helper | `basename / resolveAsset` は page-local で再実装可能だが元 preload adaptation として記録 |
| renderer privileged sync helper | droppedFilePath は `webUtils.getPathForFile`、初版 unsupported |
| updates | staged update、cancel-on-dirty-close、autoInstallOnAppQuit、manual install dialog |

privileged scheme を黙って弱めて同じ名前で登録することや、`bypassCSP` を無視して成功を返す方式を採らない。将来の安全な protocol adaptation では file grant、subresource origin、CSP、query/encoding、remote image 等の差分を別 ADR / scenario にする。

## 目標

1. Moji/jmd の固定 revision ごとに `target / inventory / symbols / adaptations / scenarios / build-provenance / evidence-index` を生成できる。
2. 元 source、ビルド生成 JS、renderer asset、surrogate preload、dependency alias の変化を別々の hash と reason で示す。
3. Moji M1a〜M3f、APP-N01〜N15 と日常操作を、同じ source/profile/candidate/OS に結び付けて実行する。
4. jmd J1 は privileged protocol が未解決の間は expected-rejection とし、元の future positive 目標を保存する。
5. 元ユーザー文書・app data・source を保護し、実 file bytes / settings readback / process cleanup を成功判定へ入れる。

## 対象外

- 選定済み Moji v1.0.5 / jmd v0.2.3 を別 app や latest へ置き換えること。
- strict contextBridge 全般、任意 npm / Node-API / ASAR、Moji export/updater/同期 drag-and-drop、jmd privileged scheme の初版 positive 認定。
- reference Electron を Node-less 製品へ含めること、guide の readOnly を外して編集成功にすること、空 stub で startup を通すこと。
- upstream app repository への source commit、通常ユーザーの既存 data migration、未検証の他 OS 対応宣言。
- N0 の inventory 成功を App Scenario Supported と表示すること。

## 提案する方針

### 最初の bounded slice: A1 / EP-05

1. 各 pinned checkout を読み取り専用の source input とし、root package/lock/license、main/preload/renderer/build-config の inventory を作る。原本 hash を先に記録し、build workspace と保存先を別にする。
2. lockfile graph と source imports を照合し、eager/lazy、literal/computed、boot/scenario を記録する。computed import と生成前 output は `unknown` とし、推測した resolved path を書かない。
3. 監査した install scripts と固定 lock を持つ isolated build workspace で Moji の typecheck と emit、jmd の emit を独立実行する。ソースを修正して build を通した場合は adaptation として別出力にする。
4. 最初の PR は collector、schema、small positive/negative fixtures と 2 app の inventory に限定する。QuickJS shim、privileged file broker、native bridge の有効化は後続 package の対象。

| 既存 / 新規予定 | Path と責務 | Input / Output / error |
| --- | --- | --- |
| 既存 | `bridges/node/app-files.cjs` / `tests/loader.test.cjs` | bounded source inventory の参考。全 checkout と node_modules を無制限に投入せず、既存 limits を黙って広げない |
| 既存 | `scripts/oracle.cjs` / `fixtures/oracle/` | core fixture 専用。app baseline を既存 core evidence path へ上書きしない |
| 新規予定 | `scripts/apps/inventory.cjs` | pinned app root + target manifest + output root → declared files/edges/hashes/unknowns。missing pin、path escape、malformed lock、上限超過は非零 exit と reason |
| 新規予定 | `compatibility/apps/{moji-v1.0.5,jmd-v0.2.3}/` | §8 の 7 JSON。空の schema skeleton だけでは N0 complete にしない |
| 新規予定 | `scripts/apps/collect-baseline.cjs` / `fixtures/apps/` | app target + actual locked Electron executable + disposable data context → app-specific trace と evidence。core oracle とは別 run ID/path |
| 新規予定 | `tests/apps/inventory.test.cjs` / `tests/apps/moji/` / `tests/apps/jmd/` | source/lock 拒否から actual native operation まで段階分割 |

### アプリ境界の入力・出力・失敗

| 操作 | 入力と許可 | 観測する出力・失敗 |
| --- | --- | --- |
| open/read | trusted picker / 現 session の grant、許可された sample name | 元 source の OpenResult/OpenManyResult shape と bytes。BOM の除去等の元処理も fixture に記録し、raw file と editor string を混同しない |
| save | `save(path, content)` と read + replace-selected grant | 元 page API の `{ok:true,path}` または `{ok:false,error}`。ingress で拒否された call は Main を実行せず Promise を reject、broker error を元 Main が catch する場合はその result object を比較 |
| saveAs cancel | native picker cancel | 元 Moji の `{ok:false,canceled:true}`。実 file write・無断 grant 昇格なし |
| atomic-replace-v1 | 宣言した adaptation、実 file identity、bounded bytes | commit 前 failed は元 file 保持。commit 後の uncertain completion は unknown/診断と readback。Node writeFile の truncate/metadata 意味と同一視しない |
| `onX` / disposer | 固定 3 native topic と page-local callback | 同期 disposer、二重登録は別 record、native readiness と full load を分離。event delivery 失敗を正常 close としない |
| denied/unsupported | iframe/old epoch/unknown method、jmd privileged scheme、除外 API | typed reject または元 app が受け取る明示 error。成功 no-op、Node fallback、隠れ download は不可 |

### 5. Moji：最小 API manifest の具体値

#### 5.1 main / native surface

| 分類 | source で確認した symbols / events | 優先範囲 |
| --- | --- | --- |
| app startup | `setName / name / getPath / setPath / getAppPath / getLocale / getVersion / isPackaged / requestSingleInstanceLock / whenReady` | M1 必須 |
| app lifecycle | `quit`、`second-instance / open-file / before-quit / activate / window-all-closed` | M1〜M3 と quit / 再起動 |
| window | constructor、`show / close / isDestroyed / isMinimized / isFullScreen / getNormalBounds / restore / focus / setMenuBarVisibility` | 呼出される branches を inventory |
| window static / events | `getAllWindows`、`ready-to-show / close / resize / move / closed` | M1〜M3、window bounds 保存 |
| webContents | `send / setWindowOpenHandler / on('will-navigate')` | event 配信、navigation 防御 |
| loading | `loadFile`、開発時 `loadURL / openDevTools` | packaged `loadFile` を先行、dev-only 分岐は別 |
| menu | `buildFromTemplate / setApplicationMenu`、macOS `editMenu / windowMenu` 等、custom Cmd+Q | native copy / paste と quit guard |
| dialogs | `showOpenDialog / showSaveDialog`、親あり・親なし overload | M2 / M3、cancel、multiSelections |
| Node | fs sync / promises、path、file URL、Buffer、zlib import、timers、process | 0008 と import closure を一致 |
| deferred exports | `screen.getPrimaryDisplay / executeJavaScript / printToPDF / capturePage / setContentSize / destroy` | 初版除外、boot import と区別 |
| shell | `openExternal / openPath` | URL / path policy を伴う後続受入 |

`app.requestSingleInstanceLock` を常に true とする、menu を空にしてキーボード操作の不具合を避ける、window bounds を仮値で返す、といった置換は当該 API を実装したことにはならない。[M-M], [M-E]

#### 5.2 renderer API と IPC

| page API | IPC channel | 初期受入 |
| --- | --- | --- |
| `getSettings / setSettings` | `settings:get / settings:set` | 必須。settings shape と永続化を確認 |
| `openDialog` | `file:open-dialog` | M2。native picker で grant を作成 |
| `readSample` | `file:read-sample` | 許可済み shipped guide name のみ |
| `save / saveAs` | `file:save / file:save-as` | M3。open-for-edit/saveAsのwrite grant、明示atomic-save adaptation、byte verification |
| `readPath` | `file:read-path` | 任意 path 不可。既存 grant / 再認可した recent entry のみ |
| `confirmClose` | `app:confirm-close` | dirty guard、Promise<void>、cancel と quit |
| `getUpdateState / checkForUpdate` | `update:get-state / update:check` | macOS では元 controller の unsupported state を確認。fake current-version success 不可 |
| `onOpenDocument` | `doc:open` | local synchronous disposer + async event delivery |
| `onCloseRequest` | `app:request-close` | cleanup / duplicate listener / reload |
| `onUpdateState` | `update:state` | startup registration と disposer |
| `getDroppedPath` | `webUtils.getPathForFile` の同期呼出 | 初版 unsupported、drag/drop 対応と表示しない |
| image / export / local open | `file:read-image / doc:export / diagram:export-png / file:open-local-path` | 初期 positive 対象外、許可しない入口を診断 |

`src/App.tsx` は初期 effect で settings / update-state を取り、close / document / update listener を登録する。これらを省いた別画面を動かして Moji 起動 PASS としない。[M-PRE], [M-A]

settings の省略可能 field、`undefined`、Promise<void>、エラー結果 object、event callback は 0007 / 0010 の value profile に合わせる。`undefined` を常に null へ変換して済ませない。

初期adapterは3つのonXに同期local disposerを返す。nativeは `doc:open` / `app:request-close` / `update:state` を固定routeとして先に準備し、各listenerの登録往復を要求しない。元renderer build outputのhashが同じか確認し、元preload未実行とgenerated adapter hashを表示する。初回getSettings/getUpdateStateはDocumentIngressReadyまでbounded queueで待ち、失敗を診断する。getUpdateStateの初期snapshotを無断event replayやlast-value cacheへ置き換えない。

### 8. 実装前 N0 の成果物

新規予定 `compatibility/apps/{moji-v1.0.5,jmd-v0.2.3}/` に以下を保存する。原本アプリの大量コードを不必要に vendor せず、immutable revision と取得 hash を基本にする。

| ファイル案 | 必須内容 |
| --- | --- |
| `target.json` | repo / tag / commit、license、input mode、profile、entry |
| `inventory.json` | original source / renderer / build output hashes、file kind、package parent edge |
| `symbols.json` | module / symbol / process / source location / eager or lazy / boot or scenario / support state |
| `adaptations.json` | 元 source と実行物の差分、generated preload、dependency alias、origin / storage mapping |
| `scenarios.json` | 前提、操作、期待値、negative / positive の種別、gate dependencies |
| `build-provenance.json` | lock hash、toolchain、commands、sourcemaps、resolved integrity、output manifest |
| `evidence-index.json` | candidate SHA、oracle SHA/version、OS、各結果 / artifact checksum |

1. `package-lock` と install script を確認し、隔離 build 環境で固定 install を行う。Electron installer が取得した oracle と実配布依存を混ぜない。
2. Moji の typecheck と upstream build を独立記録する。jmd に存在しない typecheck script を PASS と記載しない。
3. build output を AST で解析し、literal / computed imports、builtins、top-level effects を source inventory と照合する。
4. `electron-updater` の実 JS entry と transitively loaded source を確認する。lock graph だけで Node symbols の最小集合は確定しない。
5. upstream oracle の boot / first-use trace を取得し、module evaluation failure と interaction failure を別に保存する。
6. すべて揃う前に `N0 complete` としない。現在の本書は source / lock 読取の結果までである。

### 9. データを保護する実行環境

#### 9.1 初回受入

1. baseline と candidate は別の clean OS user / test VM、または検証済みの isolated appData environment で実行する。ユーザーの通常 Moji data を入力にしない。
2. Moji が設定する `appData/moji` を、実験専用 root 内の path として解決できる条件を固定する。既存 directory 要件も準備し、環境変更として記録する。
3. `HOME` の書換えだけで AppKit / Electron の path 解決が変わるとは仮定しない。`app.getPath` が返した実 path と read/write trace を検証する。
4. isolated mapping を candidate のみに適用して無変更互換と称しない。両者の環境差を manifest に保存する。
5. app root と shipped samples は read-only。input fixture、保存先、settings、cache を別ディレクトリにする。
6. recentFiles に以前の path が残ると初期画面から読み直せるため、recent entry は権限ではない。新documentではnative ingressとoperation grantを再検証する。存続中のapp-sessionに属する有効なFileGrantは、権利・対象・寿命を再検証して利用できる。前app-sessionのgrantや未許可のrecent pathは、picker等で改めて許可を得る。document失効とMainのapp-session grant失効を同一視しない。

#### 9.2 保存・失敗・切り戻し

1. write は 0011 の grant / root / symlink / commit point 契約を通す。renderer の pathname をそのまま main へ渡さない。
2. `saveAs` の picker cancel では対象 file と設定を変更しない。選択後の side effect は上流との許容差を記録する。
3. 初期Moji adaptedは0011の `atomic-replace-v1` をmanifestへ明記する。rename前のfailed write、容量不足、permission denied、process crashでは元 input の保持を要求し、rename後はcommitted/unknownとreadbackを照合する。Nodeの通常truncate/writeと同一のfailure/metadata意味論とは表示しない。
4. candidate 固有の settings / cache schema を version 化し、前版で読める範囲を明示する。既存アプリ data の上書き migration は初版範囲外。
5. rollback は前版 bundle + その版で読める data snapshot を使用する。新しい schema の data を旧版へ無検証で渡さない。
6. test cleanup は自分が生成した一時領域だけ。保存失敗の証跡やユーザー文書を「試験後 cleanup」で削除しない。

### 14. 分割 PR と終了条件

| PR 単位 | 新規・変更予定 | 出口 |
| --- | --- | --- |
| A1 inventory | `compatibility/apps/`、build-only inventory collector | source / lock / module closure の再現可能な記録、N0 unknown の所在 |
| A2 oracle | `fixtures/apps/` の取得・実行 runner、0015 への接続 | upstream version と core oracle の混同なし、source hash 保存 |
| A3 adaptation decision | `adapters/apps/moji/`、profile manifest | eager dependency の解消方針、preload / main / origin / storage の差分レビュー |
| A4 positive slice | `tests/apps/moji/`、0008 / 0011 / 0012 接続 | M1〜M3 positive + negative の actual native evidence |
| A5 jmd negative | `tests/apps/jmd/` | 同じ original source の explicit unsupported、positive blocked を維持 |
| A6 daily-use / artifact | 0019・0016・0015 evidence 統合 | IME / accessibility、Node-free配布、更新・rollback、全 process 清掃 |

1. A1 だけで「実アプリ対応」を表示しない。
2. A4 を閉じるには Moji の許容 adaptation が明示され、操作・security・data の必須 gate がすべて candidate SHA で満たされること。
3. A5 の負例は未実装の成功率を飾るために使わず、原本の future positive に必要な残件を維持する。
4. A6 で実機・配布試験が未実行なら、本 Issue 全体は open のまま。
5. app version 更新は新 inventory / baseline として扱い、v1.0.7 等へ自動で切り替えない。
6. この設計時点で新しく実行可能になった runtime 機能はない。新しく明確になったものは、実在する boot blocker、必要 symbols、adaptation 範囲、再現可能な受入手順である。

## 受け入れ条件

- [ ] Given 固定 source と lock、when A1 collector を実行、then commit / inputMode / preloadMode / entries / hash / parent edges / unknowns が再現可能で、元 input の hash は不変。
- [ ] Given Moji の typecheck が失敗し emit は成功、when build report を生成、then 2 結果を別々に保存し、型チェックを PASS としない。
- [ ] Given boot に残る updater/zlib/Buffer dependency、when unchanged output を評価、then 到達 chain を記録し、実装または明示 adaptation の採否が決まるまで当該 positive を昇格しない。
- [ ] Given picker で open-for-edit した文書、when 通常 save を 2 回行い再起動後にも再許可して保存、then 期待 bytes と rights が一致し、前 session の grant を流用しない。
- [ ] Given first-use RPC / effect cleanup / native route 遅延、when 初期画面と close を操作、then 元 renderer signature、bounded queue、同期 disposer を維持し、full load との循環待ちがない。
- [ ] Given 原本 jmd の privileged scheme 要求、when gate 未成立で起動、then 明示 unsupported と登録なしを確認し J1 を expected-rejection と表示する。

以下の全 scenario ID・必須 negative・interactive 条件を維持する。実行していない項目を checkbox の数合わせで完了にしない。

### 10. Positive の最小操作シナリオ

| ID | 操作 | 受入結果 |
| --- | --- | --- |
| M1a | Node-free candidate を起動し、upstream の初期画面・menu・settings を表示 | page API が first use に間に合い、boot closure の未対応が隠されない |
| M1b | 日本語 guide を表示 | 既存 guide の本文が表示され、readonly を維持 |
| M1c | 新規またはテスト Markdown を編集 | guide とは別の editable document で編集結果を確認 |
| M2a | native open dialog から isolated `.md` を選択 | picker grant、content bytes、filename、rendered text が対応 |
| M2b | 複数選択 / cancel | 元 API の結果 shape、cancel 後の文書・権限・UI を比較 |
| M3a | 編集を saveAs し、新規 path を選択 | 選択先だけに期待 UTF-8 bytes、元 input / app source は不変 |
| M3b | window を閉じて再起動し、保存した文書を再 open | 新 document generation、byte equality、settings / bounds の実永続化 |
| M3c | dirty document で Cmd+Q / window close → cancel / save / discard | 取消時は生存し、許可時だけ終了、重複 prompt / save なし |
| M3d | 終了後に process / file handles を確認 | runner / host の残存なし、app-所有 pending と listeners の清掃 |
| M3e | open-for-editした文書を編集し、saveAsを使わず通常save。さらに同fileへ再save | read + replace-selected grantで期待bytesだけ更新。初回だけ通る実装、毎回の無断権限昇格がない |
| M3f | 再起動後に保存fileをpickerから再openし、再編集・通常save | 前sessionのgrantを流用せず再許可。promptなしrecent復元は永続grant gateへ分離 |
| J1 | 原本 CJS startup を実行 | protocol gate の明示拒否を negative outcome として記録 |

PR #3 の「sample 表示・編集」は、実 source に合わせ **readonly guide の表示 + editable test document の編集**へ具体化する。guide の readOnly flag を外して達成しない。

M1〜M3 が通っても表示は `App Scenario Supported (adapted)` とする。export / updates / drag-drop / arbitrary local path / 全 menu / 複数 OS を含む全アプリ互換を宣言しない。

### 11. 日本語・日常操作の受入

[0019](0019-native-interaction-and-accessibility.md) の OS/入力実機 matrix と同じ evidence ID を使う。

1. **日本語 IME:** 日本語入力 source と版を固定し、ひらがな入力→候補変換→Return 確定、Escape 取消、未確定文字列の置換、文中挿入を実機で行う。
2. **重複挿入なし:** composition / beforeinput / input の trace と、editor document bytes を併記する。`isTrusted=false` の DOM event だけで IME PASS にしない。
3. **確定前の終了:** composition 中に close / quit を要求し、未保存確認と IME 確定・取消の順序を確認する。
4. **選択・clipboard:** Cmd+A/C/X/V、複数行、絵文字、結合文字、日本語を実 native menu 経由で扱う。クリップボードの保存・復元と test scope を明示する。
5. **focus:** editor / preview / dialog / 別 window 間の focus、背面からの復帰、Tab navigation、keyboard shortcut の誤配信を確認する。
6. **accessibility:** VoiceOver で window、menu、editor、dialog、status を辿れるか検証する。DOM の ARIA 検査だけを native AX PASS としない。
7. **表示・負荷:** 日本語 font / fallback、200% 相当の表示倍率、画面移動 / DPI、長文 Markdown を実測する。ブラウザ engine 差の pixel mismatch と操作不能を区別する。
8. 使用できない実機条件は NOT_RUN と記録する。release gate が要求する項目は NOT_RUN のまま合格させない。

### 12. Negative・失敗注入

| ID | What | 期待する観測 |
| --- | --- | --- |
| APP-N01 | eager unsupported import が UI 表示前に止まる | module chain / symbol / source position、Node fallback なし |
| APP-N02 | updater / export exclusion だけで import failure を隠さない | missing dependency は BLOCKED、empty-success facade なし |
| APP-N03 | raw handler / iframe / external origin が file API を呼べない | native で拒否、file read/write trace なし |
| APP-N04 | old document / guessed path / other-window grant を拒否する | current recipient へ誤配達なし、renderer claim を信用しない |
| APP-N05 | symlink / rename / traversal / encoded URL が root 外へ出ない | broker の検証対象と actual file identity が一致 |
| APP-N06 | save dialog cancel / duplicate submit / late reply を区別する | 重複 write なし、exactly-once terminal |
| APP-N07 | trusted main の async calls が sender global を混線させない | async currentSender を権限に使用しない、ingress grant 検証 |
| APP-N08 | host / runner / WebView crash、save 中 shutdown | bounded cleanup、保存結果・未確定状態の明示、no false success |
| APP-N09 | jmd の bypassCSP 要求を明示拒否する | protocol 未登録、アプリ互換 verdict は unsupported / blocked |
| APP-N10 | settings 書込例外を UI success だけで見落とさない | byte readback failure は persistence gate FAIL |
| APP-N11 | readonly guide を保存先として上書きしない | resource read-only、編集・保存試験は test document を使う |
| APP-N12 | update entry が誤って上流 Electron artifact を導入しない | no background download / install、Node-less update channel を分離 |
| APP-N13 | readonly grant、旧session grant、差替された保存対象を通常saveへ使う | 無断昇格なし、競合の検出可能範囲を明示、atomic modeのmetadata/commit-point試験と一致 |
| APP-N14 | 同じcallback二重登録、React effect cleanup、nested emission、native準備遅延 | 同期disposerのidentityと冪等性、oracleのreentrancy、route失敗の起動診断 |
| APP-N15 | 初回RPC待ち、ready deadline、reload、偽adapter-ready | bounded queue、old epoch再送なし、actual native identity gate、full loadとの循環待ちなし |

## テスト計画

### 現行入口・初回収集・後続 runtime の分離

| 範囲 | Command / 操作 | 判定・今回の実施 |
| --- | --- | --- |
| 既存 inventory | `node cmd/electron-mbt.cjs snapshot fixtures/cjs` | 2026-10-17 polish で exit 0、3 files / 311 bytes。Moji build や互換の証拠ではない |
| source/loader 回帰 | `node --test tests/loader.test.cjs` | 既存 entry/source/escape の unit。今回未実行。N0 collector と同じ安全境界を検討する材料 |
| Moji build | isolated pinned Moji checkout で `npm ci` → `npm run typecheck` → `npm run build` | install scripts/lock の監査後に実行。三つの exit と hashes を独立保存。今回未実行 |
| jmd build | isolated pinned jmd checkout で `npm ci` → `npm run build` | jmd に存在しない typecheck script を要求しない。今回未実行 |
| 新規 A1 unit | `node --test tests/apps/inventory.test.cjs` | 実装 PR で追加する予定。現時点では command の対象 file 未作成 |
| 新規 A2 native | app 専用 collector、locked Electron、disposable OS data、M1〜M3 の操作 | renderer/native/grant/process trace と file readback。runner の command は A2 で version 化。今回未実行 |

`npm ci` は通常利用中の upstream checkout へ実行せず、新規の isolated build workspace を使用する。既存 `scripts/oracle.cjs` に Moji path を渡す案は採らない。source hash だけでは unsafe file write を防げないため、§9 の実環境を先に確認する。

最初の collector の反証は wrong commit、lock parse error、missing entry、symlink/root escape、computed import の unknown、output root が source 内を指す場合。schema/テスト用 synthetic app で検証し、actual app の success に混ぜない。M3 / APP-N 群の native 実行は corresponding runtime と grants が接続されてから行う。

### 13. 結果の分類と必要証跡

| test status | scenario verdict | 意味 |
| --- | --- | --- |
| PASS | supported-in-scope | 実行した positive scenario が定義した期待値を満たす |
| PASS | expected-rejection | negative fixture が狙った拒否を確認。positive 互換ではない |
| FAIL | diverged | 実行したが値・order・security・data integrity が不一致 |
| NOT_RUN | blocked | 既知の前提未達や環境不足で本体操作を実行できない |
| NOT_RUN | unverified | 実行の証拠がない |
| 静的検証 PASS | planned / partial | source / JSON / links が整合。runtime verdict は上げない |

1. evidence は app revision、input / generated hashes、candidate commit、profile、engine、oracle version、OS/SDK/WebView/CPU を必須にする。
2. command、終了 code、ログ、operation trace、screenshots、file before/after digest、grant / pending / process ledger を同じ run ID で保存する。
3. 一部成功なら各 scenario の結果を残す。J1 expected-rejection を M1〜M3 positive の分母へ入れない。
4. core oracle、upstream app baseline、Node-backed runtime、Node-less candidate を列として分ける。
5. 再試行で PASS になっても、初回 FAIL と条件変更を保存する。未解決の native security FAIL を rerun で消さない。

## リスク

| Risk | 防止・検出・再開条件 | Owner role |
| --- | --- | --- |
| 不正確な import 閉包で実装範囲が膨らむ | source/lock と produced JS/runtime trace を分離し unknown を保持。実 entry を確認して A3 を判断 | App / Loader |
| 原本 data と test data が混ざる | 実 OS user/appData/read-write trace、元 hash、read-only sample。通常 data に到達したら実行停止 | QA / Storage |
| 保存の権限不足を arbitrary path write で回避 | open-for-edit/saveAs の rights と再保存、atomic metadata 差を受入 | Storage / Security |
| UI 成功で settings failure / dirty close failure を隠す | bytes readback、grant/terminal ledger、dialog/quit の event trace | App / Native |
| Node-backed / synthetic / negative を Moji positive に足す | §13 の verdict matrix と source/profile/driver の分離 | Evidence / QA |

関連する組込み機能の設計は 0007/0008/0011/0012、native input/AX は 0019、署名と clean install は 0016 が所有する。ここではそれらが本物の app 操作へ接続された結果を受け入れる。

## 未解決の質問

| 質問 / 根拠 | Owner role | 着手できる範囲 / 影響する保留範囲 | 再開条件 |
| --- | --- | --- | --- |
| Q-APP-01: pinned build 後にも残る eager dependency はどれで、本物の symbol 実装と明示 alias のどちらで解消するか。source の import は §4、生成 output は未取得 | App / Engine | A1/A2 の調査・collector は着手可。必要差分を未確定のまま Moji positive を保証しない | output hash / resolution trace / unsupported exports / adaptation manifest を A3 で review |
| Q-APP-02: 初回 app baseline の macOS build・実 OS user/data root・GUI 操作環境をどれに固定するか。Moji は明示 userData 指定を持つ | QA / Native / Storage | portable inventory と fixture 作成は着手可。actual app の write を伴う実行は隔離条件が確認されるまで保留 | 実 appData path、既存 directory、read/write trace、oracle/OS pin を evidence に保存 |

QuickJS の engine 選定、Moji/jmd の版、strict/adapted 分離、Moji の atomic-replace-v1 採用は既存判断として維持し、上の質問で再選定を求めない。

## 変更履歴

- 2026-10-17: 固定 source/lock と 16 updater package instances、boot side effects、Moji API、M1〜M3/J1、APP-N01〜N15 を調査・設計。
- 2026-10-17 polish: 11 必須見出しと必要な質問へ再編。全 pins・source citations・シナリオを保持し、A1 の最小実装、path 所在、app result shape と ingress error、具体 command、調査と runtime 保留の境界を追加。

## 注記

**準備状態:** A1 の inventory/collector と A2 の runner 設計に着手可能。A3 の boot adaptation は Q-APP-01、actual app baseline の環境は Q-APP-02 を解決して進む。M1〜M3 の native 実装がまだないことは N0 調査の blocker ではない。現在の reader/source 調査を N0 complete とも呼ばない。

Status は指定の `issues/open` と既存 open-only / AGENTS の受入運用を保持して open。保留範囲・理由・再開条件を上表に残し、復帰先もこの file の open 状態とする。新しい状態ディレクトリは作らない。Branch は提案で、upstream repository へ push する指示ではない。

polish では pinned Moji `package.json / electron.vite.config.ts / preload.ts`、main の open/save/setPath/ready、settings の catch、jmd の early protocol・save・JMD_SMOKE を照合した。元の numbered heading text を保持しているため §参照を継続できる。

### 15. 一次資料・固定 source

- [M-L: Moji LICENSE](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/LICENSE)。
- [M-P: Moji package.json](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/package.json)、[M-K: package-lock.json](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/package-lock.json)。
- [M-M: Moji main.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/main.ts)。
- [M-S: Moji settings.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/settings.ts)。
- [M-U: Moji updater.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/updater.ts)。
- [M-E: Moji export.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/export.ts)、[M-N: png.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/png.ts)。
- [M-PRE: Moji preload.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/preload.ts)、[shared.ts](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/shared.ts)。
- [M-A: Moji App.tsx](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/src/App.tsx)、[electron-vite config](https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron.vite.config.ts)。
- [J-L: jmd LICENSE](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/LICENSE)。
- [J-P: jmd package.json](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/package.json)、[J-K: package-lock.json](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/package-lock.json)。
- [J-M: jmd main.js](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/main.js)、[preload.js](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/preload.js)。
- [J-U: jmd updater.js](https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/updater.js)。

[M-L]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/LICENSE
[M-P]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/package.json
[M-K]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/package-lock.json
[M-M]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/main.ts
[M-S]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/settings.ts
[M-U]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/updater.ts
[M-E]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/export.ts
[M-N]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/png.ts
[M-PRE]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/electron/preload.ts
[M-A]: https://github.com/alexishida/Moji/blob/b7b1d585d61772a0f791f165c8d07a420443b65b/src/App.tsx
[J-L]: https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/LICENSE
[J-P]: https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/package.json
[J-K]: https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/package-lock.json
[J-M]: https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/main.js
[J-U]: https://github.com/jojonki/jmd/blob/f875fc616feb89ea803a0fc140ec770a2ade041e/electron/updater.js
