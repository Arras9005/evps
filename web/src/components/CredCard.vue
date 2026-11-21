<script setup lang="ts">
/** 面板的登录信息：地址、用户名、密码，各带「复制」；下面是端口连不上的提示 */
import type { JobResult, PanelInfo } from '../types.ts';
import { showToast } from '../composables/useToast.ts';

const props = defineProps<{ panel: PanelInfo; reach?: JobResult['reach'] }>();

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`已复制${what}`);
  } catch {
    showToast('复制失败，请手动选中复制');
  }
}

function copyAll(): void {
  const p = props.panel;
  void copy(`面板地址: ${p.address ?? ''}\n用户名: ${p.user ?? ''}\n密码: ${p.pass ?? ''}\n`, '全部登录信息');
}

defineExpose({ copyAll });
</script>

<template>
  <div class="cred" data-test="result">
    <div class="cred-row">
      <span class="cred-k">面板地址</span>
      <span class="cred-v sel">{{ panel.address ?? '—' }}</span>
      <button v-if="panel.address" type="button" class="cred-copy" @click="copy(panel.address, '面板地址')">复制</button>
    </div>
    <div v-if="panel.domainAddress" class="cred-row">
      <span class="cred-k">域名地址</span>
      <span class="cred-v sel">{{ panel.domainAddress }}</span>
      <button type="button" class="cred-copy" @click="copy(panel.domainAddress, '域名地址')">复制</button>
    </div>
    <div class="cred-row">
      <span class="cred-k">用户名</span>
      <span class="cred-v sel">{{ panel.user ?? '—' }}</span>
      <button v-if="panel.user" type="button" class="cred-copy" @click="copy(panel.user, '用户名')">复制</button>
    </div>
    <div class="cred-row">
      <span class="cred-k">密码</span>
      <span class="cred-v sel" :class="{ dim: !panel.pass }">{{ panel.pass ?? '面板里改过密码，这里看不到' }}</span>
      <button v-if="panel.pass" type="button" class="cred-copy" @click="copy(panel.pass, '密码')">复制</button>
    </div>
  </div>
  <div v-if="reach && !reach.ok" class="tip warn" data-test="reach-warn">
    <span class="tip-ic">!</span>
    <div>
      <b>从你的电脑打不开面板（TCP 端口 {{ reach.port }} 连不上）。</b>
      服务器自己的防火墙已经自动放行了，多半是服务商后台的「安全组 / 防火墙」挡住了。请到服务商后台放行 <b>TCP {{ reach.port }}</b>（或者放行全部端口），再点「打开面板」。
    </div>
  </div>
</template>
