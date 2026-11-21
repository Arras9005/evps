<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';
import { api, initToken } from './api.ts';
import logo from './assets/logo.webp';
import { askConfirm } from './composables/useConfirm.ts';
import { showToast } from './composables/useToast.ts';
import { forgetState, setResult, type Conn } from './jobs.ts';
import type { Info, JobView, SavedServer } from './types.ts';
import AppIcon from './components/AppIcon.vue';
import AppMenu from './components/AppMenu.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ConnectView, { type Draft } from './components/ConnectView.vue';
import InstallView from './components/InstallView.vue';
import PromoView from './components/PromoView.vue';
import ServerDetail from './components/ServerDetail.vue';
import ServerList, { type ListedServer } from './components/ServerList.vue';
import ToastHost from './components/ToastHost.vue';
import WelcomeView from './components/WelcomeView.vue';

type Route =
  | { name: 'home' }
  | { name: 'promo' }
  | { name: 'connect' }
  | { name: 'install'; conn: Conn; run: number }
  | { name: 'server'; key: string };

const hasToken = initToken();
const info = ref<Info | null>(null);
const saved = ref<SavedServer[]>([]);
/** 没勾「记住」的服务器：这次打开网页期间还能管理，密码只在内存里 */
const session = ref<ListedServer[]>([]);
const route = shallowRef<Route>({ name: 'home' });
const fatal = ref<string | null>(hasToken ? null : '这个网页需要从黑窗口打开。请回到黑窗口，重新运行那一行命令。');
const quitting = ref(false);
const quitDone = ref<string | null>(null);
const installing = ref(false);
/** npm 上有新版本（只有用 npm i -g 装的才会查） */
const update = ref<string | null>(null);
let ping: ReturnType<typeof setInterval> | undefined;

const freshDraft = (): Draft => ({ host: '', port: '22', user: 'root', password: '', remember: true, error: null });
const draft = reactive<Draft>(freshDraft());

const servers = computed<ListedServer[]>(() => [
  ...saved.value.map((s) => ({ key: `id:${s.id}`, conn: { serverId: s.id }, host: s.host, port: s.port, user: s.user, remembered: true })),
  ...session.value.filter((x) => !saved.value.some((s) => s.host === x.host && s.port === x.port && s.user === x.user)),
]);
const current = computed(() => (route.value.name === 'server' ? servers.value.find((s) => s.key === (route.value as { key: string }).key) ?? null : null));
const hasPromo = computed(() => (info.value?.promo.providers.length ?? 0) > 0);

async function loadServers(): Promise<void> {
  const r = await api<{ servers: SavedServer[] }>('/api/servers');
  if (r.ok) saved.value = r.data.servers;
}

onMounted(async () => {
  if (!hasToken) return;
  // 基本信息和记住的服务器一起拿到再显示：不然会先闪一下欢迎页，再跳成服务器列表
  const [r, list] = await Promise.all([api<Info>('/api/info'), api<{ servers: SavedServer[] }>('/api/servers')]);
  if (!r.ok) {
    fatal.value = r.error.message;
    return;
  }
  if (list.ok) saved.value = list.data.servers;
  info.value = r.data;
  void api<{ latest: string | null }>('/api/update').then((u) => { if (u.ok) update.value = u.data.latest; });
  // 告诉 evps 网页还开着；网页关掉一段时间后它会自己退出
  ping = setInterval(() => { void api('/api/ping', { method: 'POST', body: {} }); }, 60_000);
});
onBeforeUnmount(() => clearInterval(ping));

function go(r: Route): void {
  route.value = r;
}

/** 旧页面淡出以后再回到顶部：先滚会看到旧页面跳一下 */
function scrollTop(): void {
  window.scrollTo({ top: 0 });
}

/** 每个页面一个 key：key 变了才播放切换动画 */
const viewKey = computed(() => {
  if (quitDone.value) return 'quit';
  if (fatal.value) return 'fatal';
  if (!info.value) return 'loading';
  const r = route.value;
  if (r.name === 'home') return servers.value.length ? 'home-list' : 'home-welcome';
  if (r.name === 'install') return `install-${r.run}`;
  if (r.name === 'server') return `server-${r.key}`;
  return r.name;
});

function goHome(): void {
  if (installing.value) return;
  go({ name: 'home' });
}

function startNew(): void {
  Object.assign(draft, freshDraft());
  go({ name: 'connect' });
}

function sessionKey(host: string, port: number, user: string): string {
  return `s:${user}@${host}:${port}`;
}

function submitDraft(): void {
  // 双击按钮、或者旧页面淡出时又点了一下：只开始一次
  if (installing.value) return;
  draft.error = null;
  installing.value = true;
  go({ name: 'install', run: Date.now(), conn: { host: draft.host.trim(), port: Number(draft.port), user: draft.user.trim(), password: draft.password, remember: draft.remember } });
}

function installOn(conn: Conn): void {
  installing.value = true;
  go({ name: 'install', run: Date.now(), conn });
}

/** 装完了：记下这台服务器，详情页直接用这次的结果，不用再查一遍 */
let lastInstalledKey: string | null = null;
async function onInstalled(job: JobView): Promise<void> {
  installing.value = false;
  const r = route.value;
  if (r.name !== 'install') return;
  const t = job.target;
  if (job.result?.remembered) {
    await loadServers();
    lastInstalledKey = `id:${job.result.remembered}`;
  } else if ('serverId' in r.conn) {
    lastInstalledKey = `id:${r.conn.serverId}`;
  } else {
    lastInstalledKey = sessionKey(t.host, t.port, t.user);
    session.value = [
      ...session.value.filter((s) => s.key !== lastInstalledKey),
      { key: lastInstalledKey, conn: { ...r.conn, remember: false }, host: t.host, port: t.port, user: t.user, remembered: false },
    ];
  }
  setResult(lastInstalledKey, job.result);
  // 装好以后，表单里的密码就不留了
  draft.password = '';
}

function onConnectFailed(message: string): void {
  installing.value = false;
  draft.error = message;
  go({ name: 'connect' });
}

function onGone(message: string): void {
  const key = route.value.name === 'server' ? route.value.key : null;
  if (key) {
    forgetState(key);
    session.value = session.value.filter((s) => s.key !== key);
  }
  showToast(message);
  void loadServers().then(() => go({ name: 'home' }));
}

async function quit(cleanup: boolean): Promise<void> {
  const ok = await askConfirm(cleanup
    ? { title: '清理本机文件并退出？', body: ['删除 evps 在这台电脑上的全部文件（记住的服务器、登录密钥、下载的运行环境），然后退出。', '服务器上已经装好的面板不受影响。'], ok: '清理并退出', danger: true }
    : { title: '退出 evps？', body: ['服务器上已经装好的面板不受影响。下次要用，重新运行那一行命令就行。'], ok: '退出' });
  if (!ok) return;
  quitting.value = true;
  const r = await api(cleanup ? '/api/cleanup' : '/api/quit', { method: 'POST', body: {} });
  quitting.value = false;
  if (!r.ok) {
    showToast(r.error.message, 5000);
    return;
  }
  clearInterval(ping);
  quitDone.value = cleanup ? '已清理本机文件并退出。可以关掉这个网页和黑窗口了。' : 'evps 已退出。可以关掉这个网页和黑窗口了。';
}

const showBack = computed(() => !['home', 'install'].includes(route.value.name));
const backText = computed(() => (route.value.name === 'server' ? '我的服务器' : '返回'));
</script>

<template>
  <div class="shell">
    <header class="bar">
      <button type="button" class="logo" :disabled="installing" data-test="home" @click="goHome">
        <img :src="logo" alt="" width="32" height="32" />
        <span>evps</span>
      </button>
      <span class="grow" />
      <AppMenu v-if="info && !quitDone" :version="info.version" :disabled="quitting || installing" @quit="quit" />
    </header>

    <Transition name="fade">
    <div v-if="update && !quitDone" class="update-bar" data-test="update">
      <b>有新版本 {{ update }}</b>（你现在用的是 {{ info?.version }}）。更新方法：关掉 evps，在黑窗口运行 <code>npm i -g @zhangbo9005/easy-vps@latest</code>，再运行 <code>evps</code>。
    </div>
    </Transition>

    <main class="main">
      <Transition name="page" mode="out-in" appear @after-leave="scrollTop">
        <div :key="viewKey" class="view">
          <section v-if="quitDone" class="page center-page">
            <div class="big-mark ok"><AppIcon name="check" /></div>
            <h1 class="title">{{ quitDone }}</h1>
          </section>
          <section v-else-if="fatal" class="page center-page">
            <div class="big-mark warn"><AppIcon name="warn" /></div>
            <h1 class="title">打不开</h1>
            <p class="lead sm">{{ fatal }}</p>
          </section>
          <template v-else-if="info">
            <div v-if="showBack" class="back-row"><button type="button" class="back" data-test="back" @click="go({ name: 'home' })"><AppIcon name="chevron" class="rot-back" />{{ backText }}</button></div>
            <ServerList v-if="route.name === 'home' && servers.length" :servers="servers" @open="(s) => go({ name: 'server', key: s.key })" @add="startNew" />
            <WelcomeView v-else-if="route.name === 'home'" :has-promo="hasPromo" @start="startNew" @need="go({ name: 'promo' })" />
            <PromoView v-else-if="route.name === 'promo'" :promo="info.promo" @bought="startNew" />
            <ConnectView v-else-if="route.name === 'connect'" :draft="draft" @submit="submitDraft" />
            <InstallView
              v-else-if="route.name === 'install'"
              :conn="route.conn"
              @connect-failed="onConnectFailed"
              @finished="onInstalled"
              @retry="installOn((route as { conn: Conn }).conn)"
              @edit="installing = false; go({ name: 'connect' })"
              @manage="lastInstalledKey && go({ name: 'server', key: lastInstalledKey })"
            />
            <ServerDetail
              v-else-if="route.name === 'server' && current"
              :skey="current.key"
              :conn="current.conn"
              :host="current.host"
              :port="current.port"
              :user="current.user"
              :remembered="current.remembered"
              :server-id="'serverId' in current.conn ? current.conn.serverId : undefined"
              @install="installOn"
              @gone="onGone"
            />
          </template>
        </div>
      </Transition>
    </main>

  </div>
  <ConfirmDialog />
  <ToastHost />
</template>
