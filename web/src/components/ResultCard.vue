<script setup lang="ts">
import { computed } from 'vue';
import type { JobResult } from '../types.ts';
import { showToast } from '../composables/useToast.ts';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ result: JobResult; host: string }>();

const panel = computed(() => props.result.panel ?? null);
const status = computed(() => props.result.status ?? null);
const showLogin = computed(() => ['installed', 'already', 'status'].includes(props.result.kind) && panel.value?.address);

const HEADLINE: Record<JobResult['kind'], string> = {
  installed: '面板已装好',
  already: '这台服务器已经装过面板，没有重装。下面是现在的登录信息。',
  status: '面板已安装',
  stopped: '已停止。面板和协议现在都不能用，点「启动 / 重启」可以恢复。',
  started: '已启动。面板和协议恢复正常。',
  uninstalled: '已卸载干净。',
  'not-installed': '这台服务器上还没有装面板。',
};

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制${what}`);
  } catch {
    showToast('复制失败，请手动选中复制');
  }
}

function copyAll(): void {
  const p = panel.value;
  if (!p) return;
  void copy(`地址: ${p.address}\n用户名: ${p.user ?? ''}\n密码: ${p.pass ?? ''}\n`, '全部');
}

function openPanel(): void {
  if (panel.value?.address) window.open(panel.value.address, '_blank', 'noopener,noreferrer');
}

function unitText(active: string): string {
  return active === 'active' ? '运行中' : active === 'failed' ? '出错了' : '已停止';
}
</script>

<template>
  <div class="result" data-test="result">
    <div class="note" :class="result.kind === 'not-installed' || result.kind === 'stopped' ? 'info' : 'ok'">
      <AppIcon :name="result.kind === 'not-installed' ? 'info' : 'check'" />
      <div class="body"><b>{{ HEADLINE[result.kind] }}</b><span v-if="result.forgotten">（这台服务器也已从「记住的服务器」里删掉。）</span></div>
    </div>

    <dl v-if="showLogin && panel" class="login">
      <dt>面板地址</dt>
      <dd>
        <span class="mono sel">{{ panel.address }}</span>
        <button type="button" class="btn primary compact" data-test="open-panel" @click="openPanel"><AppIcon name="external" />打开面板</button>
        <button type="button" class="btn compact" @click="copy(panel.address ?? '', '地址')"><AppIcon name="copy" />复制</button>
      </dd>
      <template v-if="panel.domainAddress">
        <dt>域名地址</dt>
        <dd><span class="mono sel">{{ panel.domainAddress }}</span></dd>
      </template>
      <dt>用户名</dt>
      <dd><span class="mono sel">{{ panel.user ?? '—' }}</span><button v-if="panel.user" type="button" class="btn compact" @click="copy(panel.user, '用户名')"><AppIcon name="copy" />复制</button></dd>
      <dt>密码</dt>
      <dd>
        <span class="mono sel">{{ panel.pass ?? '（面板里改过密码，这里看不到）' }}</span>
        <button v-if="panel.pass" type="button" class="btn compact" @click="copy(panel.pass, '密码')"><AppIcon name="copy" />复制</button>
      </dd>
    </dl>
    <div v-if="showLogin" class="row-end">
      <span class="muted small">请把这三项保存好。以后忘了，点「查看状态 / 登录信息」就能再看到。</span>
      <button type="button" class="btn sm" @click="copyAll"><AppIcon name="copy" />复制全部</button>
    </div>

    <div v-if="result.reach && !result.reach.ok" class="note warn" data-test="reach-warn">
      <AppIcon name="warn" />
      <div class="body">
        <b>从你的电脑打不开面板（TCP 端口 {{ result.reach.port }} 连不上）。</b>
        服务器自己的防火墙已经自动放行了，多半是服务商后台的「安全组 / 防火墙」挡住了。
        请到服务商后台放行 <b>TCP {{ result.reach.port }}</b>（或者放行全部端口），再点「打开面板」。
      </div>
    </div>
    <p v-else-if="result.reach?.ok" class="muted small">已从你的电脑测试过，面板端口能连上。协议在面板网页里创建。</p>

    <div v-if="status && status.installed && status.units.length" class="units">
      <span v-if="status.stopped" class="tag warn">已被 evps 停止</span>
      <span v-for="u in status.units" :key="u.name" class="unit">
        <span class="badge" :class="u.active === 'active' ? 'ok' : u.active === 'failed' ? 'err' : 'idle'">{{ status.unitLabels[u.name] ?? u.name }}：{{ unitText(u.active) }}</span>
      </span>
    </div>
  </div>
</template>
