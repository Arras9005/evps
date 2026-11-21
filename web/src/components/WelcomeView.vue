<script setup lang="ts">
import { ref } from 'vue';
import hero from '../assets/hero.webp';

defineProps<{ hasPromo: boolean }>();
const emit = defineEmits<{ start: []; need: [] }>();
const ready = ref(false);
</script>

<template>
  <section class="welcome page">
    <!-- 图片解码好了再淡入，不会先空一块、再「啪」地出现 -->
    <img class="welcome-art" :class="{ ready }" :src="hero" alt="" width="380" height="328" decoding="async" @load="ready = true" />
    <h1>一键给你的 VPS<br />装好 Geto 面板</h1>
    <p class="lead">只要服务器 IP 和密码，剩下的全自动。</p>
    <button type="button" class="btn primary xl" data-test="have" @click="emit('start')">开始安装</button>
    <button v-if="hasPromo" type="button" class="linkbtn" data-test="need" @click="emit('need')">还没有服务器？看看我推荐的 VPS →</button>
  </section>
</template>
