<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api, initToken } from './api.ts';
import type { Info, SavedServer } from './types.ts';
import AppIcon from './components/AppIcon.vue';
import HomeView from './components/HomeView.vue';
import PromoView from './components/PromoView.vue';
import ServerView from './components/ServerView.vue';
import ToastHost from './components/ToastHost.vue';

type View = 'home' | 'promo' | 'server';

const hasToken = initToken();
const info = ref<Info | null>(null);
const servers = ref<SavedServer[]>([]);
const view = ref<View>('home');
const picked = ref<SavedServer | null>(null);
const fatal = ref<string | null>(hasToken ? null : '这个网页需要从黑窗口打开。请回到黑窗口，重新运行那一行命令。');
const quitting = ref<'quit' | 'cleanup' | null>(null);
const quitDone = ref<string | null>(null);
let ping: ReturnType<typeof setInterval> | undefined;

async function loadServers(): Promise<void> {
  const r = await api<{ servers: SavedServer[] }>('/api/servers');
  if (r.ok) servers.value = r.data.servers;
}

onMounted(async () => {
  if (!hasToken) return;
  const r = await api<Info>('/api/info');
  if (!r.ok) {
    fatal.value = r.error.message;
    return;
  }
  info.value = r.data;
  await loadServers();
  // 告诉 evps 网页还开着；网页关掉一段时间后它会自己退出
  ping = setInterval(() => { void api('/api/ping', { method: 'POST', body: {} }); }, 60_000);
});
onBeforeUnmount(() => clearInterval(ping));

function openServer(s: SavedServer | null): void {
  picked.value = s;
  view.value = 'server';
}

async function quit(cleanup: boolean): Promise<void> {
  const msg = cleanup
    ? '清理本机文件：删除 evps 在这台电脑上的全部文件（记住的服务器、登录密钥、下载的运行环境），然后退出。\n\n服务器上已经装好的面板不受影响。确定吗？'
    : '退出 evps？服务器上已经装好的面板不受影响。';
  if (!confirm(msg)) return;
  quitting.value = cleanup ? 'cleanup' : 'quit';
  const r = await api(cleanup ? '/api/cleanup' : '/api/quit', { method: 'POST', body: {} });
  quitting.value = null;
  if (!r.ok) {
    alert(r.error.message);
    return;
  }
  clearInterval(ping);
  quitDone.value = cleanup ? '已清理本机文件并退出。可以关掉这个网页和黑窗口了。' : 'evps 已退出。可以关掉这个网页和黑窗口了。';
}
</script>

<template>
  <header class="top">
    <div class="top-in">
      <button type="button" class="brand-btn" @click="view = 'home'">
        <span class="brand"><AppIcon name="server" /></span>
        <span class="brand-text"><b>evps</b><small>VPS 一键安装面板</small></span>
      </button>
      <span class="grow" />
      <span v-if="info" class="tag plain mono">v{{ info.version }}</span>
    </div>
  </header>

  <main class="wrap">
    <div v-if="quitDone" class="note ok big"><AppIcon name="check" /><div class="body">{{ quitDone }}</div></div>
    <div v-else-if="fatal" class="note err big"><AppIcon name="warn" /><div class="body">{{ fatal }}</div></div>
    <template v-else-if="info">
      <HomeView v-if="view === 'home'" :promo="info.promo" :servers="servers" @have="openServer(null)" @need="view = 'promo'" @pick="openServer" />
      <PromoView v-else-if="view === 'promo'" :promo="info.promo" @back="view = 'home'" @bought="openServer(null)" />
      <ServerView v-else :key="picked?.id ?? 'new'" :saved="picked" @back="view = 'home'; loadServers()" @changed="loadServers" />
    </template>
  </main>

  <footer v-if="!quitDone && info" class="foot">
    <span>evps 是开源的非官方工具，和面板作者无关。SSH 密码只在你这台电脑上使用，不会发给任何人。</span>
    <span class="grow" />
    <button type="button" class="btn text sm" :disabled="quitting !== null" @click="quit(false)">退出</button>
    <button type="button" class="btn text sm danger" :disabled="quitting !== null" @click="quit(true)">清理本机文件</button>
  </footer>
  <ToastHost />
</template>
