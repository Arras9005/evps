<script setup lang="ts">
import hero from '../assets/hero.webp';

defineProps<{ hasPromo: boolean }>();
const emit = defineEmits<{ start: []; need: [] }>();
</script>

<template>
  <section class="welcome page">
    <img class="welcome-art" :src="hero" alt="" width="380" height="328" />
    <h1>一键给你的 VPS<br />装好 Geto 面板</h1>
    <p class="lead">只要服务器 IP 和密码，剩下的全自动。</p>
    <button type="button" class="btn primary xl" data-test="have" @click="emit('start')">开始安装</button>
    <button v-if="hasPromo" type="button" class="linkbtn" data-test="need" @click="emit('need')">还没有服务器？看看推荐 →</button>
  </section>
</template>
