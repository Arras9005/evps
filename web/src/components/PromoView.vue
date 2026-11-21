<script setup lang="ts">
import { computed } from 'vue';
import type { Info, Provider } from '../types.ts';
import AppIcon from './AppIcon.vue';

const props = defineProps<{ promo: Info['promo'] }>();
const sentences = computed(() => props.promo.intro.split(/(?<=[。！？])/).map((t) => t.trim()).filter(Boolean));
const emit = defineEmits<{ bought: [] }>();

function open(p: Provider): void {
  window.open(p.url, '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <section class="page wide promo-page">
    <h1 class="title promo-title"><span class="soft-badge">个人推荐</span>推荐一家好用的 VPS</h1>
    <!-- 一句一行：「只是个人推荐」和「用其他家也可以」各占一行，读着清楚 -->
    <p v-if="promo.intro" class="lead sm intro"><span v-for="(t, i) in sentences" :key="i">{{ t }}</span></p>

    <div v-for="p in promo.providers" :key="p.name" class="card promo">
      <div class="prov">
        <span class="prov-logo">{{ p.name.slice(0, 1) }}</span>
        <div class="grow">
          <div class="prov-name">{{ p.name }}</div>
          <div v-if="p.note" class="hint">{{ p.note }}</div>
        </div>
        <button type="button" class="btn primary" data-test="buy" @click="open(p)">去看看 ↗</button>
      </div>

      <ul v-if="promo.highlights.length" class="highlights">
        <li v-for="h in promo.highlights" :key="h.title">
          <span class="hl-ic"><AppIcon :name="h.icon" /></span>
          <b>{{ h.title }}</b>
          <span>{{ h.desc }}</span>
        </li>
      </ul>
      <ol v-else-if="promo.reasons.length" class="nice">
        <li v-for="r in promo.reasons" :key="r">{{ r }}</li>
      </ol>

      <template v-if="promo.tips.length">
        <h2 class="sec">购买时注意</h2>
        <ul class="tips-plain">
          <li v-for="t in promo.tips" :key="t"><AppIcon name="check" />{{ t }}</li>
        </ul>
      </template>

    </div>

    <button type="button" class="linkbtn center-block" data-test="bought" @click="emit('bought')">买好了，或者已经有服务器？开始安装 →</button>
  </section>
</template>
