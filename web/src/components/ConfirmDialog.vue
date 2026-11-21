<script setup lang="ts">
import { onMounted, ref } from 'vue';

defineProps<{ title: string; body: string[]; ok: string; danger: boolean }>();
const emit = defineEmits<{ ok: []; cancel: [] }>();
const dlg = ref<HTMLDialogElement | null>(null);
onMounted(() => dlg.value?.showModal());
</script>

<template>
  <dialog ref="dlg" class="dlg narrow" data-test="confirm" @cancel.prevent="emit('cancel')">
    <div class="dlg-head"><div class="titles"><h2>{{ title }}</h2></div></div>
    <div class="dlg-body">
      <p v-for="t in body" :key="t">{{ t }}</p>
    </div>
    <div class="dlg-foot">
      <button type="button" class="btn" @click="emit('cancel')">取消</button>
      <button type="button" class="btn" :class="danger ? 'danger solid' : 'primary'" data-test="confirm-ok" @click="emit('ok')">{{ ok }}</button>
    </div>
  </dialog>
</template>
