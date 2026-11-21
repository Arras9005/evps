/**
 * 假的 VPS 环境（测试和本机预览用）：一个临时目录里放
 * - 假的官方安装脚本：提问部分（ask 函数、三个提问、need_tty）和官方 v2.1.0 逐字一样，后面的安装步骤只是打印同样的行、建几个文件；
 * - 假的 systemctl / journalctl / geto 命令：状态记在临时目录里；
 * - 改过路径的 vps.sh：只把面板目录、下载地址、geto 命令、PATH 指到这个临时目录，其余和发布的一字不差。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVpsScript } from '../server/jobs.ts';

const ASK_FN = `ask() {
    local prompt="$1" default="\${2-}" input
    if [[ -n "$default" ]]; then
        read -rp "$prompt [$default]: " input
        printf '%s' "\${input:-$default}"
    else
        read -rp "$prompt: " input
        printf '%s' "$input"
    fi
}`;

/** 假的官方安装脚本。variant：normal / extra-prompt（多一个提问）/ fail（装到一半失败）/ strict-port（端口不合法会再问一次） */
export function fakeInstallScript(nodeHome, units, variant = 'normal') {
  const extra = variant === 'extra-prompt' ? '    region="$(ask "服务器地区" "hk")"\n' : '';
  const fail = variant === 'fail' ? '    echo -e "${RED}[ERR]${NC} python3 安装失败" >&2; exit 1\n' : '';
  const portCheck = variant === 'strict-port'
    ? '    while true; do port="$(ask "面板端口" "2053")"; [[ "$port" == 1 ]] && break; echo "[WARN] 端口不合法"; done\n'
    : '    port="$(ask "面板端口" "2053")"\n';
  return `#!/usr/bin/env bash
# Geto v2.1.0（测试用的假脚本）
NP_VERSION="2.1.0"
RED='\\033[0;31m'
GREEN='\\033[1;32m'
NC='\\033[0m'
ok()   { sleep "\${EVPS_FAKE_DELAY:-0}"; echo -e "\${GREEN}[OK]\${NC} $*" >&2; }
info() { echo -e "[INFO] $*" >&2; }
need_tty() {
    if [[ ! -t 0 ]]; then
        echo "请使用进程替换运行（不要 curl | bash，否则无法交互）" >&2
        exit 1
    fi
}
${ASK_FN}
unit() { mkdir -p "${units}"; : > "${units}/$1.unit"; echo active > "${units}/$1.active"; echo enabled > "${units}/$1.enabled"; }
do_install() {
    echo "Geto 面板安装 v\${NP_VERSION}"
${portCheck}    user="$(ask "面板用户名" "admin")"
    pass="$(ask "面板密码（回车随机）" "")"
${extra}    sleep 0.2
    echo "Get:1 http://archive.ubuntu.com/ubuntu jammy InRelease [270 kB]"
${fail}    ok "依赖就绪"
    mkdir -p "${nodeHome}/panel" "${nodeHome}/venv/bin" "${nodeHome}/data" "${nodeHome}/meta"
    : > "${nodeHome}/panel/server.py"; printf '#!/bin/sh\\n' > "${nodeHome}/venv/bin/python3"; chmod +x "${nodeHome}/venv/bin/python3"
    : > "${nodeHome}/data/panel.db"
    printf '%s\\n%s\\n%s\\n' "$port" "$user" "$pass" > "${nodeHome}/data/fake-info"
    ok "已从 https://www.geto.im/panel 下载面板文件"
    ok "Python 环境就绪"
    unit np-panel
    ok "面板服务已启动"
    info "正在安装并启动 Xray / Hysteria2（首次需下载，可能稍等）"
    unit xray
    ok "Xray / Hysteria2 已启动"
    echo
    echo "=================================================="
    echo -e "\${GREEN}面板已安装\${NC}"
    echo "  地址   : http://203.0.113.7:\${port}"
    echo "  用户名 : \${user}"
    echo "  密码   : \${pass}"
    echo "=================================================="
    echo "协议请在面板里创建。输入 geto 可查看地址和卸载面板"
}
need_tty
do_install
`;
}

function fakeSystemctl(units) {
  return `#!/bin/bash
U="${units}"
q=0; now=0; args=()
for a in "$@"; do case "$a" in --quiet) q=1 ;; --now) now=1 ;; --no-pager|--value) ;; *) args+=("$a") ;; esac; done
cmd="\${args[0]:-}"; name="\${args[1]:-}"; name="\${name%.service}"
has() { [ -e "$U/$name.unit" ]; }
case "$cmd" in
  cat) has ;;
  is-active) s=$(cat "$U/$name.active" 2>/dev/null || echo inactive); [ "$q" = 1 ] || echo "$s"; [ "$s" = active ] ;;
  is-enabled) s=$(cat "$U/$name.enabled" 2>/dev/null || echo disabled); [ "$q" = 1 ] || echo "$s"; [ "$s" = enabled ] ;;
  disable) has || exit 1; echo disabled > "$U/$name.enabled"; [ "$now" = 1 ] && echo inactive > "$U/$name.active"; exit 0 ;;
  stop) has || exit 1; echo inactive > "$U/$name.active" ;;
  enable) has || exit 1; echo enabled > "$U/$name.enabled" ;;
  restart|start) has || exit 1; echo active > "$U/$name.active" ;;
  *) exit 0 ;;
esac
`;
}

function fakeGeto(nodeHome, units, self) {
  return `#!/bin/bash
IFS= read -r c
if [ "$c" = 0 ]; then
  { read -r port; read -r user; read -r pass; } < "${nodeHome}/data/fake-info"
  echo
  echo "当前 geto 版本：v2.1.0"
  echo "面板地址：http://203.0.113.7:$port"
  echo "用户名：$user"
  echo "密码：$pass"
  echo
  echo "  1) 彻底卸载（面板 / Xray / Hysteria2 / 命令）"
  echo "  0) 退出"
  exit 0
fi
if [ "$c" = 1 ]; then
  IFS= read -r y
  [ "$y" = y ] || exit 0
  echo "正在删除入站..."
  echo "正在停止服务..."
  echo "正在删除 Xray / Hysteria2 / 面板文件..."
  rm -rf "${nodeHome}" "${units}"
  rm -f "${self}"
  echo "Geto 已卸载干净"
fi
`;
}

export function createFakeVps(variant = 'normal') {
  const dir = mkdtempSync(join(tmpdir(), 'evps-fake-vps-'));
  const nodeHome = join(dir, 'geto');
  const units = join(dir, 'units');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const write = (path, text) => { writeFileSync(path, text); chmodSync(path, 0o755); };
  const installPath = join(dir, 'install.sh');
  write(installPath, fakeInstallScript(nodeHome, units, variant));
  write(join(bin, 'systemctl'), fakeSystemctl(units));
  write(join(bin, 'journalctl'), '#!/bin/sh\necho "-- No entries --"\n');
  write(join(bin, 'geto'), fakeGeto(nodeHome, units, join(bin, 'geto')));
  const real = readVpsScript();
  const vpsScript = real
    .replace('NODE_HOME=/usr/local/geto', `NODE_HOME=${nodeHome}`)
    .replace('INSTALL_URL=https://www.geto.im/panel/install.sh', `INSTALL_URL=file://${installPath}`)
    // 真的脚本只许 HTTPS；假服务器用本地文件代替官方脚本，这里放开 file://
    .replace(`--proto '=https' --proto-redir '=https'`, `--proto '=https,file' --proto-redir '=https'`)
    .replaceAll('/usr/local/bin/geto', join(bin, 'geto'))
    .replace('export PATH="/usr/local/sbin:', `export PATH="${bin}:/usr/local/sbin:`);
  for (const needle of [`NODE_HOME=${nodeHome}`, `INSTALL_URL=file://`, `--proto '=https,file'`, `export PATH="${bin}:`]) {
    if (!vpsScript.includes(needle)) throw new Error('vps.sh 的结构变了，假环境替换失败：' + needle);
  }
  return {
    dir,
    nodeHome,
    units,
    vpsScript,
    setVariant: (v) => write(installPath, fakeInstallScript(nodeHome, units, v)),
    unitState: (name) => {
      try {
        return { active: readFileSync(join(units, name + '.active'), 'utf8').trim(), enabled: readFileSync(join(units, name + '.enabled'), 'utf8').trim() };
      } catch {
        return null;
      }
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
