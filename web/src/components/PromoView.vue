<script setup lang="ts">
import type { Info, Provider } from '../types.ts';

defineProps<{ promo: Info['promo'] }>();
const emit = defineEmits<{ bought: [] }>();

function open(p: Provider): void {
  window.open(p.url, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <section class="page">
    <h1 class="title">先买一台 VPS</h1>
    <div class="card promo">
      <div v-for="p in promo.providers" :key="p.name" class="prov">
        <span class="prov-logo">{{ p.name.slice(0, 1) }}</span>
        <div class="grow">
          <div class="prov-name">{{ p.name }}</div>
          <div v-if="p.note" class="hint">{{ p.note }}</div>
        </div>
        <button type="button" class="btn primary" data-test="buy" @click="open(p)">去购买 ↗</button>
      </div>
      <template v-if="promo.reasons.length">
        <h2 class="sec">为什么推荐</h2>
        <ol class="nice">
          <li v-for="r in promo.reasons" :key="r">{{ r }}</li>
        </ol>
      </template>
      <h2 class="sec">购买时注意</h2>
      <ol class="nice">
        <li v-for="t in promo.tips" :key="t">{{ t }}</li>
      </ol>
    </div>
    <button type="button" class="btn ghost xl center-block wide-btn" data-test="bought" @click="emit('bought')">买好了，开始安装 →</button>
  </section>
</template>
