<script setup lang="ts">
/** 密码输入框：带「显示 / 隐藏」，不让浏览器记住或填充（见 inputs.ts） */
import { computed, ref } from 'vue';
import { canMask, noFill } from '../inputs.ts';

const model = defineModel<string>({ required: true });
defineProps<{ placeholder?: string; testId?: string }>();
const emit = defineEmits<{ enter: [] }>();

const shown = ref(false);
/** 中文输入法开着的时候，打出来的会是拼音候选，提醒切换 */
const composing = ref(false);
const type = computed(() => (shown.value || canMask ? 'text' : 'password'));
const attrs = computed(() => (canMask ? noFill : { ...noFill, autocomplete: 'new-password' }));
</script>

<template>
  <span class="input pw">
    <input
      v-model="model"
      v-bind="attrs"
      :type="type"
      :class="{ masked: canMask && !shown }"
      :data-test="testId"
      :placeholder="placeholder"
      @keydown.enter="emit('enter')"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <button type="button" class="pw-eye" :aria-label="shown ? '隐藏密码' : '显示密码'" @click="shown = !shown">{{ shown ? '隐藏' : '显示' }}</button>
  </span>
  <small v-if="composing" class="hint warn-text">现在是中文输入法，请切换到英文再输入密码</small>
</template>
