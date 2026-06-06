# 我的工作流程 - 强制准则

## ⚠️ 绝对规则（必须遵守）

### 1. 修改文件后的流程

当修改 `LEON启动器.ps1` 后：

```bash
# 第一步：关闭旧进程
taskkill /F /IM powershell.exe /FI "MEMUSAGE gt 50000"

# 第二步：启动测试（后台运行）
cd "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查"
powershell -NoProfile -ExecutionPolicy Bypass -File "LEON启动器.ps1" &

# 第三步：等待3秒后截图
sleep 3
# 截图给用户看效果
```

### 2. 禁止的行为

❌ **绝对不要**说"现在你可以打开看看"  
❌ **绝对不要**说"关掉旧的重新打开"  
❌ **绝对不要**让用户自己测试  
❌ **绝对不要**创建新文件（v2、现代版等）不覆盖主文件

### 3. 必须的行为

✅ **必须**每次改完立即自己启动测试  
✅ **必须**确认能正常显示后才告诉用户  
✅ **必须**遇到错误立刻修复，不要让用户发现  
✅ **必须**只修改 `LEON启动器.ps1`，因为 EXE 只调用这个文件

### 4. 完整工作流程

```
用户要求改界面
    ↓
备份旧文件
    ↓
修改 LEON启动器.ps1
    ↓
【关键】立即自己启动测试
    ↓
检查界面是否正常
    ↓
如果有问题 → 立即修复 → 重新测试
    ↓
界面正常 → 截图 → 给用户看效果
    ↓
完成
```

## 示例脚本

```bash
# 完整测试流程（一键执行）
cd "D:\apiWorkSpace\index-tts2-vLLM\Leon_api\环境检查"

# 1. 备份
cp LEON启动器.ps1 "LEON启动器-backup-$(date +%Y%m%d-%H%M%S).ps1"

# 2. 修改文件
# ... 进行修改 ...

# 3. 关闭旧进程
taskkill /F /IM powershell.exe /FI "MEMUSAGE gt 50000" 2>&1

# 4. 启动测试
powershell -NoProfile -ExecutionPolicy Bypass -File "LEON启动器.ps1" &

# 5. 等待窗口出现
sleep 3

# 6. 截图（如果有工具）或手动检查
```

## 记住

**用户双击 EXE → EXE 调用 `LEON启动器.ps1` → 显示界面**

所以：
- 改别的文件没用
- 必须改 `LEON启动器.ps1`
- 改完必须自己测试
- 不要让用户去测试

