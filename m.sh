#!/bin/sh
# evps 启动脚本（Mac / Linux）。在「终端」里粘贴：
#   curl -fsSL https://registry.npmmirror.com/@zhangbo9005/easy-vps/latest/files/m.sh | sh
#
# 它做的事：
# 1. 电脑上有 Node.js 18 以上，就直接用；
# 2. 没有，就下载 Node.js 官方的便携版到 ~/.evps/node（核对 SHA256；不装进系统、不改系统设置、不要管理员密码）；
# 3. 用 npx 运行 evps（不运行任何第三方安装脚本），浏览器会自动打开。
# 用完点网页上的「清理本机文件」，~/.evps 整个删掉，电脑上不留东西。
#
# 整个脚本包在 main 里：用 curl | sh 运行时，sh 读完全部内容才开始执行。

main() {
  set -u
  BASE="${EVPS_HOME:-$HOME/.evps}"
  PKG="${EVPS_PACKAGE:-@zhangbo9005/easy-vps@latest}"

  say() { printf '%s\n' "$*"; }
  die() { printf '\n%s\n' "$*" >&2; exit 1; }

  say ""
  say "evps：在浏览器里给 VPS 一键安装面板"
  say "正在准备运行环境…"

  command -v curl >/dev/null 2>&1 || die "这台电脑没有 curl，无法继续。"
  mkdir -p "$BASE" || die "无法创建目录 $BASE"

  NODE_BIN=""
  if command -v node >/dev/null 2>&1 && command -v npx >/dev/null 2>&1 && [ -z "${EVPS_FORCE_PORTABLE:-}" ]; then
    major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
    if [ "${major:-0}" -ge 18 ] 2>/dev/null; then
      NODE_BIN="$(dirname "$(command -v node)")"
      say "已找到 Node.js $(node -v)，直接使用。"
    fi
  fi

  if [ -z "$NODE_BIN" ]; then
    os=$(uname -s)
    case "$(uname -m)" in
      x86_64|amd64) arch=x64 ;;
      arm64|aarch64) arch=arm64 ;;
      *) die "不支持这种电脑（$(uname -m)）。" ;;
    esac
    # Node 24 要求 macOS 13.5 以上；macOS 11 到 13.4 用 Node 22
    ver=v24.22.3
    case "$os" in
      Darwin)
        plat=darwin
        mv=$(sw_vers -productVersion 2>/dev/null || echo 0)
        mj=$(printf '%s' "$mv" | cut -d. -f1)
        mn=$(printf '%s' "$mv" | cut -d. -f2)
        [ -n "$mn" ] || mn=0
        if [ "$mj" -lt 11 ] 2>/dev/null; then die "macOS 版本太旧（$mv），需要 macOS 11 或更新。"; fi
        if [ "$mj" -lt 13 ] || { [ "$mj" -eq 13 ] && [ "$mn" -lt 5 ]; }; then ver=v22.23.5; fi
        ;;
      Linux) plat=linux ;;
      *) die "不支持这个系统（$os）。Windows 请用 PowerShell 那一行命令。" ;;
    esac
    file="node-$ver-$plat-$arch.tar.gz"
    # 官方 SHASUMS256.txt 里的值（官网和国内镜像核对过一致）
    case "$file" in
      node-v24.22.3-darwin-arm64.tar.gz) sum=ff6e17d4874b76d272212b908cc020d6e815fba5a6c7eaaa06add725840307fd ;;
      node-v24.22.3-darwin-x64.tar.gz) sum=977614af0504c81045e7fd85596dbca0e5f951b96681516dadafedcca8c447f7 ;;
      node-v24.22.3-linux-arm64.tar.gz) sum=261af2af250dfd7e9f25cf151d1b2713a0adf8f10a9ad116c4947f68627affe8 ;;
      node-v24.22.3-linux-x64.tar.gz) sum=061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2 ;;
      node-v22.23.5-darwin-arm64.tar.gz) sum=e7131995759b61a0170b646010d2ad35a5d37b4cb0d471f3e8317eac6f742f3d ;;
      node-v22.23.5-darwin-x64.tar.gz) sum=c53383238206b9ae4db23c5d8a63645e2e753bec8ab51a49cc81939aa64e9422 ;;
      *) die "没有 $file 的校验值。" ;;
    esac
    dir="$BASE/node/${file%.tar.gz}"
    if [ ! -x "$dir/bin/node" ] || ! "$dir/bin/node" -v >/dev/null 2>&1; then
      say "第一次使用，正在下载 Node.js 便携版（约 50MB，只放在 $BASE 里）…"
      tmp="$BASE/node/$file.part"
      mkdir -p "$BASE/node"
      ok=""
      for url in "https://npmmirror.com/mirrors/node/$ver/$file" "https://nodejs.org/dist/$ver/$file"; do
        if curl -fL --retry 2 --connect-timeout 15 --progress-bar -o "$tmp" "$url"; then ok=1; break; fi
      done
      [ -n "$ok" ] || die "下载 Node.js 失败，请检查网络后重试。"
      if command -v shasum >/dev/null 2>&1; then got=$(shasum -a 256 "$tmp" | cut -d' ' -f1); else got=$(sha256sum "$tmp" | cut -d' ' -f1); fi
      if [ "$got" != "$sum" ]; then rm -f "$tmp"; die "下载的 Node.js 校验不对（可能被篡改或下载不完整），已删除。请重试。"; fi
      rm -rf "$dir"
      tar -xzf "$tmp" -C "$BASE/node" || die "解压 Node.js 失败。"
      rm -f "$tmp"
    fi
    NODE_BIN="$dir/bin"
  fi

  # 选一个能连上的 npm 源：国内镜像优先
  registry=https://registry.npmmirror.com
  if ! curl -fs --max-time 8 -o /dev/null "$registry/@zhangbo9005/easy-vps"; then registry=https://registry.npmjs.org; fi

  say "正在启动 evps（第一次要下载一会儿）…"
  rm -f "$BASE/cleanup-requested"
  PATH="$NODE_BIN:$PATH" \
  EVPS_BOOTSTRAP=1 EVPS_HOME="$BASE" \
  npm_config_cache="$BASE/npm-cache" npm_config_registry="$registry" npm_config_ignore_scripts=true \
  npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false npm_config_loglevel=error \
    "$NODE_BIN/npx" -y --package="$PKG" evps </dev/null
  rc=$?

  if [ -f "$BASE/cleanup-requested" ]; then
    rm -rf "$BASE"
    say "已删除 $BASE，这台电脑上没有留下 evps 的文件。"
  fi
  return $rc
}

main "$@"
