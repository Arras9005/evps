<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { api, splitTarget } from '../api.ts';
import type { Action, JobView, SavedServer } from '../types.ts';
import AppIcon from './AppIcon.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import ResultCard from './ResultCard.vue';

const props = defineProps<{ saved: SavedServer | null }>();
const emit = defineEmits<{ back: []; changed: [] }>();

const host = ref(props.saved?.host ?? '');
const port = ref(String(props.saved?.port ?? 22));
const user = ref(props.saved?.user ?? 'root');
const password = ref('');
const remember = ref(false);
const showPassword = ref(false);
const formError = ref<string | null>(null);

const job = ref<JobView | null>(null);
const lines = ref<string[]>([]);
const showLog = ref(false);
const logBox = ref<HTMLElement | null>(null);
const jobCard = ref<HTMLElement | null>(null);
const confirming = ref<Action | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(timer));

const running = computed(() => job.value?.state === 'running');
const isSaved = computed(() => props.saved !== null);
const needsPassword = computed(() => !isSaved.value || user.value !== 'root');

/** 粘贴 root@1.2.3.4:2222 这类写法时，自动拆到三个框里 */
function onHostBlur(): void {
  const t = splitTarget(host.value);
  host.value = t.host;
  if (t.port !== null) port.value = String(t.port);
  if (t.user !== null) user.value = t.user;
}

function validate(): string | null {
  if (isSaved.value) return null;
  onHostBlur();
  if (!host.value) return '请填服务器 IP';
  const p = Number(port.value);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'SSH 端口是 1 到 65535 的数字，不知道就填 22';
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(user.value.trim())) return 'SSH 用户名不对，一般是 root';
  if (!password.value) return '请填 SSH 密码（买服务器时服务商给的 root 密码）';
  return null;
}

const CONFIRM: Partial<Record<Action, { title: string; body: string[]; ok: string; danger: boolean }>> = {
  stop: { title: '停止面板和协议？', body: ['停止后，面板网页和所有协议都用不了，服务器重启后也不会自己启动。', '之后点「启动 / 重启」就能恢复。'], ok: '停止', danger: false },
  uninstall: {
    title: '卸载面板？',
    body: [
      '会调用面板自带的卸载，删除面板、所有协议和配置、Xray / Hysteria2，不可恢复。',
      '注意：同时会删除服务器上的 /root/.acme.sh（证书工具和证书）。这台服务器上如果还有别的网站在用证书，也会受影响。',
    ],
    ok: '确定卸载',
    danger: true,
  },
};

function ask(action: Action): void {
  formError.value = validate();
  if (formError.value) return;
  if (CONFIRM[action]) confirming.value = action;
  else void run(action);
}

async function run(action: Action): Promise<void> {
  confirming.value = null;
  formError.value = null;
  const body = isSaved.value
    ? { action, serverId: props.saved?.id, ...(password.value ? { password: password.value } : {}) }
    : { action, host: host.value.trim(), port: Number(port.value), user: user.value.trim(), password: password.value, remember: remember.value };
  const r = await api<JobView>('/api/jobs', { method: 'POST', body });
  if (!r.ok) {
    formError.value = r.error.message;
    return;
  }
  job.value = r.data;
  lines.value = [...r.data.lines];
  showLog.value = false;
  poll(r.data.id, r.data.next);
  // 进度和结果在表单下面：开始后滚过去，用户不用自己找
  await nextTick();
  jobCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function poll(id: string, from: number): void {
  timer = setTimeout(async () => {
    const r = await api<JobView>(`/api/jobs/${id}?from=${from}`);
    if (!r.ok) {
      if (job.value) job.value = { ...job.value, state: 'failed', error: r.error };
      return;
    }
    job.value = r.data;
    if (r.data.lines.length) {
      lines.value.push(...r.data.lines);
      if (lines.value.length > 2000) lines.value.splice(0, lines.value.length - 2000);
      if (showLog.value) {
        await nextTick();
        logBox.value?.scrollTo({ top: logBox.value.scrollHeight });
      }
    }
    if (r.data.state === 'running') {
      poll(id, r.data.next);
      return;
    }
    // 记住 / 忘掉服务器之后，首页的列表要更新；密码用完就清掉
    if (r.data.result?.remembered || r.data.result?.forgotten) emit('changed');
    if (r.data.state === 'ok') password.value = '';
    if (r.data.state === 'failed') showLog.value = lines.value.length > 3;
  }, 700);
}

const lastLine = computed(() => [...lines.value].reverse().find((l) => l.trim()) ?? '');

async function forget(): Promise<void> {
  if (!props.saved) return;
  if (!confirm('忘记这台服务器？\n\n只删掉这台电脑上的记录。服务器上 evps 的登录公钥还在，下次「卸载」时会自动删；也可以在服务器的 ~/.ssh/authorized_keys 里手动删掉末尾是 evps 的那一行。')) return;
  const r = await api(`/api/servers/${props.saved.id}`, { method: 'DELETE' });
  if (r.ok) {
    emit('changed');
    emit('back');
  }
}

const stepIcon: Record<string, string> = { done: 'check', warn: 'warn', failed: 'close', running: '', pending: '' };
</script>

<template>
  <button type="button" class="btn text back" @click="emit('back')"><AppIcon name="chevron" class="rot-back" />返回</button>

  <section class="card">
    <div class="card-head">
      <h2>{{ isSaved ? '记住的服务器' : '填写服务器信息' }}</h2>
      <button v-if="isSaved" type="button" class="btn text sm danger" @click="forget">忘记这台服务器</button>
    </div>

    <div v-if="isSaved" class="saved-target">
      <AppIcon name="server" />
      <span class="mono">{{ saved?.user }}@{{ saved?.host }}</span>
      <span class="tag plain mono">SSH 端口 {{ saved?.port }}</span>
      <span class="tag">已记住，不用输密码</span>
    </div>

    <div v-else class="form">
      <label class="field wide">
        <span>服务器 IP</span>
        <input v-model="host" data-test="host" autocomplete="off" spellcheck="false" placeholder="例如 203.0.113.7" :disabled="running" @blur="onHostBlur" />
        <small class="muted">在服务商后台能看到。粘贴 root@IP:端口 这种写法也可以。</small>
      </label>
      <label class="field">
        <span>SSH 端口</span>
        <input v-model="port" data-test="port" inputmode="numeric" autocomplete="off" :disabled="running" />
        <small class="muted">不知道就填 22</small>
      </label>
      <label class="field">
        <span>SSH 用户名</span>
        <input v-model="user" data-test="user" autocomplete="off" spellcheck="false" :disabled="running" />
        <small class="muted">一般是 root</small>
      </label>
      <label class="field wide">
        <span>SSH 密码</span>
        <span class="pw">
          <input v-model="password" data-test="password" :type="showPassword ? 'text' : 'password'" autocomplete="off" :disabled="running" @keydown.enter="ask('install')" />
          <button type="button" class="btn compact" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button>
        </span>
        <small class="muted">买服务器时服务商给的 root 密码。只在你这台电脑上用来登录，不会保存、不会发给任何人。</small>
      </label>
      <label class="check wide">
        <input v-model="remember" type="checkbox" :disabled="running" />
        <span>记住这台服务器，以后查看、停止、重启、卸载不用再输密码
          <small class="muted">（会在服务器上放一把 evps 专用的登录公钥，卸载面板时自动删掉）</small></span>
      </label>
    </div>

    <label v-if="isSaved && needsPassword" class="field wide">
      <span>密码（这个账号不是 root，要用 sudo）</span>
      <input v-model="password" type="password" autocomplete="off" :disabled="running" />
    </label>

    <div v-if="formError" class="note err" role="alert"><AppIcon name="warn" /><div class="body">{{ formError }}</div></div>

    <div class="actions">
      <button type="button" class="btn primary big" data-test="install" :disabled="running" @click="ask('install')">
        <span v-if="running && job?.action === 'install'" class="spinner" /><AppIcon v-else name="download" />安装面板
      </button>
      <span class="grow" />
      <button type="button" class="btn" data-test="status" :disabled="running" @click="ask('status')"><AppIcon name="info" />查看状态 / 登录信息</button>
      <button type="button" class="btn" data-test="stop" :disabled="running" @click="ask('stop')"><AppIcon name="stop" />停止</button>
      <button type="button" class="btn" data-test="start" :disabled="running" @click="ask('start')"><AppIcon name="refresh" />启动 / 重启</button>
      <button type="button" class="btn danger" data-test="uninstall" :disabled="running" @click="ask('uninstall')"><AppIcon name="trash" />卸载</button>
    </div>
  </section>

  <section v-if="job" ref="jobCard" class="card job" data-test="job">
    <div class="card-head">
      <h2>
        <span v-if="job.state === 'running'" class="badge busy">{{ job.label }}中…</span>
        <span v-else-if="job.state === 'ok'" class="badge ok">{{ job.label }}：完成</span>
        <span v-else class="badge err">{{ job.label }}：没有成功</span>
      </h2>
      <span class="muted small mono">{{ job.target.user }}@{{ job.target.host }}</span>
    </div>

    <ol v-if="job.steps.length" class="steps">
      <li v-for="s in job.steps" :key="s.id" :class="s.state">
        <span class="step-mark"><span v-if="s.state === 'running'" class="spinner" /><AppIcon v-else-if="stepIcon[s.state]" :name="stepIcon[s.state] as string" /></span>
        <span>{{ s.label }}</span>
      </li>
    </ol>
    <p v-else-if="job.state === 'running'" class="muted mono small last">{{ lastLine }}</p>
    <p v-if="job.state === 'running' && job.action === 'install'" class="muted small">一般要 3 到 10 分钟，请不要关闭这个网页和黑窗口。</p>

    <div v-if="job.error" class="note err" role="alert"><AppIcon name="warn" /><div class="body">{{ job.error.message }}</div></div>
    <ResultCard v-if="job.result" :result="job.result" :host="job.target.host" />

    <div class="log-head">
      <button type="button" class="btn text sm" @click="showLog = !showLog">
        <AppIcon name="terminal" />{{ showLog ? '收起详细日志' : '查看详细日志' }}（{{ lines.length }} 行）
      </button>
    </div>
    <pre v-if="showLog" ref="logBox" class="log">{{ lines.join('\n') }}</pre>
  </section>

  <ConfirmDialog
    v-if="confirming && CONFIRM[confirming]"
    :title="CONFIRM[confirming]!.title"
    :body="CONFIRM[confirming]!.body"
    :ok="CONFIRM[confirming]!.ok"
    :danger="CONFIRM[confirming]!.danger"
    @ok="run(confirming)"
    @cancel="confirming = null"
  />
</template>
