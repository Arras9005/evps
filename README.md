# evps

在自己电脑的**浏览器**里，给自己的 VPS 一键安装 [Geto 面板](https://www.geto.im)，装好后还能在同一个网页里**查看、停止、重启、卸载**。

- 不用会命令行：打开黑窗口粘贴一行命令，之后全在网页里点。
- 不用先装任何东西：电脑上没有 Node.js，会自动下载官方便携版，放在一个文件夹里，用完可以一键删掉。
- **SSH 密码只在你自己的电脑上使用**：直接用来登录你的 VPS，不保存、不经过任何第三方服务器。代码全部公开，可以自己检查。

> evps 是开源的**非官方**工具，和 Geto 面板的作者没有关系。它只是替你登录 VPS、运行官方的安装脚本，并自动回答安装时的三个提问。

## 怎么用

### Windows 10 / 11

按 `Win + R`，输入 `powershell` 回车，在打开的蓝色窗口里粘贴下面这一行，回车：

```powershell
[Net.ServicePointManager]::SecurityProtocol=3072;$s=$null;foreach($u in 'https://registry.npmmirror.com/evps/latest/files/w.ps1','https://cdn.jsdelivr.net/npm/evps@latest/w.ps1'){try{$s=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData($u));break}catch{}};iex $s
```

### Mac

打开「终端」（启动台里搜索「终端」），粘贴下面这一行，回车：

```sh
(curl -fsSL https://registry.npmmirror.com/evps/latest/files/m.sh || curl -fsSL https://cdn.jsdelivr.net/npm/evps@latest/m.sh) | sh
```

### 已经装了 Node.js 18 以上

```sh
npx evps
```

浏览器会自动打开 evps 的网页。**用完之前不要关掉黑窗口**；用完在网页底部点「退出」，或者「清理本机文件」（连下载的运行环境一起删掉）。

## 网页里能做什么

| 按钮 | 做什么 |
|---|---|
| 安装面板 | 登录 VPS，下载并运行官方安装脚本 `https://www.geto.im/panel/install.sh`。面板端口、用户名、密码随机生成并自动填写。装完显示登录信息，并从你的电脑测试面板能不能打开 |
| 查看状态 / 登录信息 | 面板和各个服务是否在运行，以及面板地址、用户名、密码（忘了密码时用这个） |
| 停止 | 停止面板和协议服务，并取消开机自启 |
| 启动 / 重启 | 恢复开机自启，并（重新）启动 |
| 卸载 | 调用面板自带的卸载（等同于在服务器上输入 `geto` 选 1）。会删除面板、协议、Xray / Hysteria2，以及 `/root/.acme.sh` |

勾选「记住这台服务器」后，evps 会在服务器上放一把它专用的登录公钥（末尾是 `evps`），以后的查看、停止、重启、卸载就不用再输密码。卸载面板时会自动删掉这把公钥。

## 安全说明

- evps 只在你的电脑上监听 `127.0.0.1`，网页地址里带一次性的随机令牌，别的网站和别的电脑都用不了它。
- SSH 密码只在内存里，用来登录这一次，不写入任何文件。
- 在 VPS 上执行的全部内容就是 [`remote/vps.sh`](remote/vps.sh)，没有别的。
- 安装时只认官方脚本「依次问端口、用户名、密码」这一种问法。官方脚本的提问一旦变了，evps 会停下，什么都不装，不会乱填。
- 便携 Node.js 下载后会核对官方公布的 SHA256，对不上就删除，不会执行。
- 本机文件都在一个文件夹里：Windows 是 `%LOCALAPPDATA%\evps`，Mac 是 `~/.evps`。

## 常见问题

**装好了但面板网页打不开？** evps 装完会从你的电脑测一次面板端口。连不上的话，网页上会直接告诉你：到 VPS 服务商后台的「安全组 / 防火墙」放行那个 TCP 端口（服务器自己的防火墙安装时已经自动放行）。

**提示「登录失败」？** 先确认 IP、端口、用户名、密码没写错（密码区分大小写）。有的服务商默认只允许密钥登录，需要在服务商后台开启密码登录，或者重置 root 密码。

**不是 root 账号能用吗？** 能，只要这个账号能用 `sudo`。每次操作都要输它的密码。

**服务器重装过系统，提示「身份和上次记住的不一样」？** 在网页里点「忘记这台服务器」，再重新填写连接。

## 关于首页的推广链接

首页的「我还没有 VPS」按钮会打开一个 VPS 服务商的推广链接（按钮上标了「推广」），通过它购买，作者会得到返点，你付的价格不变。不需要的话直接点「我已经有 VPS」就行。链接写在 [`promo.json`](promo.json) 里。

## 开发

需要 Node.js 22.6 以上（直接运行 TypeScript 源码）。测试和界面走查需要 Linux（用到 `unshare` 和 `script` 模拟 VPS）。

```sh
npm install
npm test                 # 单元测试 + 假 SSH 服务器上的完整流程（安装、状态、停止、启动、卸载）
npm run build            # 编译后端到 dist/server，打包网页到 dist/web
npm start                # 运行
CHROME_BIN=/path/to/chrome node --experimental-strip-types dev/walkthrough.mjs /tmp/evps-walk   # 界面走查和截图
```

目录：

```
server/     本机程序：网页服务（只听 127.0.0.1）、SSH、五个操作
remote/     在 VPS 上执行的脚本
web/        网页（Vue 3）
dev/        假 SSH 服务器、假 VPS、浏览器走查
test/       测试
w.ps1 m.sh  Windows / Mac 的一行命令用的启动脚本
promo.json  首页的推荐链接
```

## 许可

[MIT](LICENSE)
