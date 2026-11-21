<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { answerConfirm, useConfirm } from '../composables/useConfirm.ts';

const state = useConfirm();
const dlg = ref<HTMLDialogElement | null>(null);

watch(() => state.current, async (c) => {
  await nextTick();
  if (c && dlg.value && !dlg.value.open) dlg.value.showModal();
  if (!c && dlg.value?.open) dlg.value.close();
});
</script>

<template>
  <dialog ref="dlg" class="dlg" data-test="confirm" @cancel.prevent="answerConfirm(false)">
    <template v-if="state.current">
      <h2>{{ state.current.title }}</h2>
      <p v-for="t in state.current.body" :key="t">{{ t }}</p>
      <div class="dlg-foot">
        <button type="button" class="btn ghost" @click="answerConfirm(false)">取消</button>
        <button type="button" class="btn" :class="state.current.danger ? 'danger' : 'primary'" data-test="confirm-ok" @click="answerConfirm(true)">{{ state.current.ok }}</button>
      </div>
    </template>
  </dialog>
</template>
