<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import done from '../assets/done.webp';
import { isFailure, runJob, type Conn, type JobFailure } from '../jobs.ts';
import type { JobView } from '../types.ts';
import CredCard from './CredCard.vue';
import LogBox from './LogBox.vue';
import StepsBar from './StepsBar.vue';

const props = defineProps<{ conn: Conn }>();
const emit = defineEmits<{
  /** 还没连上服务器就失败了（密码不对、连不上……）：退回表单，把原因显示在表单上 */
  connectFailed: [message: string];
  finished: [job: JobView];
  retry: [];
  edit: [];
  manage: [];
}>();

const job = ref<JobView | null>(null);
const lines = ref<string[]>([]);
const failure = ref<JobFailure | null>(null);
const cred = ref<InstanceType<typeof CredCard> | null>(null);

onMounted(async () => {
  // 先把「装好了」的插图下好、解码好，装完切过去时不会再后冒出来
  const img = new Image();
  img.src = done;
  void img.decode?.().catch(() => undefined);
  const end = await runJob('install', props.conn, (j, more) => {
    job.value = j;
    lines.value.push(...more);
    if (lines.value.length > 2000) lines.value.splice(0, lines.value.length - 2000);
  });
  if (isFailure(end)) {
    if (!job.value && 'host' in props.conn) emit('connectFailed', end.message);
    else failure.value = end;
    return;
  }
  job.value = end;
  if (end.state === 'failed') {
    const reached = end.steps.some((s) => s.state === 'done' || s.state === 'warn');
    if (!reached && 'host' in props.conn) emit('connectFailed', end.error?.message ?? '连不上服务器');
    else failure.value = end.error ?? { code: 'ERROR', message: '安装没有成功' };
    return;
  }
  emit('finished', end);
});

const steps = computed(() => job.value?.steps ?? []);
const doneCount = computed(() => steps.value.filter((s) => s.state === 'done' || s.state === 'warn').length);
const total = computed(() => steps.value.length || 9);
const current = computed(() => steps.value.find((s) => s.state === 'running') ?? null);
const finished = computed(() => job.value?.state === 'ok' && job.value.result !== null);
const result = computed(() => job.value?.result ?? null);

// 圆环：周长 2πr，r = 64
const CIRC = 2 * Math.PI * 64;
const dash = computed(() => `${(CIRC * (failure.value ? 1 : doneCount.value / total.value)).toFixed(1)} ${CIRC.toFixed(1)}`);

const headline = computed(() => {
  if (failure.value) return '没有装成功';
  const c = current.value;
  return c ? `正在${c.label.replace(/（较慢）$/, '')}…` : '正在准备…';
});

function openPanel(): void {
  const a = result.value?.panel?.address;
  if (a) window.open(a, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <Transition name="swap" mode="out-in">
  <!-- 装好了 -->
  <section v-if="finished && result" key="done" class="page" data-test="job">
    <StepsBar :at="3" />
    <img class="done-art" :src="done" alt="" width="140" height="140" />
    <h1 class="title">{{ result.kind === 'already' ? '这台服务器已经装过面板' : '面板装好了' }}</h1>
    <p v-if="result.kind === 'already'" class="lead sm">没有重装，下面是现在的登录信息</p>
    <div class="stack">
      <CredCard v-if="result.panel" ref="cred" :panel="result.panel" :reach="result.reach" />
      <div class="btn-row">
        <button type="button" class="btn primary xl grow2" data-test="open-panel" :disabled="!result.panel?.address" @click="openPanel">打开面板 ↗</button>
        <button type="button" class="btn ghost xl grow1" data-test="copy-all" @click="cred?.copyAll()">复制全部</button>
      </div>
      <button type="button" class="linkbtn center-block" data-test="manage" @click="emit('manage')">管理这台服务器 →</button>
    </div>
  </section>

  <!-- 安装中 / 失败 -->
  <section v-else key="progress" class="page" data-test="job">
    <StepsBar :at="2" :failed="!!failure" />
    <div class="ring" :class="{ bad: failure }">
      <svg viewBox="0 0 148 148" aria-hidden="true">
        <circle class="ring-track" cx="74" cy="74" r="64" />
        <circle class="ring-bar" cx="74" cy="74" r="64" :stroke-dasharray="dash" transform="rotate(-90 74 74)" />
      </svg>
      <div class="ring-num">
        <template v-if="failure">!</template>
        <span v-else>{{ doneCount }}<small> / {{ total }}</small></span>
      </div>
    </div>
    <h1 class="title headline" data-test="job-state" :class="{ busy: !failure }">{{ headline }}</h1>

    <template v-if="!failure">
      <p class="lead sm">大约 3～10 分钟，请不要关闭这个网页和黑窗口</p>
      <LogBox :lines="lines" />
    </template>

    <div v-else class="stack">
      <div class="tip bad" role="alert"><span class="tip-ic">!</span><div>{{ failure.message }}</div></div>
      <div class="btn-row">
        <button type="button" class="btn primary xl grow1" data-test="retry" @click="emit('retry')">重试</button>
        <button v-if="'host' in conn" type="button" class="btn ghost xl grow1" data-test="edit" @click="emit('edit')">返回修改</button>
      </div>
      <LogBox :lines="lines" :open="lines.length > 3" />
    </div>
  </section>
  </Transition>
</template>
