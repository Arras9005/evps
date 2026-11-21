<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { splitTarget } from '../api.ts';
import { noFill } from '../inputs.ts';
import AppIcon from './AppIcon.vue';
import SecretInput from './SecretInput.vue';
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
const hostInput = ref<HTMLInputElement | null>(null);

/** 粘贴 root@1.2.3.4:2222 这类写法时，自动拆到三个框里 */
function onHostBlur(): void {
  const t = splitTarget(d.host);
  d.host = t.host;
  if (t.port !== null) d.port = String(t.port);
  if (t.user !== null) d.user = t.user;
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

/** 在输入框里按回车就提交；焦点在按钮上时回车本身会触发按钮点击，这里不再重复提交 */
function onEnter(e: KeyboardEvent): void {
  if ((e.target as HTMLElement | null)?.tagName === 'BUTTON' || e.isComposing) return;
  void submit();
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

    <!-- 让用户放心的关键：密码不离开这台电脑 -->
    <div class="trust" data-test="trust">
      <span class="trust-ic"><AppIcon name="shield" /></span>
      <div>
        <p class="trust-title">密码只在你这台电脑上使用</p>
        <p class="trust-sub">evps 直接从你的电脑登录服务器，不保存密码，也不上传到任何地方</p>
      </div>
    </div>

    <!-- 不用 <form>：浏览器看到表单提交会弹「要保存密码吗」 -->
    <div class="card form" @input="d.error = null" @keydown.enter="onEnter">
      <!-- 两行排：左边是必填的 IP、密码，右边是一般不用改的端口、用户名。一屏放得下，不用滚动 -->
      <div class="field-row main-side">
        <label class="field">
          <span class="field-label">服务器 IP</span>
          <input ref="hostInput" v-model="d.host" v-bind="noFill" class="input" data-test="host" placeholder="例如 203.0.113.7" @blur="onHostBlur" />
        </label>
        <label class="field">
          <span class="field-label">SSH 端口</span>
          <input v-model="d.port" v-bind="noFill" class="input" data-test="port" inputmode="numeric" />
        </label>
      </div>

      <div class="field-row main-side">
        <label class="field">
          <span class="field-label">{{ d.user && d.user !== 'root' ? `${d.user} 的密码` : 'root 密码' }}</span>
          <SecretInput v-model="d.password" test-id="password" placeholder="服务商给的密码" />
        </label>
        <label class="field">
          <span class="field-label">SSH 用户名</span>
          <input v-model="d.user" v-bind="noFill" class="input" data-test="user" />
        </label>
      </div>

      <label class="check">
        <input v-model="d.remember" type="checkbox" data-test="remember" />
        <span>记住这台服务器，下次不用再输密码</span>
      </label>

      <Transition name="fade">
        <div v-if="d.error" class="tip bad" role="alert" data-test="form-error"><span class="tip-ic">!</span><div>{{ d.error }}</div></div>
      </Transition>

      <button type="button" class="btn primary xl block" data-test="install" @click="submit">连接并安装</button>
    </div>
  </section>
</template>
