# File broker (partial)

Status: **partial**. The native app handler now executes bounded read/save/image
operations for the adapted profile. Dialogs, export, `openLocalPath` and Moji's
real file handlers are not implemented.

## Policy

- A path is resolved against the app root, standardized and symlink-resolved.
  It must remain under the resolved app root; absolute paths outside the root,
  `..` escapes and symlink escapes are rejected.
- Reads require a read grant for the exact path or a parent-directory grant.
  `samples/*` is the only ungranted read-only area.
- Writes require a write grant for the exact path or a parent-directory grant.
  Writes are atomic (`writeToFile:atomically:YES`) and do not create parent
  directories.
- Grants are mode bits (`read`, `write`, `readwrite`). The current grant source
  is the **test-only** `grant-file` control operation. Production grants must
  come from the open/save dialogs, which are not implemented yet.
- Bounds: read text 1 MiB, image 1 MiB (png/jpeg/gif/webp), save content 64 KiB
  (also bounded by the 64 KiB ingress payload envelope). The page receives JSON
  values, never native file handles.
- The broker runs in the native host before the QuickJS Main dispatch. `file:*`
  operations do not reach Main; `doc:*` and `diagram:*` fail closed with
  `ELECTRON_MBT_FILE_NOT_IMPLEMENTED`.
- `file:read-path` returns `{path, text, bytes}`; `file:save` returns
  `{path, bytes}`; `file:read-image` returns `{path, dataUrl, bytes}`. These are
  adapted-profile values, not Moji's main handler document shape.

## Evidence

The native supervisor grants `broker-output.txt` (`readwrite`) with the
test-only operation, then the page:

1. reads `samples/sample.md` and checks the exact text;
2. saves `broker-output.txt` = `broker-write` and checks 12 bytes;
3. rereads `broker-output.txt` and checks the content;
4. is denied writing ungranted `broker-denied.txt`
   (`ELECTRON_MBT_FILE_DENIED`);
5. is denied reading `../escape.md`.

The supervisor reports `fileBroker:true`, `fileRead:true`, `fileSave:true`,
`fileDenied:true`, `nativeIngressAdmitted:15`, `nativeIngressDenied:4`, and
removes `broker-output.txt` after the probe.

## Deliberate limits

- `grant-file` is a test-only control lane, not a production user consent path
- no `NSOpenPanel` / `NSSavePanel`, no dialog-granted paths, no directory
  picker
- no `file:open-local-path`, `file:open-dialog`, `file:save-as`,
  `doc:export` or `diagram:export-png`
- samples are read from the app root, not the source snapshot; the source
  manifest does not cover them
- save content is capped by the ingress envelope (64 KiB), not a general large
  document writer
- grants are path-based and persist for the window lifetime; no per-document
  revocation or user-visible grant list yet
- no Moji main handler, no Moji file service and no app scenario
- `compatible:false`, adapted **partial** and strict **blocked** are unchanged

## Next

1. open/save dialogs with real user grants (NSOpenPanel/NSSavePanel)
2. export through a save panel, including PNG diagram export
3. `openLocalPath` with an explicit local-file policy
4. Moji main/preload boot and a file read/save app scenario
