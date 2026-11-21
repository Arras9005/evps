<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{ lines: string[]; open?: boolean }>();
const shown = ref(props.open ?? false);
const box = ref<HTMLElement | null>(null);
watch(() => props.open, (v) => { if (v) shown.value = true; });
watch(() => [props.lines.length, shown.value], async () => {
  if (!shown.value) return;
  await nextTick();
  box.value?.scrollTo({ top: box.value.scrollHeight });
});
</script>

<template>
  <div v-if="lines.length" class="logwrap">
    <button type="button" class="linkbtn quiet" data-test="log-toggle" @click="shown = !shown">{{ shown ? '收起详细日志' : '查看详细日志' }}（{{ lines.length }} 行）</button>
    <pre v-if="shown" ref="box" class="log">{{ lines.join('\n') }}</pre>
  </div>
</template>
