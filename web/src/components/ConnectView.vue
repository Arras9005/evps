<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { splitTarget } from '../api.ts';
import AppIcon from './AppIcon.vue';
import StepsBar from './StepsBar.vue';

/** 表单内容放在 App 里：安装没连上退回来时，填过的都还在 */
export interface Draft {
  host: string;
  port: string;
  user: string;
  password: string;
  remember: boolean;
  error: string | null;
}

const props = defineProps<{ draft: Draft }>();
const emit = defineEmits<{ submit: [] }>();

const d = props.draft;
const showPassword = ref(false);
const advanced = ref(d.port !== '22' || d.user !== 'root');
const hostInput = ref<HTMLInputElement | null>(null);

const advSummary = computed(() => `SSH 端口 ${d.port || '22'} · 用户名 ${d.user || 'root'}`);

/** 粘贴 root@1.2.3.4:2222 这类写法时，自动拆到三个框里 */
function onHostBlur(): void {
  const t = splitTarget(d.host);
  d.host = t.host;
  if (t.port !== null) d.port = String(t.port);
  if (t.user !== null) d.user = t.user;
  if (d.port !== '22' || d.user !== 'root') advanced.value = true;
}

function validate(): string | null {
  onHostBlur();
  if (!d.host) return '请填服务器 IP';
  const p = Number(d.port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return 'SSH 端口是 1 到 65535 的数字，不知道就填 22';
  if (!/^[a-z_][a-z0-9_.-]{0,31}$/i.test(d.user.trim())) return 'SSH 用户名不对，一般是 root';
  if (!d.password) return '请填 root 密码（买服务器时服务商给的）';
  return null;
}

async function submit(): Promise<void> {
  d.error = validate();
  if (d.error) {
    if (!d.host) {
      await nextTick();
      hostInput.value?.focus();
    }
    return;
  }
  emit('submit');
}
</script>

<template>
  <section class="page">
    <StepsBar :at="1" />
    <h1 class="title">连接你的服务器</h1>
    <p class="lead sm">在服务商后台能找到 IP 和 root 密码</p>

    <form class="card form" novalidate @submit.prevent="submit" @input="d.error = null">
      <label class="field">
        <span class="field-label">服务器 IP</span>
        <input ref="hostInput" v-model="d.host" class="input" data-test="host" autocomplete="off" spellcheck="false" placeholder="例如 203.0.113.7" @blur="onHostBlur" />
        <small class="hint">直接粘贴 root@IP:端口 也行</small>
      </label>

      <label class="field">
        <span class="field-label">{{ d.user && d.user !== 'root' ? `${d.user} 的密码` : 'root 密码' }}</span>
        <span class="input pw">
          <input v-model="d.password" data-test="password" :type="showPassword ? 'text' : 'password'" autocomplete="off" placeholder="买服务器时服务商给的密码" />
          <button type="button" class="pw-eye" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">{{ showPassword ? '隐藏' : '显示' }}</button>
        </span>
      </label>

      <div v-show="advanced" class="field-row">
        <label class="field">
          <span class="field-label">SSH 端口</span>
          <input v-model="d.port" class="input" data-test="port" inputmode="numeric" autocomplete="off" />
          <small class="hint">不知道就填 22</small>
        </label>
        <label class="field">
          <span class="field-label">SSH 用户名</span>
          <input v-model="d.user" class="input" data-test="user" autocomplete="off" spellcheck="false" />
          <small class="hint">一般是 root</small>
        </label>
      </div>

      <label class="check">
        <input v-model="d.remember" type="checkbox" data-test="remember" />
        <span>
          记住这台服务器，下次不用再输密码
          <small class="hint">会在服务器上放一把 evps 专用的登录公钥，卸载面板时自动删掉</small>
        </span>
      </label>

      <div v-if="d.error" class="tip bad" role="alert" data-test="form-error"><span class="tip-ic">!</span><div>{{ d.error }}</div></div>

      <button type="submit" class="btn primary xl block" data-test="install">连接并安装</button>
      <button v-if="!advanced" type="button" class="linkbtn quiet center-block" data-test="advanced" @click="advanced = true">高级：{{ advSummary }} <AppIcon name="chevron" /></button>
    </form>
    <p class="safe"><AppIcon name="shield" />密码只在这台电脑上用来登录，不保存、不上传</p>
  </section>
</template>
