# evps 启动脚本（Windows 10 / 11）。按 Win+R，输入 powershell 回车，在蓝色窗口里粘贴 README 里的那一行命令。
#
# 它做的事：
# 1. 电脑上有 Node.js 18 以上，就直接用；
# 2. 没有，就下载 Node.js 官方的便携版到 %LOCALAPPDATA%\evps\node（核对 SHA256；不装进系统、不改系统设置、不要管理员权限）；
# 3. 用 npx 运行 evps（不运行任何第三方安装脚本），浏览器会自动打开。
# 用完点网页上的「清理本机文件」，%LOCALAPPDATA%\evps 整个删掉，电脑上不留东西。
#
# 这个脚本是用 iex 在你当前的窗口里执行的：里面不用 exit（会把窗口关掉），出错用 return。

function Start-Evps {
  $ErrorActionPreference = 'Stop'
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch {}

  if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or [Environment]::OSVersion.Version.Major -lt 10) {
    Write-Host '这个脚本给 Windows 10 / 11 用。Mac 请用「终端」里的那一行命令。' -ForegroundColor Red
    return
  }
  $base = if ($env:EVPS_HOME) { $env:EVPS_HOME } else { Join-Path $env:LOCALAPPDATA 'evps' }
  $pkg = if ($env:EVPS_PACKAGE) { $env:EVPS_PACKAGE } else { '@zhangbo9005/easy-vps@latest' }

  function Say([string]$text) { Write-Host $text }
  function Fail([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Red }

  Say ''
  Say 'evps：在浏览器里给 VPS 一键安装面板'
  Say '正在准备运行环境…'

  New-Item -ItemType Directory -Force -Path $base | Out-Null

  $nodeExe = $null
  $npxCli = $null
  $sysNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($sysNode -and -not $env:EVPS_FORCE_PORTABLE) {
    try {
      $major = [int](& $sysNode.Source -p 'process.versions.node.split(".")[0]')
      $cli = Join-Path (Split-Path $sysNode.Source) 'node_modules\npm\bin\npx-cli.js'
      if ($major -ge 18 -and (Test-Path $cli)) {
        $nodeExe = $sysNode.Source
        $npxCli = $cli
        Say ("已找到 Node.js " + (& $nodeExe -v) + "，直接使用。")
      }
    } catch {}
  }

  if (-not $nodeExe) {
    $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $arch = switch ($cpu) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { $null } }
    if (-not $arch) { Fail "不支持这种电脑（$cpu）。需要 64 位的 Windows。"; return }
    $ver = 'v24.22.3'
    $file = "node-$ver-win-$arch.zip"
    # 官方 SHASUMS256.txt 里的值（官网和国内镜像核对过一致）
    $sums = @{
      'node-v24.22.3-win-x64.zip'   = 'e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f'
      'node-v24.22.3-win-arm64.zip' = 'b3cc74a295b39d4f273271e96f58c06dd2b35757ca12abec64c7d0598b434f14'
    }
    $nodeRoot = Join-Path $base 'node'
    $dir = Join-Path $nodeRoot ($file -replace '\.zip$', '')
    $exe = Join-Path $dir 'node.exe'
    $ready = $false
    if (Test-Path $exe) { try { & $exe -v | Out-Null; $ready = $true } catch {} }
    if (-not $ready) {
      Say "第一次使用，正在下载 Node.js 便携版（约 35MB，只放在 $base 里），请稍等…"
      New-Item -ItemType Directory -Force -Path $nodeRoot | Out-Null
      $zip = Join-Path $nodeRoot "$file.part"
      $ok = $false
      foreach ($url in @("https://npmmirror.com/mirrors/node/$ver/$file", "https://nodejs.org/dist/$ver/$file")) {
        try { (New-Object Net.WebClient).DownloadFile($url, $zip); $ok = $true; break } catch {}
      }
      if (-not $ok) { Fail '下载 Node.js 失败，请检查网络后重试。'; return }
      $got = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
      if ($got -ne $sums[$file]) {
        Remove-Item -Force $zip
        Fail '下载的 Node.js 校验不对（可能被篡改或下载不完整），已删除。请重试。'
        return
      }
      if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
      Say '正在解压…'
      # Windows 10 1803 起自带 tar，比 Expand-Archive 快得多（npm 有几千个小文件）；不行再用 Expand-Archive
      $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
      $extracted = $false
      if (Test-Path $tar) {
        # 不要写 2>$null：Windows PowerShell 5.1 会把外部程序的错误输出变成「终止错误」
        try { & $tar -xf $zip -C $nodeRoot; $extracted = ($LASTEXITCODE -eq 0) -and (Test-Path $exe) } catch { $extracted = $false }
      }
      if (-not $extracted) {
        if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
        Expand-Archive -Path $zip -DestinationPath $nodeRoot -Force
      }
      Remove-Item -Force $zip
      if (-not (Test-Path $exe)) { Fail '解压 Node.js 失败。'; return }
    }
    $nodeExe = $exe
    $npxCli = Join-Path $dir 'node_modules\npm\bin\npx-cli.js'
  }

  # 选一个能连上的 npm 源：国内镜像优先
  $registry = 'https://registry.npmmirror.com'
  try {
    $req = [Net.WebRequest]::Create("$registry/@zhangbo9005/easy-vps"); $req.Timeout = 8000
    $req.GetResponse().Close()
  } catch { $registry = 'https://registry.npmjs.org' }

  Say '正在启动 evps（第一次要下载一会儿）…'
  $flag = Join-Path $base 'cleanup-requested'
  if (Test-Path $flag) { Remove-Item -Force $flag }
  $env:PATH = (Split-Path $nodeExe) + ';' + $env:PATH
  $env:EVPS_BOOTSTRAP = '1'
  $env:EVPS_HOME = $base
  $env:npm_config_cache = Join-Path $base 'npm-cache'
  $env:npm_config_registry = $registry
  $env:npm_config_ignore_scripts = 'true'
  $env:npm_config_fund = 'false'
  $env:npm_config_audit = 'false'
  $env:npm_config_update_notifier = 'false'
  $env:npm_config_loglevel = 'error'
  & $nodeExe $npxCli -y "--package=$pkg" evps

  if (Test-Path $flag) {
    # 刚退出的 node.exe 可能还没完全放开文件，稍等再删
    Start-Sleep -Seconds 1
    try {
      Remove-Item -Recurse -Force $base
      Say "已删除 $base，这台电脑上没有留下 evps 的文件。"
    } catch {
      Say "有些文件正被占用，没删干净。可以手动删除这个文件夹：$base"
    }
  }
}

Start-Evps
