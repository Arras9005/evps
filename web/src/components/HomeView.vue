<script setup lang="ts">
import type { Info, SavedServer } from '../types.ts';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ promo: Info['promo']; servers: SavedServer[] }>();
const emit = defineEmits<{ have: []; need: []; pick: [server: SavedServer] }>();

/** 「我还没有 VPS」：只有一家时直接打开它的网页，同时显示购买指引 */
function need(): void {
  const only = props.promo.providers.length === 1 ? props.promo.providers[0] : undefined;
  if (only) window.open(only.url, '_blank', 'noopener,noreferrer');
  emit('need');
}
</script>

<template>
  <section class="hero">
    <h1>给你的 VPS 一键装好 Geto 面板</h1>
    <p class="muted">填上服务器的 IP 和密码，剩下的全自动。装好后还能在这里查看、停止、重启、卸载。</p>
  </section>

  <section class="choices" :class="{ single: promo.providers.length === 0 }">
    <button type="button" class="choice primary" data-test="have" @click="emit('have')">
      <span class="choice-icon"><AppIcon name="server" /></span>
      <span class="choice-title">我已经有 VPS</span>
      <span class="choice-sub">填上 IP 和密码，开始安装</span>
      <span class="choice-go">开始 <AppIcon name="chevron" class="rot" /></span>
    </button>
    <button v-if="promo.providers.length" type="button" class="choice" data-test="need" @click="need">
      <span class="choice-icon alt"><AppIcon name="plus" /></span>
      <span class="choice-title">我还没有 VPS</span>
      <span class="choice-sub">去买一台，几分钟就能用</span>
      <span class="choice-go">去购买（推荐） <AppIcon name="external" /></span>
      <span class="ad-mark">推广</span>
    </button>
  </section>

  <section v-if="servers.length" class="card saved">
    <h2>记住的服务器</h2>
    <p class="muted small">点一下就能查看、停止、重启或卸载，不用再输密码。</p>
    <ul class="saved-list">
      <li v-for="s in servers" :key="s.id">
        <button type="button" class="saved-row" @click="emit('pick', s)">
          <AppIcon name="server" />
          <span class="mono">{{ s.user }}@{{ s.host }}</span>
          <span v-if="s.port !== 22" class="tag plain mono">端口 {{ s.port }}</span>
          <span class="grow" />
          <AppIcon name="chevron" class="rot" />
        </button>
      </li>
    </ul>
  </section>
</template>
