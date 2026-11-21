<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import AppIcon from './AppIcon.vue';
import { useToasts } from '../composables/useToast.ts';

const toasts = useToasts();
const el = ref<HTMLElement | null>(null);

// 弹窗在浏览器的「顶层」，普通元素再高的 z-index 也会被它盖住。
// toast 用 popover 进入顶层，并且每次出现新的都重新置顶，这样弹窗里点「复制」的反馈也看得见。
watch(() => toasts.items.length, async (n) => {
  await nextTick();
  const node = el.value;
  if (!node || typeof node.showPopover !== 'function') return;
  try {
    if (node.matches(':popover-open')) node.hidePopover();
    if (n > 0) node.showPopover();
  } catch {
    /* 不支持就退回到普通定位 */
  }
});
</script>

<template>
  <div ref="el" class="toasts" popover="manual" role="status" aria-live="polite">
    <div v-for="t in toasts.items" :key="t.id" class="toast"><AppIcon name="check" />{{ t.text }}</div>
  </div>
</template>
