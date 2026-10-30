@echo off
chcp 65001 >nul
cd /d %~dp0
title AI 评论助手

:: 端口默认与 server.js / main.js 一致（27188，原来的 3000 太常见容易被占用）。
:: 要换端口：改这一行，或先 set AI_COMMENT_PORT=xxxxx 再运行本文件。
if "%AI_COMMENT_PORT%"=="" set AI_COMMENT_PORT=27188

echo ================================
echo   🤖 AI 评论助手 启动中...
echo ================================
echo.
echo 正在启动服务器（端口 %AI_COMMENT_PORT%）...
echo 服务就绪后会自动打开浏览器。
echo 停止服务：关闭标题为「AI 评论助手」的最小化窗口（或直接关掉浏览器后重新运行本文件）。
echo.

:: 后台起服务（子进程继承上面的 AI_COMMENT_PORT）
start "" /min cmd /c node server.js

:: 轮询端口，最多等 20 秒（原来先开浏览器会白屏，得手动刷新）
for /l %%i in (1,1,20) do (
  netstat -ano | findstr /C:"127.0.0.1:%AI_COMMENT_PORT%" | findstr /C:"LISTENING" >nul 2>&1
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo [警告] 服务未在 20 秒内就绪，仍尝试打开浏览器，请检查上面的输出。
goto open

:ready
echo 服务已就绪。

:open
start http://127.0.0.1:%AI_COMMENT_PORT%
