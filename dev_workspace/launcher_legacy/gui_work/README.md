# LEON Launcher GUI Work Area

This folder is the temporary working area for `Leon_api/环境检查/LEON启动器.ps1` GUI and launcher-lifecycle iteration.

Keep launcher GUI notes, local validation checklists, screenshots, and work logs here instead of adding new entries to `Leon_api/docs/`.

Rules:

- Edit the actual launcher in `../LEON启动器.ps1`.
- Keep user-facing launcher usage notes in `../README.md` short.
- Do not use this folder for Tavo runtime/player work.
- Do not start the real launcher just for smoke checks if the user may have a launcher window open.
- Use `LEON_LAUNCHER_SMOKE_TEST=1` for non-interactive validation.

Useful checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$errs=$null; $tokens=$null; [System.Management.Automation.Language.Parser]::ParseFile("D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\LEON启动器.ps1",[ref]$tokens,[ref]$errs) | Out-Null; if($errs){ $errs | Format-List *; exit 1 } else { "launcher parser OK" }'
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '$env:LEON_LAUNCHER_SMOKE_TEST="1"; & "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查\LEON启动器.ps1"'
```
