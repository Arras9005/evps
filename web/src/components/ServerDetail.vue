<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.ts';
import { askConfirm } from '../composables/useConfirm.ts';
import { showToast } from '../composables/useToast.ts';
import { checkIfStale, checkStatus, healthOf, isFailure, runJob, serverState, type Conn, type JobFailure } from '../jobs.ts';
import type { Action } from '../types.ts';
import AppIcon from './AppIcon.vue';
import CredCard from './CredCard.vue';
import LogBox from './LogBox.vue';
import StatusPill from './StatusPill.vue';

const props = defineProps<{ skey: string; conn: Conn; host: string; port: number; user: string; remembered: boolean; serverId?: string }>();
const emit = defineEmits<{ install: [conn: Conn]; gone: [message: string] }>();

const state = computed(() => serverState(props.skey));
const health = computed(() => healthOf(state.value));
const result = computed(() => state.value.result);
const panel = computed(() => result.value?.panel ?? result.value?.status ?? null);
const units = computed(() => result.value?.status?.units ?? []);
const labels = computed(() => result.value?.status?.unitLabels ?? {});

/** 记住的服务器但账号不是 root：sudo 要密码 */
const sudoPassword = ref('');
const needsSudo = computed(() => props.remembered && props.user !== 'root');
const conn = computed<Conn>(() => ('serverId' in props.conn && sudoPassword.value ? { ...props.conn, password: sudoPassword.value } : props.conn));

const busy = ref<Action | null>(null);
const actionError = ref<JobFailure | null>(null);
const actionLines = ref<string[]>([]);

onMounted(() => checkIfStale(props.skey, conn.value, 15_000));

function refresh(): void {
  actionError.value = null;
  void checkStatus(props.skey, conn.value);
}

function openPanel(): void {
  const a = panel.value?.address;
  if (a) window.open(a, '_blank', 'noopener,noreferrer');
}

const DONE_TEXT: Partial<Record<Action, string>> = { stop: '已停止', start: '已启动' };

async function act(action: Action): Promise<void> {
  if (action === 'stop' && !(await askConfirm({
    title: '停止面板和协议？',
    body: ['停止后，面板网页和所有协议都用不了，服务器重启后也不会自己启动。', '之后点「启动」就能恢复。'],
    ok: '停止',
  }))) return;
  if (action === 'uninstall' && !(await askConfirm({
    title: '卸载面板？',
    body: [
      '会调用面板自带的卸载，删除面板、所有协议和配置、Xray / Hysteria2，不可恢复。',
      '注意：同时会删除服务器上的 /root/.acme.sh（证书工具和证书）。这台服务器上如果还有别的网站在用证书，也会受影响。',
    ],
    ok: '确定卸载',
    danger: true,
  }))) return;
  busy.value = action;
  actionError.value = null;
  actionLines.value = [];
  const job = await runJob(action, conn.value, (_j, more) => { actionLines.value.push(...more); });
  busy.value = null;
  if (isFailure(job) || job.state === 'failed') {
    actionError.value = isFailure(job) ? job : job.error ?? { code: 'ERROR', message: '没有成功' };
    return;
  }
  if (action === 'uninstall') {
    if (job.result?.forgotten || props.remembered) {
      emit('gone', '已卸载干净，这台服务器也从列表里删掉了。');
      return;
    }
    showToast('已卸载干净');
    state.value.result = job.result;
    return;
  }
  if (job.result?.kind === 'not-installed') state.value.result = job.result;
  else showToast(DONE_TEXT[action] ?? '完成');
  void checkStatus(props.skey, conn.value);
}

async function forget(): Promise<void> {
  if (!props.serverId) return;
  const ok = await askConfirm({
    title: '忘记这台服务器？',
    body: ['只删掉这台电脑上的记录，服务器上的面板不受影响。', '服务器上 evps 的登录公钥还在，下次「卸载」时会自动删；也可以在服务器的 ~/.ssh/authorized_keys 里手动删掉末尾是 evps 的那一行。'],
    ok: '忘记',
  });
  if (!ok) return;
  const r = await api(`/api/servers/${props.serverId}`, { method: 'DELETE' });
  if (r.ok) emit('gone', '已忘记这台服务器');
  else actionError.value = r.error;
}

/** IP 下面的小字：只在不是默认设置时才写 */
const detailLine = computed(() => [
  props.user !== 'root' ? `用户 ${props.user}` : '',
  props.port !== 22 ? `SSH 端口 ${props.port}` : '',
  props.remembered ? '' : '没记住，关掉网页就忘',
].filter(Boolean).join(' · '));

function unitText(active: string): string {
  return active === 'active' ? '运行中' : active === 'failed' ? '出错了' : '已停止';
}
</script>

<template>
  <section class="page detail">
    <div class="detail-head">
      <div class="grow">
        <h1 class="detail-host">{{ host }}</h1>
        <p v-if="detailLine" class="hint">{{ detailLine }}</p>
      </div>
      <StatusPill :health="health" big />
    </div>

    <label v-if="needsSudo" class="field sudo">
      <span class="field-label">{{ user }} 的密码（这个账号不是 root，操作要用 sudo）</span>
      <input v-model="sudoPassword" class="input" type="password" autocomplete="off" />
    </label>

    <div class="card detail-card" data-test="job">
      <!-- 第一次查，还没有结果 -->
      <div v-if="health === 'checking'" class="checking">
        <span class="spinner big" />
        <p>正在连接服务器查看状态…</p>
      </div>

      <!-- 连不上 -->
      <template v-else-if="health === 'unreachable'">
        <div class="tip bad"><span class="tip-ic">!</span><div>{{ state.error?.message }}</div></div>
        <div class="btn-row">
          <button type="button" class="btn primary xl grow1" :disabled="state.checking" @click="refresh"><span v-if="state.checking" class="spinner" />再试一次</button>
        </div>
        <LogBox :lines="state.lines" />
      </template>

      <!-- 还没装 -->
      <template v-else-if="health === 'not-installed'">
        <div class="empty">
          <p class="empty-title">这台服务器上还没有装面板</p>
        </div>
        <button type="button" class="btn primary xl block" data-test="install" @click="emit('install', conn)">安装面板</button>
      </template>

      <!-- 装了 -->
      <template v-else>
        <CredCard v-if="panel" :panel="panel" :reach="result?.reach" />
        <div v-if="health === 'partial'" class="units">
          <span v-for="u in units" :key="u.name" class="unit" :class="u.active === 'active' ? 'ok' : u.active === 'failed' ? 'bad' : 'idle'">{{ labels[u.name] ?? u.name }}：{{ unitText(u.active) }}</span>
        </div>
        <div class="btn-row">
          <template v-if="health === 'stopped'">
            <button type="button" class="btn primary xl grow2" data-test="start" :disabled="!!busy || state.checking" @click="act('start')"><span v-if="busy === 'start'" class="spinner" />启动</button>
          </template>
          <template v-else>
            <button type="button" class="btn primary xl grow2" data-test="open-panel" :disabled="!panel?.address" @click="openPanel">打开面板 ↗</button>
            <button type="button" class="btn ghost xl grow1" data-test="start" :disabled="!!busy || state.checking" @click="act('start')"><span v-if="busy === 'start'" class="spinner" />{{ health === 'partial' ? '启动' : '重启' }}</button>
            <button type="button" class="btn ghost xl grow1" data-test="stop" :disabled="!!busy || state.checking" @click="act('stop')"><span v-if="busy === 'stop'" class="spinner" />停止</button>
          </template>
        </div>
      </template>

      <div v-if="actionError" class="tip bad" role="alert"><span class="tip-ic">!</span><div>{{ actionError.message }}</div></div>
      <LogBox v-if="actionLines.length && (actionError || busy)" :lines="actionLines" :open="!!actionError && actionLines.length > 3" />
      <p v-if="busy === 'uninstall'" class="checking-line"><span class="spinner" />正在卸载，大约一分钟…</p>
    </div>

    <div class="quiet-links">
      <button type="button" class="linkbtn quiet" data-test="status" :disabled="state.checking || !!busy" @click="refresh">
        <span v-if="state.checking && health !== 'checking'" class="spinner sm" /><AppIcon v-else name="refresh" />刷新状态
      </button>
      <template v-if="health !== 'not-installed' && health !== 'checking' && health !== 'unreachable'">
        <span class="dot-sep">·</span>
        <button type="button" class="linkbtn quiet danger" data-test="uninstall" :disabled="!!busy || state.checking" @click="act('uninstall')">卸载面板</button>
      </template>
      <template v-if="serverId">
        <span class="dot-sep">·</span>
        <button type="button" class="linkbtn quiet" data-test="forget" :disabled="!!busy" @click="forget">忘记这台服务器</button>
      </template>
    </div>
  </section>
</template>
