# 0016: 配布・署名・更新・復旧の実装設計

Status: polished
Model: GPT-6 Astra Pro
Created: 2026-10-17
Updated: 2026-10-17
Branch: impl/0016-bundle-manifest-audit

## 概要

macOS arm64 の native runtime を、利用者が開発ツールなしで install・起動・復旧できる配布物にする実装 issue。初回は bundle manifest と staging audit の bounded slice を実装し、署名や publish を暗黙に実行しない。Preview と stable の更新機能を別段階にする。

| 分類 | 決定 |
| --- | --- |
| 性質 | build/release 実装と native 配布受入 |
| 優先度 | P1、pack input の provenance/license 調査は早期着手可 |
| 利用者への影響 | Node/SDK の手動準備を不要にし、誤った依存同梱・壊れた update・data 消失を防ぐ |
| 初回 branch | `impl/0016-bundle-manifest-audit`（提案、未作成） |

| 項目 | 内容 |
| --- | --- |
| 状態 | POLISHED / pack・release artifact・署名・更新はいずれも未受入 |
| 優先度 | P1。製品previewの必須gate |
| 依存 | [0011 data](0011-app-loading-origin-and-storage.md)、[0013 CLI](0013-cli-diagnostics-and-developer-workflow.md)、[0014 apps](0014-real-app-acceptance.md)、[0015 evidence](0015-oracle-ci-and-evidence.md) |
| 指標 | [0017 performance](0017-performance-and-resource-budgets.md) |
| 最初の配布 | macOS / Apple Siliconのみ。Intel Macは初期対象外 |

## 背景

現 `cmd/electron-mbt.cjs` は run/pack を app 評価前に `ELECTRON_MBT_M0_INCOMPLETE` / exit 1 で拒否する。`scripts/build-native.cjs` が作るのは `dist/sync_channel.node` という Node-API control probe であり、Node-less の配布 executable ではない。`scripts/macos-probe.cjs` の `.app` も診断 binary である。`dist` 全体を包むだけでは製品 bundle にならない。[現 CLI](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/cmd/electron-mbt.cjs)、[native build](https://github.com/f4ah6o/electron.mbt/blob/8177cf051976b8d7b9eca25ae7ad8820bb04a719/scripts/build-native.cjs)

### 1. 配布の成功条件

利用者がNode、MoonBit SDK、Xcode、npmを用意せず、署名されたappをinstallして対象操作を完了し、更新に失敗しても既存dataを失わず前版へ戻れることを実用化の条件にする。開発環境でCLIが起動したこと、空windowが開くこと、CI artifactが生成されたことだけで配布可能としない。

初期productはPR #3の `electron-nodeless-adapted-v1` を明示したpreviewを目指す。strict profileのblockedは保持する。Node-backedを配布する場合は別artifact/profileとし、同梱Nodeの容量・更新責任を含める。

## 問題

1. release の入力 file・provenance・profile と、diagnostic/test binary を機械的に区別する入口がまだない。
2. native executable が出来ても、署名・notarization・Gatekeeper・clean install・更新中断・data recovery は別の実証を必要とする。
3. 本体 license・署名主体・minimum OS・保持/更新運用は配布判断を左右する。未決でも manifest/auditor の実装は進められるが、そのまま外部配布可能とはしない。
4. updater replacement や `isPackaged=false` で未実装機能を隠すと、実 app の起動・network side effects と配布仕様が食い違う。

## 目標

1. explicit manifest から一つの profile/OS/CPU の staged bundle を作り、全 file の hash と実依存を追跡する。
2. Node-less artifact に Node/libnode/Node-API/hidden Electron/CEF と test-only SPI/secret を入れないことを、static audit と actual process/link/spawn の両面から確認する。
3. Preview は署名済み full bundle の明示置換と復旧条件まで、stable 候補は署名 metadata・download・switch・migration・rollback までを受け入れる。
4. packaging の成功と strict Electron 互換を混同せず、actual app/profile/scenario の範囲を release manifest に示す。

## 対象外

- 初版で Windows/Linux/Intel Mac まで同時配布すること。
- 通常 `pack` の gate を最初の audit 実装だけで解除すること、Node probe の `.app` をそのまま製品として署名すること。
- Electron autoUpdater API と任意 feed の互換、delta update、既存ユーザーデータの無断 migration。
- 本体 license/署名 identity を実装者が推測して決めること、secret の source/report 同梱、無断 publish。
- 依存の存在を隠した download や Electron/Chromium への fallback。

## 提案する方針

### 最初の bounded slice: manifest と staging audit

1. 新規の `release/bundle-manifest.schema.json` と `scripts/release/audit-bundle.cjs`、`tests/pack-audit.test.cjs` を追加する案。最初は read-only audit と小 fixture の拒否条件に限定し、署名鍵や real app bundle がなくても着手できる。
2. 入力は private/quiescent な staging root、runtime/app/profile IDs、explicit file list、source/build/adaptation hashes、OS/CPU、entry、component inventory。暗黙の `dist/**/*` は入力にしない。
3. 出力は `artifactType`、manifest digest、各 file の actual hash、violations、warnings、`productionAudit:unverified|passed|failed`、足りない actual-native gate。unit の synthetic bundle では productionAudit を passed にしない。
4. path escape、未宣言 file、hash mismatch、別 profile/CPU、missing entry、禁止 artifact は副作用前に拒否する。入力を上書きせず、machine-readable reason と非零 exit を返す。具体 CLI error code は 0013 の共通契約へ接続する。
5. generic inventory は core-owned policy と manifest 判定を正本とし、build helper は OS file/hash の leaf にする。実 bundle の構築、native launch、署名の mutation は後続 PR とする。

| 既存 / 新規予定 | Path / 入力 | 変更方針 |
| --- | --- | --- |
| 既存 | `cmd/electron-mbt.cjs` / `tests/manifest.test.cjs` | 初回は通常 pack の fail-closed を維持。native pack の admission が成立した時だけ profile 別 entry を接続 |
| 既存 | `scripts/build-core.cjs` / `scripts/build-native.cjs` / `platform/macos/*Probe.m` | compiled-core provenance を参考にする。Node `.node` と diagnostic app は production file list に含めない |
| 新規予定 | `release/bundle-manifest.schema.json` / `scripts/release/audit-bundle.cjs` | explicit inputs → bounded read-only report。署名 identity や実 API 成立を mock で補わない |
| 新規予定 | `release/macos/Info.plist` / native pack entry / CI release lane | bundle ID、minimum OS、entry、resources、signing inputs を決定後に実装 |
| 新規予定 | `release/manifests/` / SBOM / NOTICE / update metadata | unsigned payload と signed artifact の digest、profile/OS、data schema、supported evidence を対応 |

### 2. Bundle構成案

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

### 3. Buildからpackまで

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

### 4. macOS署名とnotarization

Electron公式配布資料でもmacOSのcode signingとnotarizationは別段階である。electron.mbtはElectron packagerの実行結果を流用せず、独自のnative bundle全体へ適用する。[S1]

1. bundle ID、version、minimum supported macOS、CPUをmetadataへ明記する。最小OS versionは実機/API availability検証後に固定する。
2. nested executable/dylib/resourceの署名順とentitlementsを管理し、必要以上の例外を追加しない。
3. hardened runtime等はQuickJS・WebKit・helper構成で実際に必要な条件を検証する。JITを使わないengineという理由だけでentitlement検証を省かない。
4. code signatureの検証、Apple notarization、stapling、Gatekeeper/quarantine付き初回起動を別々に記録する。
5. identity/keyはrelease環境のsecret管理で扱い、report/bundle/sourceへ含めない。
6. CIでcredentialsを使えない場合はunsigned-build PASSとsign/notarize未実行を分ける。release gateを通さない。
7. private WebKit selectorsを含むfault-test binaryはrelease入力に選べないようbuild targetとartifact名を分ける。

具体コマンド例はrelease実装時に `codesign` / `xcrun notarytool` / `xcrun stapler` / `spctl` の対象OS版で固定し、署名前のdry-runと実行結果を区別する。

### 5. Runtime manifest / SBOM / license

manifestにはprofile、app/runtime/engine/source hash、OS minimum、WebView要件、adaptation一覧、supported scenario、known unsupported、data schema、update channelを含める。

現main treeにはroot LICENSEが見当たらず、`moon.mod`にもlicense項目がない。第三者アプリやQuickJSのlicenseがMITでも、electron.mbt自身の配布licenseが自動的にMITになるわけではない。配布前に所有者の方針を確定し、source/binary/third-party noticesを整備する。今回の計画ではlicenseを勝手に選定しない。

SBOMはbundleに実際に含まれたcomponentを列挙し、devDependencies除外とtransitive production依存の残存を検証する。QuickJS、MoonBit runtime、native libraries、npm由来依存、icons/fonts等の由来を追えるようにする。

### 6. 更新は段階的に実装する

#### 6.1 Preview: 完全bundleの明示更新

最初のpreviewでは署名済みfull bundleを明示操作で更新する。download/verify/stageとapp置換を分離し、既存appとdataを維持する。Electron `autoUpdater` APIは未対応として残し、Mojiのimport/起動副作用は0014のadaptation台帳で解決する。

#### 6.2 Stable候補: runtime-owned update

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

#### 6.3 data migration / rollback

1. 旧data schemaとbackupを確認してからmigrationを始める。
2. 変換中断、disk full、new app crash、旧app起動を試験する。
3. 二重起動を検出し、一方がdataを書いている間に別versionを更新しない。
4. backward-compatibleでないmigrationではbinaryだけ戻して成功としない。backup restoreまたは読み取り専用復旧を明示する。
5. 自動rollbackで新規作成dataを失う可能性がある場合は、差分保存と利用者の確認手順を用意する。

Electron `autoUpdater`互換はruntime更新器とは別issueとしてAPI/events/feed formatを比較する。独自更新器が動いただけで互換APIをsupportedにしない。[S2]

### 7. Distribution channels

最初はGitHub Releaseに署名済みmacOS arm64 app、checksums、profile/evidence/NOTICEを揃える案。CLI binaryとapp bundleを別assetにする。Mooncakesやmoon-binstallによるCLI配布はpackage名・entry・upgrade契約が整ってからconsumer E2Eを追加する。既存 `moon.mod` のpackage名だけでinstall可能と案内しない。

WindowsはWebView2 Evergreenの既導入/未導入/管理端末/オフラインを分ける。LinuxはWebKitGTKのsystem dependencyを明示する。共有runtimeをdownload sizeから隠さず0017のcold/warm別集計へ含める。

## 受け入れ条件

- [ ] Given explicit file list と private staging、when audit/pack を実行、then declared digest が実 file と一致し、source/adapters と元 bundle は不変。
- [ ] Given `.node` / test-only probe / unknown file / path escape / wrong-profile artifact、when Node-less pack admission、then 実行・署名・publish 前に拒否し原因を出す。
- [ ] Given 同じ unsigned payload、when signer を適用、then unsigned payload digest と signed artifact digest を別々に保存し、timestamp 由来の差を再現 build の失敗と混ぜない。
- [ ] Given Node/SDK/Xcode/npm のない clean macOS arm64、when install と Moji M1〜M3 を実行、then 必須操作・再起動・実 process の Node-free audit が成立する。
- [ ] Given signature/notarization/staple/Gatekeeper のどれかが未実行、when release verdict を生成、then unsigned build の PASS から publish-ready を作らない。
- [ ] Given Preview full bundle の手動置換が失敗、when 前版へ復旧、then 署名済み旧 app とその版が読める data で再起動し、実文書の bytes を保持する。
- [ ] Given Stable updater の download/switch/migration 中断または悪い metadata、when 更新を試す、then current app を無断実行/破壊せず、許容した rollback と data recovery を選ぶ。

### 8. 受入matrixと完了

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

## テスト計画

### 現在と追加予定の command

```sh
node cmd/electron-mbt.cjs pack fixtures/cjs
node --test tests/manifest.test.cjs
```

現在の `pack` は 2026-10-17 polish で **期待した拒否 PASS / process exit 1 / ELECTRON_MBT_M0_INCOMPLETE / compatible:false** を確認した。配布成功ではない。manifest test の本 polish での再実行は未実行。初回 audit の実装後も run/pack gate の回帰として残す。

```sh
node --test tests/pack-audit.test.cjs
```

これは新規 file を追加した後の予定 command。最初の test は small fixtures で manifest 不一致・未宣言 file・symlink escape・別 CPU/profile・`.node`/probe・入力変更を拒否する。fixture の file 名だけの検出は production purity の証拠にしない。

実 bundle の validation は macOS release lane で次を別 step にする。exact tool version、argv、exit、artifact hash を同じ evidence run に記録し、credential がないものは NOT_RUN とする。

| Lane | 必須操作・反証 | 今回 |
| --- | --- | --- |
| Native build/audit | Mach-O arch、dynamic links、実 spawn/PATH lookup、全 production dependency | 未実行 |
| Signing | nested binary の署名、code signature 検証、notarization、staple 検証、quarantine/Gatekeeper 初回起動 | 未実行 |
| Clean install | 開発ツールなしで install/open/M1〜M3/quit、再起動、missing dependency/offline | 未実行 |
| Preview recovery | full bundle 置換失敗、旧 signed bundle と保存 data で復旧 | 未実行 |
| Stable update | download/verify/stage/prepare/switch/migrate の各点で故障注入、wrong metadata/rollback version | 未実行 |

最後の 2 lane を同じ完成条件にしない。EP-24/25/27 が Preview、EP-28 が Stable 更新器の受入を所有する。

## リスク

| Risk | 対応・再開条件 | Owner role |
| --- | --- | --- |
| diagnostic/native-addon が製品へ混入 | explicit manifest と build target 分離、リンク/spawn/actual process audit | Release / Native |
| 署名や Gatekeeper を CI artifact 作成で代用 | independent step と clean target evidence、欠損は release 保留 | Release / QA |
| 更新器と data schema が不整合 | commit point / backup / backward-readability と新規 data の保護 | Release / Storage |
| license / 署名鍵 / 更新担当が未決 | §未解決の質問を配布前に解決。auditor 実装は継続可能 | Maintainer / Release |
| invalid staging の cleanup が元 source を消す | private output root と所有範囲を限定、入力は read-only、失敗報告を保持 | Build |

全体方針は 0021 の R17〜R19 と一致させる。code signature があることだけで実行コードの権限安全性を保証しない。

## 未解決の質問

| 質問 / 根拠 | Owner role | 着手可能 / 保留範囲 | 再開条件 |
| --- | --- | --- | --- |
| Q-PACK-01: 本体 source/binary の配布 license と第三者 notice の方針。基点 root LICENSE / moon.mod に未記載 | Repository maintainer / Release | schema/SBOM collector/auditor は着手可。本体方針未定の外部再配布を保留 | license 方針、actual component/license 台帳、NOTICE を決定し artifact へ対応 |
| Q-PACK-02: minimum macOS/SDK、bundle ID、署名主体と最小 entitlement。native runtime の実要求が未測定 | Native / Release / Security | bundle schema・unsigned fixture は着手可。support matrix と signing-qualified artifact の認定を保留 | public API availability/実 machine/必要 entitlement、管理された署名 identity を記録 |
| Q-PACK-03: Stable update の metadata 信頼、最低許容版、data rollback/保持方針 | Release / Storage / Maintainer | Preview の full bundle と手動復旧を先行。自動更新・不可逆 migration を保留 | EP-28 / 0021 DEC-11 の protocol、backup/restore、故障注入結果を review |

これらは完成した publish 候補を作る前提であり、文書 polish に対する追加の許可依頼ではない。Preview に自動更新の全実装を必須化しない。

## 変更履歴

- 2026-10-17: ユーザー指示により `issues/open` から `issues/polished` へ移動し、`Status: polished` と現行参照を同期。実装の準備状態・未解決事項・受入証拠は変更していない。

- 2026-10-17: native bundle、署名、Node-free audit、Preview/Stable 更新、data rollback の設計を作成。
- 2026-10-17 polish: 11 必須セクションへ再編。実 CLI/Node-API probe と将来 pack の違い、最初の manifest/auditor 差分、error/report 契約、Given/when/then、段階別検証と配布判断を左右する質問を追加。既存全設計は保持。

## 注記

- 2026-10-17: ユーザー指示「mv to issues/polished」に従い、整備済みの計画を open から polished へ移動。未解決事項・依存条件・runtime の未受入は本文に保持する。

**準備状態:** schema、staging auditor、SBOM input と test fixture の実装は着手可能。actual native bundle は 0008/0013/0014 の成果に接続して作り、Q-PACK-01/02 を解決して外部配布の gate を判断する。Q-PACK-03 は Stable 更新器の範囲であり、Preview の着手を止めない。

**状態と配置:** 2026-10-17 のユーザー指示により `open` から `polished` へ移動した。現在の保存先は `issues/polished/0016-packaging-release-and-updates.md`。`polished` は計画の整備状態であり、runtime の受入や未解決事項の解消を示さない。着手は本文の準備状態・依存条件に従い、受入は [AGENTS.md](../../AGENTS.md) と各試験の実証で判断する。進捗と再開条件は本ファイルへ記録する。 Branch は実装案。

### 9. 出典

1. [S1: Electron Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
2. [S2: Electron Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)
3. [WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)
4. [main tree](https://github.com/f4ah6o/electron.mbt/tree/30c6fc97186e7ecfc8397c799525f00c8e4f0f65)、[PR #3](https://github.com/f4ah6o/electron.mbt/pull/3)
