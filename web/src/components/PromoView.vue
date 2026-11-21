<script setup lang="ts">
import type { Info, Provider } from '../types.ts';
import AppIcon from './AppIcon.vue';

defineProps<{ promo: Info['promo'] }>();
const emit = defineEmits<{ back: []; bought: [] }>();

function open(p: Provider): void {
  window.open(p.url, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <button type="button" class="btn text back" @click="emit('back')"><AppIcon name="chevron" class="rot-back" />返回</button>
  <section class="card">
    <h2>买一台 VPS</h2>
    <p class="muted">购买页面已经在新标签页打开。没打开的话，点下面的按钮。</p>
    <div class="providers">
      <div v-for="p in promo.providers" :key="p.name" class="provider">
        <div class="grow">
          <b>{{ p.name }}</b>
          <p v-if="p.note" class="muted small">{{ p.note }}</p>
        </div>
        <button type="button" class="btn primary" @click="open(p)">去购买 <AppIcon name="external" /></button>
      </div>
    </div>
    <h3 v-if="promo.reasons.length">我的推荐理由</h3>
    <ol v-if="promo.reasons.length" class="tips">
      <li v-for="r in promo.reasons" :key="r">{{ r }}</li>
    </ol>
    <h3>购买时注意</h3>
    <ol class="tips">
      <li v-for="t in promo.tips" :key="t">{{ t }}</li>
    </ol>
    <div class="row-end">
      <button type="button" class="btn primary" data-test="bought" @click="emit('bought')">我已经买好了，开始安装 <AppIcon name="chevron" class="rot" /></button>
    </div>
  </section>
</template>
