# Launcher Bugs

This folder tracks launcher-only issues separately from Tavo/player work.

## BUG-LAUNCHER-039: Generated multivoice hero asset is not wired into the live launcher header

Status: fixed and visually confirmed in real launcher window

Reported: 2026-06-07

Boundary: launcher / visual assets

Repro: Generate `launcher/leon-launcher-hero-multivoice.png` and open the launcher. The window still shows the plain dark header because the active form builder never references the new asset.

Evidence: The worktree had the generated PNG as an untracked launcher asset, but the old PowerShell launcher only defined the older `leon-launcher-banner-avatar-ai.png` path and the final active `Build-LauncherForm` painted the header with a solid background. Earlier `Build-LauncherForm` definitions either are superseded or contain disabled banner code.

Root cause: The asset generation step stopped before the script wiring step. The final PowerShell function definition at the bottom of the file overrides earlier versions, so changing or inspecting the older banner block would not affect the real launcher.

Fix: The old PowerShell launcher defined `HeroPath`, loaded `leon-launcher-hero-multivoice.png` into the current header background, kept title/subtitle labels transparent over the banner, and disposed the loaded image on form close. A real WinForms screenshot confirmed the banner rendered behind the title without covering the sidebar or log area.

Guard: Future launcher visual changes must target the last active `Build-LauncherForm` definition unless the duplicate historical definitions are intentionally cleaned up. Project-referenced launcher assets must be committed under `launcher/` and actually referenced by the live form builder.

## BUG-LAUNCHER-038: Home logs show mojibake and do not default to the newest line

Status: fixed in script, visually confirmed for home launcher log display; fresh startup stdout/stderr still needs confirmation after the next real service restart

Reported: 2026-06-07

Repro: Open the launcher home log view after starting the service. Some Chinese log text renders as mojibake, and the visible log area often stops slightly above the newest line so the user has to scroll down manually.

Evidence: User report: "启动器现在显示的日志有乱码" and "日志列应该默认焦点是最后一行，现在老是要下滑一下才看到最后一行". Code evidence: the launcher started `cmd.exe /c <bat>` without forcing UTF-8, startup scripts did not set `chcp 65001` / Python UTF-8 mode, `Read-LauncherLogTail()` only tried strict UTF-8 then the process default ANSI encoding, and log tab refresh depended on `ScrollToCaret()` immediately after text assignment.

Root cause: Startup stdout/stderr could be produced under the console default code page while the launcher decoded it as UTF-8 or system ANSI only. Existing logs written in GBK/GB18030 were not reliably decoded on every Windows locale. The log text box also did not schedule a post-layout scroll, so WinForms could leave the scrollbar slightly above the end after refresh or resize.

Fix: The old PowerShell launcher set the launcher console/output encoding to UTF-8, started service BAT files through `cmd /d /s /c chcp 65001`, passed `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` during startup, read log files with shared access, and scored UTF-8 / GB18030 / GBK / system-default decodes before normalizing. Follow-up fix: launcher local API JSON calls used an explicit UTF-8 byte decode helper instead of `Invoke-RestMethod`, because Windows PowerShell can misdecode UTF-8 JSON without charset; display normalization also repaired existing Latin-1-shaped UTF-8 mojibake runs such as `ä¸ª...` without rewriting historical log files. The home log RichTextBox used a shared scroll helper that moved the caret to `TextLength` immediately and again after layout via `BeginInvoke`.

Guard: Starting from the launcher should generate UTF-8 Python logs. Old GBK/GB18030 logs should still display readable Chinese where possible. Switching log tabs, refreshing logs, opening home, and resizing the launcher should leave the active log view at the newest line unless the user is actively selecting text in the same tab.

## BUG-LAUNCHER-031: Launcher UI is overbuilt, noisy, and auto-checks environment on open

Status: fixed in script, needs visual confirmation in real launcher window

Reported: 2026-06-06

Repro: Open `LEON-Launcher.exe`. The launcher immediately runs environment detection, the header/banner overlaps visually, log pages auto-scroll/jump with folded text, and the sidebar exposes too many pages/actions including a separate `停止服务` button.

Evidence: User screenshots show the banner/header text competing with the image and progress bar, log text clipped/folded, and a crowded sidebar. Follow-up screenshots showed stacked log boxes looked like clipped CMD windows, content pages repeated the same title as the selected nav item, the left nav had no active state, and an intermediate layout pushed the primary start button below the visible window. User also clarified that clicking `环境检测` should only enter the page; detection must start from a separate page button.

Root cause: The launcher accumulated diagnostics, logs, voice testing, WebUI, and Tavo instructions into one WinForms shell. Opening the form also triggered environment checks and extra refresh actions. The simplified rewrite still had layout issues: bottom controls were positioned by raw sidebar client height, so the start button could fall outside the visible area; the environment nav directly called `Run-EnvironmentCheck`; and content pages duplicated nav labels as large headings.

Fix: The old PowerShell launcher built a simplified launcher surface with a full-width top header and a separate body area. The body contained the left control column and a right content panel, so the sidebar no longer cut into the header. Opening the launcher no longer ran environment detection; it only checked cheap `/health` to set the start/stop state. The primary service button was inside a fixed `Dock=Bottom` left-bottom panel, with the compact version/ratio row directly above it, so it did not disappear on smaller windows. The version control became a dark segmented `vLLM` / `6G` switch instead of a white dropdown; the `0.15` ratio input was dark, centered, only visible for `vLLM`, and had a hover tooltip explaining the vLLM GPU memory ratio. The left nav exposed only `首页` and `环境检测` and had active-state colors. `环境检测` only showed the page and preloaded rows as `待检测`; the page-level `开始检测` button ran checks, and `一键修复` was a second page-level action beside it. Content panels no longer repeated large page titles. Environment results used a dark `DataGridView` with quiet headers and no harsh white `ListView` header.

Guard: Opening the launcher must not run `Run-EnvironmentCheck` automatically. The visible UI should only expose service start/stop, service version/vLLM ratio, environment detection, and one-click repair. The left-bottom start/stop button must remain visible at the default `1120x760` window and at the minimum window size. Environment results should use quiet dark styling with no white table header, no harsh grid lines, no top tab strip, and no auto-scrolling diagnostic page. The sidebar `环境检测` nav must not execute detection; only the page-level `开始检测` button may run it. One-click repair belongs inside the environment page, not as a duplicate sidebar page.

Validation: Legacy PowerShell parser and smoke checks passed at the time. Current active launcher validation should use root `LEON-Launcher.exe` smoke mode.

## BUG-LAUNCHER-037: One-click repair reruns environment detection

Status: fixed in script, needs visual confirmation in real launcher window

Reported: 2026-06-07

Repro: Click `一键修复` before or after `开始检测`. The repair action clears the environment table and runs its own SVML / VS / CUDA / ninja probes instead of using the visible check result that the user just generated.

Evidence: User report: "你的一键修复为毛和开始检测没有联动的？ 又重复检测一次". Code evidence: `Repair-Environment` called `Initialize-EnvironmentCheckRows`, then called probe helpers such as `Test-SvmlRepairNeeded`, `Get-VsInstallPath`, `Get-CudaToolkitPath`, and a runtime ninja import check.

Root cause: The launcher kept environment check rows only as UI controls. There was no structured "latest completed check" state, so the repair path re-detected state and refreshed the table by itself.

Fix: The old PowerShell launcher stored structured environment results in `$Script:EnvCheckResults` while `Run-EnvironmentCheck` was running, marked `$Script:EnvCheckCompleted` only after the check finished, and made `Repair-Environment` read that result set. If no completed check existed, `一键修复` showed `先点开始检测，再点一键修复。` in the current table and returned. It no longer cleared the table or ran fresh SVML / VS / CUDA / ninja detection. Version switching reset the stored check because the old result belonged to a different service version; simply entering the `环境检测` page preserved the current visible result.

Guard: `一键修复` must not call `Run-EnvironmentCheck`, must not call `Initialize-EnvironmentCheckRows`, and must not perform new detection probes before deciding what to repair. It may only update rows backed by the latest completed `开始检测` result. Without a completed check, it should keep existing `待检测` rows, keep progress at `0`, log that repair was cancelled, and ask the user to run `开始检测` first.

## BUG-LAUNCHER-035: Home log tab buttons render but cannot switch sources

Status: fixed in script, needs visual confirmation in real launcher window

Reported: 2026-06-06

Repro: Open the launcher home page and click the four log tabs. The buttons are visible, but the selected log source does not reliably change.

Evidence: User screenshot/report: "没法切换". Code evidence: the last active `Build-LauncherForm` creates log buttons with `Add_Click({ Set-LogTabActive $Key })`, which depends on a nested PowerShell closure variable instead of the clicked sender.

Root cause: The log button click handler depended on a nested PowerShell closure variable. Depending on how the scriptblock was bound, the handler could miss the intended key instead of reading the clicked button source.

Fix: `Add-LogButton` now stores the source key in the button `Tag` and calls `Set-LogTabActive ([string]$sender.Tag)` from the event sender. A `MouseDown` path uses the same sender tag, so normal clicks and mouse-down selection hit the same control flow.

Guard: Log tab buttons must bind their source key through the button `Tag` or event sender, not through a captured loop/local variable. A smoke probe should click all four buttons and confirm `$Script:ActiveLogTab` changes to `launcher`, `api`, `stdout`, and `stderr`.

## BUG-LAUNCHER-036: One-click repair page reuses the environment check layout

Status: fixed in script, needs visual confirmation in real launcher window

Reported: 2026-06-06

Repro: Click `一键修复` in the launcher sidebar. The page looks and behaves like the environment detection table instead of a distinct repair action page.

Evidence: User report: "一键修复页面 为什么 长得完全一样". Code evidence: `Repair-Environment` calls `Show-EnvironmentPanel "repair"` and then updates the same progress/table controls used by environment detection.

Root cause: `一键修复` was treated as a separate navigation page even though it shares the same narrow purpose as environment detection. That made it either duplicate the environment page or look empty after trying to make it distinct.

Fix: The separate `一键修复` sidebar entry was removed. The environment page now has two explicit page-level actions at the top: `开始检测` and `一键修复`. Entering `环境检测` still does not start any check or repair; the user chooses the action.

Guard: `一键修复` should remain a page-level action inside `环境检测`, not a separate sidebar destination. Entering the environment page must not execute detection or repair work until the corresponding page-level button is clicked.

## BUG-LAUNCHER-034: Home logs are mixed together and hard to scan

Status: fixed in script, needs visual confirmation in real launcher window

Reported: 2026-06-06

Repro: Open the launcher home/log page. Launcher logs, service runtime logs, stdout, and stderr were previously concatenated into one large text box, making it hard to tell which layer produced a line.

Evidence: User asked for a left-side home link, home should show logs, and logs should not be concatenated together. Follow-up screenshot showed four stacked log areas looked like ugly clipped CMD windows. A later native `TabControl` attempt rendered as large grey blocks with missing tab text, so the tab control itself was also not acceptable.

Root cause: `Refresh-BackendLogTail()` built one combined string from launcher log files, `/server_log/tail`, startup stdout, and startup stderr. `Add-Log()` also wrote to the same generic log box when present.

Fix: The new launcher home page uses four explicit dark buttons as a tab strip: `启动器`, `服务日志`, `服务启动`, and `诊断日志`. Below them is one large log text box; switching buttons changes which separated log source is shown. `服务日志` is `/server_log/tail` service runtime log, `服务启动` is the service process stdout startup log, and `诊断日志` is stderr/warnings/progress/traceback output. This avoids stacked clipped log boxes, native `TabControl` grey blocks with missing text, and misleading "错误输出" wording. `Add-Log()` writes into the launcher log source. `Refresh-BackendLogTail()` refreshes each service/startup log source separately and no longer prepends launcher logs into service output.

Guard: Home must be reachable through `首页`. Launcher logs, service runtime logs, service startup stdout, and diagnostic stderr must remain separate tab-button sources. Refreshing service logs must not mix launcher log lines into the service/stdout/stderr areas. Do not call stderr "错误输出"; it is a diagnostic stream and can contain warnings, progress bars, or normal library chatter. Do not use native WinForms `TabControl` for this log strip unless it is visually verified to show readable labels and not render as grey blocks.

Validation: Legacy PowerShell parser and smoke checks passed at the time. Current active launcher validation should use root `LEON-Launcher.exe` smoke mode.

## BUG-LAUNCHER-032: vLLM ratio must be visible and user-editable

Status: fixed in script, needs visual confirmation in real launcher window

Reported: 2026-06-06

Repro: Start vLLM through the launcher and call `/health`. The response identifies `version=vllm` but must also show which `gpu_memory_utilization` ratio is active. The launcher ratio control should be a direct editable value, not a fixed dropdown.

Evidence: User requested `/health` to print the current ratio parameter and asked the launcher ratio control to be directly hand-editable with default `0.15`.

Root cause: The ratio was passed into startup but not surfaced in `/health`. Defaults also remained inconsistent: some paths still fell back to `0.18`, while recent runtime benchmarks favored `0.15` as the speed preset and `0.11` as conservative.

Fix: The old PowerShell launcher defaulted to `0.15`, used a directly editable compact centered text box for the vLLM ratio, and applied the typed value before service startup. The version selector was a two-button segmented switch (`vLLM` / `6G`) in the same bottom-left row above the start button. The ratio box was visible only when `vLLM` was selected; selecting `6G` hid the ratio box. Existing backend changes also expose `vllm_gpu_memory_utilization` and `vllm_enforce_eager` in `/health`.

Guard: vLLM `/health` should include `vllm_gpu_memory_utilization` and `vllm_enforce_eager`. The launcher ratio control should accept direct typed numeric input, default to `0.15`, center the short value, and pass the same value through `INDEXTTS_VLLM_GPU_MEMORY_UTILIZATION`. Do not use a white ComboBox/dropdown for the two-version selector. The ratio help text must not consume vertical sidebar space.

Validation: Current `/health` during runtime returned `vllm_gpu_memory_utilization=0.15` and `vllm_enforce_eager=true`. Legacy PowerShell parse and smoke tests passed at the time; current active launcher validation should use root `LEON-Launcher.exe` smoke mode.
