# 0016: 配布・署名・更新・復旧の実装設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / pack・release artifact・署名・更新はいずれも未受入 |
| 優先度 | P1。製品previewの必須gate |
| 依存 | [0011 data](0011-app-loading-origin-and-storage.md)、[0013 CLI](0013-cli-diagnostics-and-developer-workflow.md)、[0014 apps](0014-real-app-acceptance.md)、[0015 evidence](0015-oracle-ci-and-evidence.md) |
| 指標 | [0017 performance](0017-performance-and-resource-budgets.md) |
| 最初の配布 | macOS / Apple Siliconのみ。Intel Macは初期対象外 |

## 1. 配布の成功条件

利用者がNode、MoonBit SDK、Xcode、npmを用意せず、署名されたappをinstallして対象操作を完了し、更新に失敗しても既存dataを失わず前版へ戻れることを実用化の条件にする。開発環境でCLIが起動したこと、空windowが開くこと、CI artifactが生成されたことだけで配布可能としない。

初期productはPR #3の `electron-nodeless-adapted-v1` を明示したpreviewを目指す。strict profileのblockedは保持する。Node-backedを配布する場合は別artifact/profileとし、同梱Nodeの容量・更新責任を含める。

## 2. Bundle構成案

| 領域 | 内容 | 監査 |
| --- | --- | --- |
| executable | native launcher/supervisor、QuickJS runner | Mach-O arm64、実行権限、private/test API非混入 |
| runtime | compiled MoonBit core、QuickJS source/build provenance、C/ObjC leaves | hash、license、engine/build flags |
| app | immutable Main/prepared JS、renderer、必要なproduction依存 | app/source/asset hash、閉包 |
| adapter | audited generated preload、明示dependency alias | 元との差分、hash、許可operation |
| resources | icon、Info.plist、locale、native resource | app ID/表示名/URL scheme/型関連付け |
| metadata | runtime/profile/compatibility/SBOM/NOTICE | exact versionとevidence scope |
| writable data | bundle外のapp/profile専用root | 0011のpolicy、migration/backup |

検証用Electron、Node、Node-API `.node`、npm CLI、SDK、test fixtures、debug-only private selectors、secretをNode-less bundleへ含めない。依存file名の検索だけでなくdynamic libraries、spawn、PATH lookup、実processを監査する。

`app.isPackaged`、`resourcesPath`、`getAppPath`、`getName/getVersion`は実際のbundle状態に対応させる。`isPackaged=false`を強制してupdater等の未実装分岐を隠す方法をproduction成功として採用しない。

## 3. Buildからpackまで

1. runtime toolchain/QuickJS source/flags/SDKをlockする。QuickJSのsource SHA-256は初回vendor検証で確定する。
2. app commit/lockfileを取得し、独立build環境でtypecheckとemitを行う。build時のNode/Electronの存在をproduct依存と混同しない。
3. inventoryに基づいてproduction dependency閉包を作る。Mojiのeager updater/zlib/Buffer問題を無視しない。
4. original input、prepared JS、generated adapter、dependency aliasesのhashをmanifestへ入れる。
5. private stagingでbundleを生成し、全required file、相対resource URL、case/Unicode pathを検証する。
6. no-Node/no-Chromium、public API、license、secret、source consistencyのauditを実行する。
7. 同じunsigned payloadを記録してから署名し、signed artifactのhashを別に採る。署名timestampによる非再現byteとpayload再現性を区別する。
8. install/open/実app scenario/quitをclean targetで実行する。
9. release evidenceとartifact digestを結び付け、publish-readyの判定を生成する。

途中失敗は既存bundleを上書きせず、stageをfailedとして残すか自分のstageだけを片付ける。元app sourceと過去releaseを削除しない。

## 4. macOS署名とnotarization

Electron公式配布資料でもmacOSのcode signingとnotarizationは別段階である。electron.mbtはElectron packagerの実行結果を流用せず、独自のnative bundle全体へ適用する。[S1]

1. bundle ID、version、minimum supported macOS、CPUをmetadataへ明記する。最小OS versionは実機/API availability検証後に固定する。
2. nested executable/dylib/resourceの署名順とentitlementsを管理し、必要以上の例外を追加しない。
3. hardened runtime等はQuickJS・WebKit・helper構成で実際に必要な条件を検証する。JITを使わないengineという理由だけでentitlement検証を省かない。
4. code signatureの検証、Apple notarization、stapling、Gatekeeper/quarantine付き初回起動を別々に記録する。
5. identity/keyはrelease環境のsecret管理で扱い、report/bundle/sourceへ含めない。
6. CIでcredentialsを使えない場合はunsigned-build PASSとsign/notarize未実行を分ける。release gateを通さない。
7. private WebKit selectorsを含むfault-test binaryはrelease入力に選べないようbuild targetとartifact名を分ける。

具体コマンド例はrelease実装時に `codesign` / `xcrun notarytool` / `xcrun stapler` / `spctl` の対象OS版で固定し、署名前のdry-runと実行結果を区別する。

## 5. Runtime manifest / SBOM / license

manifestにはprofile、app/runtime/engine/source hash、OS minimum、WebView要件、adaptation一覧、supported scenario、known unsupported、data schema、update channelを含める。

現main treeにはroot LICENSEが見当たらず、`moon.mod`にもlicense項目がない。第三者アプリやQuickJSのlicenseがMITでも、electron.mbt自身の配布licenseが自動的にMITになるわけではない。配布前に所有者の方針を確定し、source/binary/third-party noticesを整備する。今回の計画ではlicenseを勝手に選定しない。

SBOMはbundleに実際に含まれたcomponentを列挙し、devDependencies除外とtransitive production依存の残存を検証する。QuickJS、MoonBit runtime、native libraries、npm由来依存、icons/fonts等の由来を追えるようにする。

## 6. 更新は段階的に実装する

### 6.1 Preview: 完全bundleの明示更新

最初のpreviewでは署名済みfull bundleを明示操作で更新する。download/verify/stageとapp置換を分離し、既存appとdataを維持する。Electron `autoUpdater` APIは未対応として残し、Mojiのimport/起動副作用は0014のadaptation台帳で解決する。

### 6.2 Stable候補: runtime-owned update

| phase | 操作 | 失敗時 |
| --- | --- | --- |
| Check | signed metadata、channel/OS/CPU/versionを検証 | 現version継続、診断 |
| Download | 限定URL、size上限、resume条件、digest | stage破棄/再取得、app本体不変 |
| Verify | signature/payload hash/profile/data互換 | 不一致を拒否、実行しない |
| Stage | 同filesystemのnew bundle、currentを保持 | current継続 |
| Prepare | appへ保存・終了を依頼 | 取消なら更新延期 |
| Switch | atomicに新bundleへ切替 | 失敗なら旧bundle維持 |
| First run | health/data migrationのcommit点を確認 | policyに従い旧bundle＋backup復旧 |
| Commit | successful versionを記録 | rollbackに必要な情報を保持 |

metadata署名とOS code signatureは役割が違う。HTTPSだけでupdate payloadを信頼しない。channel/epochと最低許容versionを持ち、rollbackは許可した署名済み前版へ限定する。downloaded appの任意postinstall commandをそのまま実行する更新器を作らない。

### 6.3 data migration / rollback

1. 旧data schemaとbackupを確認してからmigrationを始める。
2. 変換中断、disk full、new app crash、旧app起動を試験する。
3. 二重起動を検出し、一方がdataを書いている間に別versionを更新しない。
4. backward-compatibleでないmigrationではbinaryだけ戻して成功としない。backup restoreまたは読み取り専用復旧を明示する。
5. 自動rollbackで新規作成dataを失う可能性がある場合は、差分保存と利用者の確認手順を用意する。

Electron `autoUpdater`互換はruntime更新器とは別issueとしてAPI/events/feed formatを比較する。独自更新器が動いただけで互換APIをsupportedにしない。[S2]

## 7. Distribution channels

最初はGitHub Releaseに署名済みmacOS arm64 app、checksums、profile/evidence/NOTICEを揃える案。CLI binaryとapp bundleを別assetにする。Mooncakesやmoon-binstallによるCLI配布はpackage名・entry・upgrade契約が整ってからconsumer E2Eを追加する。既存 `moon.mod` のpackage名だけでinstall可能と案内しない。

WindowsはWebView2 Evergreenの既導入/未導入/管理端末/オフラインを分ける。LinuxはWebKitGTKのsystem dependencyを明示する。共有runtimeをdownload sizeから隠さず0017のcold/warm別集計へ含める。

## 8. 受入matrixと完了

| What | 必要な結果 |
| --- | --- |
| clean install | Node/SDKなし・非開発端末でM1-M3/再起動成功 |
| source integrity | app/adapter/payload hashesがpack inputと一致 |
| signing | signature/notarize/staple/Gatekeeperを個別PASS |
| production purity | Node/Chromium/test-only SPI/secret混入なし |
| missing dependency | 明確な診断、隠れdownload/fallbackなし |
| interrupted update | download/switch/migration各点で旧app/data保護 |
| rollback | 署名済み前版と正しいdata schemaで再起動 |
| wrong artifact | 別OS/CPU/profile/署名/古いepochの拒否 |

分割PRはbundle skeleton → content audit/native pack → signing workflow → clean install → full update/rollback →必要ならElectron updater互換。preview完成とstable更新器完成を別milestoneにする。

## 9. 出典

1. [S1: Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
2. [S2: Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)
3. [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
4. [main tree](https://github.com/f4ah6o/electron.mbt/tree/30c6fc97186e7ecfc8397c799525f00c8e4f0f65)、[PR #3](https://github.com/f4ah6o/electron.mbt/pull/3)
