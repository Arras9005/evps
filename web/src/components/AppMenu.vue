<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from './AppIcon.vue';

defineProps<{ version: string; disabled: boolean }>();
const emit = defineEmits<{ quit: [cleanup: boolean] }>();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function outside(e: MouseEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false;
}
onMounted(() => { document.addEventListener('click', outside); document.addEventListener('keydown', onKey); });
onBeforeUnmount(() => { document.removeEventListener('click', outside); document.removeEventListener('keydown', onKey); });

function pick(cleanup: boolean): void {
  open.value = false;
  emit('quit', cleanup);
}
function github(): void {
  open.value = false;
  window.open('https://github.com/Arras9005/evps', '_blank', 'noopener,noreferrer');
}
</script>

<template>
  <div ref="root" class="menu-wrap">
    <button type="button" class="icon-btn" :class="{ on: open }" aria-label="更多" :aria-expanded="open" data-test="menu" @click="open = !open"><AppIcon name="more" /></button>
    <div v-if="open" class="menu" role="menu">
      <button type="button" role="menuitem" data-test="quit" :disabled="disabled" @click="pick(false)">退出 evps</button>
      <button type="button" role="menuitem" class="danger" data-test="cleanup" :disabled="disabled" @click="pick(true)">清理本机文件并退出</button>
      <div class="menu-sep" />
      <button type="button" role="menuitem" class="menu-meta" @click="github">版本 {{ version }} · GitHub ↗</button>
    </div>
  </div>
</template>
