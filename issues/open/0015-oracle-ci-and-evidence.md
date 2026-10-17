# 0015: Oracle・CI・証跡・互換判定の実装設計

| 項目 | 内容 |
| --- | --- |
| 状態 | OPEN / 実用化の判定を支える最優先基盤 |
| 優先度 | P0 |
| 既存作業 | PR #5 differential、#6 probes、#8 baseline admission、#9/#11/#12 kernels |
| 依存 | [0005 棚卸し](0005-existing-work-and-integration.md)、[0006 profile](0006-runtime-architecture-and-profiles.md) |
| 受入先 | [0014 apps](0014-real-app-acceptance.md)、[0016 release](0016-packaging-release-and-updates.md)、[0019 interaction](0019-native-interaction-and-accessibility.md) |

## 1. 試験成功と互換性を別にする

既存の全open PRにはHEAD対応CI成功があるが、full oracleはmainでipcMain、別stackでBrowserWindow等に止まる。partial kernel一致、expected unsupported、probeの想定結果、full app完了を同じPASS欄で集計しない。

PR #6のmissing observation受理は現mainソースで再現確認されている。[0005](0005-existing-work-and-integration.md)の反証を先行回帰にする。`{}`を両側で比較してequivalent、process exit0だけでcomplete、`NOT_RUN`をexpectedとしてverifiedへ昇格させる経路をなくす。

## 2. 参照を三種類に分ける

| lane | pin | 目的 |
| --- | --- | --- |
| Core Electron oracle | Electron 44.7.0、Node 24.21.0、source commitを現manifestから固定 | core/API契約を継続比較 |
| Upstream app baseline | Moji/jmdの固定source・lockfile・元Electron version | そのappが元配布条件でどう動くか |
| Forward-compatibility | 意図して更新したElectron/WebView/toolchain | drift検出。既存認定を自動上書きしない |

Moji lockのElectron 43.1.0、jmd lockの35.7.5とcore oracle 44.7.0を混同しない。どの基準で判定したかをapp scenarioへ明記する。latest検索結果はpinでも実行証拠でもない。

## 3. Evidence bundle案

新規schemaを追加する際、現行schema1 readerを黙って意味変更せず、versioned reader/migrationと負例を用意する。

| 区分 | 必須項目 |
| --- | --- |
| identity | evidence schema、run ID、attempt、job、collection時刻、artifact digest |
| profile/adaptation | profileId/profileHash、inputMode、preloadMode、dependencyAdaptations、adaptation manifest hash、比較モード |
| source | repo SHA/tree、fixture hash、app commit、Main/preload/assets、lock/build/adapter hashes |
| candidate | runtime commit、compiled-core hash、native binary hash、engine source/build flags |
| oracle | Electron exact version、source commit、embedded Node version、binary hash |
| environment | OS build/arch、SDK、WebView実version、display/input/GUI availability |
| execution | command/argv、exit code、signal、timeout、start/end、actual driver scope |
| observations | required step IDs、value/exception/event trace、native sender/context、raw metric |
| verdict | harness status、semantic match、supported scope、gate、不足evidence |
| integrity | before/after source hashes、raw log hash、report hash、採用normalization ID |

user codeのstdout markerを唯一の成功根拠にしない。native/runnerの信頼済channelとprocess exit、required observationsを照合する。証跡はrevisionを含むpath/IDで参照し、`evidence/foo.json`という動くpathだけでverifiedを維持しない。

Actions artifactは期限付きである。公開releaseの根拠は保存先とdigestをrelease manifestに固定し、元artifactの期限切れを区別する。個人data・tokenは公開証跡へ含めない。

## 4. Admissionの決定順

1. input全体のbyte/depth/node上限とschemaを検証する。
2. oracleのprocessがcompleted/exit0であること、signal/timeout/異常markerがないことを確認する。
3. 必須semantic observationの存在、型、期待値、trace終端、重複stepを検査する。
4. oracle/candidateの比較モードを検証する。strictは同一source/preload/assetsと宣言build条件をhash照合する。adaptedは同一upstream inputに対する元buildとcandidate変換・生成preload・依存aliasの別hashを照合し、許可されたadaptation manifestとの差だけを認める。profile ID/hashとinputMode/preloadModeが一致しないevidenceでstrict gateを閉じない。
5. candidateの実driverを確認し、synthetic senderやfake nativeならscopeをkernel/unitに限定する。
6. candidate process完了とsemantic値を比較する。既知unsupportedを適合成功へ変換しない。Node-backed/adaptedのpassedをNode-less strictへ代入するreportをschema/admission段階の負例で拒否する。
7. required profile gateを集約し、evidence欠損・未実行・mismatchがあればverifiedを拒否する。

### 4.1 Verdict table

| 状態 | harness | semantic | app/profile結果 |
| --- | --- | --- | --- |
| 両方有効、対象範囲一致 | completed | equivalent | 当該scopeのみpassed |
| valid oracle、candidate差異 | completed | diverged | failed/unsupported |
| oracle incomplete/欠損 | invalid-evidence | 未判定 | unknown、再収集 |
| candidate timeout/crash | failed | 未完了trace | failed、原因別診断 |
| native環境なし | not-run | 未判定 | 未実行 |
| 負例が期待どおり拒否 | test completed | expected-rejection | negative test PASS、appはblocked |
| unit/kernelのみ一致 | completed | equivalent | native/appは未検証のまま |

## 5. 比較器の設計

MoonBit coreが比較結果・gateを所有する。JSは実engine実行と観測抽出のleafにする。

1. field-level値比較、traceの必要な先後関係、normalized ID対応を別にする。
2. PID、時刻、runtime固有versionは記録するが、生値一致を要求しない。
3. path/URL/origin、例外、同期/非同期、missing/undefined/null、callback回数は意味があるため勝手にnormalizationしない。
4. optional fieldはschemaで宣言し、何でもoptionalにしてmissingを成功させない。
5. comparator自体にwrong version、empty observations、duplicate completion、source drift、stale compiled-core、replayed artifact等の反証fixtureを入れる。
6. normalization変更はversionを上げ、以前のfailed結果を新しく実行せずpassedへ再分類しない。

## 6. CI laneと実行順

| lane | 実行環境 | gate |
| --- | --- | --- |
| docs/schema | portable | local links、schema、matrix/task整合 |
| pure MoonBit | pinned JS/native | lifecycle/IDs/limits/codec policy |
| Node-backed leaves | Node固定Linux/macOS | 現行loader/transport/kernel regression |
| QuickJS native | Linux contract＋macOS native | ABI/roots/modules/jobs/broker、Node不要 |
| macOS WebView | Apple Silicon、WindowServer | actual world/preload/ingress/window/fault |
| Electron oracle | isolated pinned environment | valid baseline、same fixture source |
| app scenarios | disposable macOS user/data | Moji M1-M3と再起動、jmd negative |
| interaction | interactive machine | IME/VoiceOver/focus/DPIの実操作 |
| packaging | clean target OS | no Node/Chromium、signing、install/update/rollback |

CI短縮は独立compile/lintをparallel、同一sourceのcompiled-coreをartifact共有する方式を使う。現在macOS jobがLinux core artifactに依存する理由を保ち、artifact待ちを消すならmacOSが同じpinでnative/JS coreをbuildする設計へ置換する。異なるHEADのartifactをreuseしない。

合格を得るためのskip追加、timeout延長、assert削除を最初の対処にしない。失敗がenvironment/semantic/harnessのどれかを証跡で分類する。

## 7. ローカルとCIで同じ試験入口

既存commandは `moon check --target js`、`moon test --target js`、`moon test --target native`、`npm run build`、`npm test`、`node scripts/macos-probe.cjs`、固定Electronを渡すoracle/differentialである。PR追加commandは0005のexact HEADを確認して使う。

Node-less/new native/app/releaseコマンドは各実装PRで追加し、同じentryをCIから呼ぶ。actrun等のwrapper導入で内容を分岐させない。build-only、fake-host、Linux portabilityをactual macOSと別reportにする。

## 8. 最小回帰セット

1. #8 baseline admission：failed/aborted oracle、wrong source/version、empty/missing semantic data。
2. #6 probe判定：observedがmissing/null/wrong type、未実行candidate、clipboard opt-inなし、NSNull。
3. #9 listener：登録/解除/例外/reentryとrenderer権限非付与。
4. #11/#12 handler：cancel後late result、undefined、one-shot不正request非消費。
5. #2/#10/#13 host：stale navigation、close取消、native loss、attestationとloadのrace。
6. Node-less：Node-free binary/process audit、CJS/ESM/TS区別、QuickJS JSValue解放。
7. apps：boot import閉包、guide readonly、settings、保存先分離、再起動bytes、jmd明示拒否。

## 9. 実装PRと完了条件

1. #8取り込みと#6残存指摘の再現・修正を先行する。
2. versioned evidence schema/required observation policyとCLI表示を追加する。
3. 2つの既存PR stackを同一HEADで全回帰し、compiled artifactのsource SHAを照合する。
4. Node-less/native ingress/app/release laneを各実装の完成に合わせて追加する。
5. branch/OS/profileを跨ぐevidence誤用を負例で拒否する。

完了はinvalid/missing/stale evidenceからverifiedが生成されないこと、各laneが実行対象と未実行を機械可読に出すこと、同じsourceから第三者が主要結果を再生できること。CI greenだけで0001のA-Jを閉じない。

## 10. 出典

1. [main workflow](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/.github/workflows/ci.yml)
2. [main manifest](https://github.com/f4ah6o/electron.mbt/blob/30c6fc97186e7ecfc8397c799525f00c8e4f0f65/compatibility/manifest.json)
3. [PR #5](https://github.com/f4ah6o/electron.mbt/pull/5)、[PR #6 review](https://github.com/f4ah6o/electron.mbt/pull/6#issuecomment-6136804622)、[PR #8](https://github.com/f4ah6o/electron.mbt/pull/8)
4. app固定source/lockfileの出典は [0014](0014-real-app-acceptance.md)。
