<script setup lang="ts">
/** 顶上的「① 连接服务器 — ② 安装 — ③ 完成」 */
defineProps<{ at: 1 | 2 | 3; failed?: boolean }>();
const NAMES = ['连接服务器', '安装', '完成'] as const;
</script>

<template>
  <ol class="stepsbar" aria-label="安装步骤">
    <template v-for="(n, i) in NAMES" :key="n">
      <li v-if="i > 0" class="stepsbar-line" aria-hidden="true" />
      <li :class="{ done: i + 1 < at, now: i + 1 === at, bad: failed && i + 1 === at }">
        <span class="stepsbar-dot">{{ i + 1 < at ? '✓' : failed && i + 1 === at ? '!' : i + 1 }}</span>{{ n }}
      </li>
    </template>
  </ol>
</template>
