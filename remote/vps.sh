#!/bin/bash
# evps 在 VPS 上执行的脚本。由 evps 通过 SSH 送过去执行，用完就删。
# 用法：bash vps.sh <动作>
#   install    下载官方安装脚本并运行；三个提问由 evps 在电脑那边看到提问后再回答
#   status     看面板装没装、各服务是否在运行、登录信息
#   stop       停止面板和协议服务，并取消开机自启
#   start      恢复开机自启，并（重新）启动面板和协议服务
#   uninstall  调用官方自带的卸载（等同于在服务器上输入 geto 选 1）
# 以 "@@EVPS " 开头的行给 evps 程序读，其余的行原样显示给用户看。
set +H
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
INSTALL_URL=https://www.geto.im/panel/install.sh
NODE_HOME=/usr/local/geto
STOPPED_LIST="$NODE_HOME/meta/evps-stopped.list"

mark() { printf '@@EVPS %s\n' "$*"; }
say() { printf '[evps] %s\n' "$*"; }

if [ "$(id -u)" -ne 0 ]; then
  mark NEED_ROOT
  exit 3
fi

installed() {
  [ -f "$NODE_HOME/panel/server.py" ] && [ -x "$NODE_HOME/venv/bin/python3" ] && [ -f "$NODE_HOME/data/panel.db" ]
}

# 面板和协议用到的全部 systemd 服务（官方卸载脚本里列的同一批）
units() {
  local u f
  for u in np-panel xray hysteria-server; do
    if systemctl cat "$u.service" >/dev/null 2>&1; then printf '%s\n' "$u"; fi
  done
  for f in /etc/systemd/system/np-hysteria2-*.service /etc/systemd/system/np-hysteria-*.service; do
    [ -e "$f" ] || continue
    basename "$f" .service
  done
}

# 官方 geto 命令的菜单第一屏就是登录信息；送一个 0 让它看完就退出
login_info() {
  local out
  out=$(printf '0\n' | timeout 60 /usr/local/bin/geto 2>/dev/null | tr -d '\r')
  printf '%s\n' "$out" | sed -n 's/^当前 geto 版本：\(.*\)$/@@EVPS VERSION \1/p' | head -n 1
  printf '%s\n' "$out" | sed -n 's/^面板地址：\(.*\)$/@@EVPS ADDR \1/p' | head -n 1
  printf '%s\n' "$out" | sed -n 's/^域名地址：\(.*\)$/@@EVPS DOMAIN_ADDR \1/p' | head -n 1
  printf '%s\n' "$out" | sed -n 's/^用户名：\(.*\)$/@@EVPS USER \1/p' | head -n 1
  printf '%s\n' "$out" | sed -n 's/^密码：\(.*\)$/@@EVPS PASS \1/p' | head -n 1
}

do_status() {
  if ! installed; then
    mark INSTALLED 0
    return 0
  fi
  mark INSTALLED 1
  [ -f "$STOPPED_LIST" ] && mark STOPPED 1
  local u
  for u in $(units); do
    mark UNIT "$u" "$(systemctl is-active "$u" 2>/dev/null || true)" "$(systemctl is-enabled "$u" 2>/dev/null || true)"
  done
  login_info
}

do_stop() {
  if ! installed; then mark INSTALLED 0; return 0; fi
  local u list=""
  for u in $(units); do
    if [ "$(systemctl is-enabled "$u" 2>/dev/null)" = enabled ] || [ "$u" = np-panel ]; then
      list="$list$u
"
    fi
  done
  # 记下停之前开着自启的服务，启动时原样恢复（没建过协议的 xray 不会被强行拉起来）
  if [ ! -f "$STOPPED_LIST" ]; then
    mkdir -p "$(dirname "$STOPPED_LIST")"
    printf '%s' "$list" > "$STOPPED_LIST"
  fi
  for u in $(units); do
    say "停止 $u"
    systemctl disable --now "$u" >/dev/null 2>&1 || systemctl stop "$u" >/dev/null 2>&1 || true
  done
  if systemctl is-active --quiet np-panel; then
    mark STOP_FAILED
    return 1
  fi
  mark STOPPED_OK
}

do_start() {
  if ! installed; then mark INSTALLED 0; return 0; fi
  local u list
  if [ -f "$STOPPED_LIST" ]; then
    list=$(cat "$STOPPED_LIST")
  else
    list=$(for u in $(units); do
      if [ "$(systemctl is-enabled "$u" 2>/dev/null)" = enabled ] || [ "$u" = np-panel ]; then printf '%s\n' "$u"; fi
    done)
  fi
  for u in $list; do
    systemctl cat "$u.service" >/dev/null 2>&1 || continue
    say "启动 $u"
    systemctl enable "$u" >/dev/null 2>&1 || true
    systemctl restart "$u" >/dev/null 2>&1 || true
  done
  rm -f "$STOPPED_LIST"
  sleep 2
  if systemctl is-active --quiet np-panel; then
    mark STARTED_OK
  else
    journalctl -u np-panel -n 20 --no-pager 2>/dev/null
    mark START_FAILED
    return 1
  fi
}

do_uninstall() {
  if ! installed && [ ! -x /usr/local/bin/geto ]; then
    mark INSTALLED 0
    return 0
  fi
  say "调用官方卸载（geto → 1 彻底卸载）"
  printf '1\ny\n' | timeout 600 /usr/local/bin/geto
  if [ -d "$NODE_HOME" ] || [ -e /usr/local/bin/geto ]; then
    mark UNINSTALL_FAILED
    return 1
  fi
  mark UNINSTALLED_OK
}

ensure_downloader() {
  command -v curl >/dev/null 2>&1 && return 0
  command -v wget >/dev/null 2>&1 && return 0
  say "服务器上没有 curl，正在安装…"
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q curl ca-certificates >/dev/null 2>&1
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q curl ca-certificates >/dev/null 2>&1
  fi
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1
}

do_install() {
  if installed; then
    mark ALREADY
    do_status
    return 2
  fi
  if ! ensure_downloader; then
    mark NO_DOWNLOADER
    return 4
  fi
  local work inst asks reads rc
  work=$(mktemp -d) || return 1
  # 放进新建的目录：官方脚本会在自己所在的目录里找 panel/ 子目录，不能放在 /tmp 根下
  inst="$work/install.sh"
  say "正在下载官方安装脚本 $INSTALL_URL"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 2 --max-time 60 -o "$inst" "$INSTALL_URL" </dev/null
  else
    wget -q -T 60 -O "$inst" "$INSTALL_URL" </dev/null
  fi
  if [ ! -s "$inst" ]; then
    rm -rf "$work"
    mark DOWNLOAD_FAILED
    return 4
  fi
  # 只认识「依次问端口、用户名、密码，此外不再读输入」的官方脚本；变了就不乱填
  asks=$(grep -oE '[^[:alnum:]_]ask "[^"]*"' "$inst" | sed 's/^.//' | tr '\n' '|')
  reads=$(grep -cE '(^|[^[:alnum:]_])read([[:space:]]|$)' "$inst")
  if ! grep -q 'NP_VERSION=' "$inst" || [ "$asks" != 'ask "面板端口"|ask "面板用户名"|ask "面板密码（回车随机）"|' ] || [ "$reads" != 2 ]; then
    rm -rf "$work"
    mark PROMPT_CHANGED
    return 5
  fi
  mark INSTALL_START "$(sed -n 's/^NP_VERSION="\([0-9.]*\)"$/\1/p' "$inst" | head -n 1)"
  export DEBIAN_FRONTEND=noninteractive
  bash "$inst"
  rc=$?
  rm -rf "$work"
  mark INSTALL_RC "$rc"
  return "$rc"
}

case "${1:-}" in
  install) do_install ;;
  status) do_status ;;
  stop) do_stop ;;
  start) do_start ;;
  uninstall) do_uninstall ;;
  *) mark BAD_ACTION; exit 64 ;;
esac
