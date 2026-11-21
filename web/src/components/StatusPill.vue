<script setup lang="ts">
import { HEALTH_TEXT, type Health } from '../jobs.ts';

defineProps<{ health: Health; big?: boolean }>();
const TONE: Record<Health, string> = {
  checking: 'busy', running: 'ok', stopped: 'warn', partial: 'warn', 'not-installed': 'idle', unreachable: 'bad', unknown: 'idle',
};
</script>

<template>
  <span class="pill" :class="[TONE[health], { big }]" data-test="pill">{{ big && health === 'running' ? '面板运行中' : HEALTH_TEXT[health] }}</span>
</template>
