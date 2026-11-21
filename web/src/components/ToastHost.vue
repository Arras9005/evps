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
    if (n > 0) {
      if (node.matches(':popover-open')) node.hidePopover();
      node.showPopover();
    } else {
      // 等最后一条的淡出动画放完再收起，不然会一下子消失
      setTimeout(() => { if (toasts.items.length === 0 && node.matches(':popover-open')) node.hidePopover(); }, 220);
    }
  } catch {
    /* 不支持就退回到普通定位 */
  }
});
</script>

<template>
  <div ref="el" class="toasts" popover="manual" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts.items" :key="t.id" class="toast"><AppIcon name="check" />{{ t.text }}</div>
    </TransitionGroup>
  </div>
</template>
