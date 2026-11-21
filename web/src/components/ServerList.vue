<script setup lang="ts">
import { onMounted } from 'vue';
import { checkIfStale, healthOf, serverState, type Conn } from '../jobs.ts';
import AppIcon from './AppIcon.vue';
import StatusPill from './StatusPill.vue';

export interface ListedServer {
  key: string;
  conn: Conn;
  host: string;
  port: number;
  user: string;
  remembered: boolean;
}

const props = defineProps<{ servers: ListedServer[]; hasPromo: boolean }>();
const emit = defineEmits<{ open: [server: ListedServer]; add: []; need: [] }>();

onMounted(() => {
  for (const s of props.servers) checkIfStale(s.key, s.conn);
});

/** 名字下面的小字：只在出错、或者不是默认设置时才写 */
function sub(s: ListedServer): string {
  const st = serverState(s.key);
  if (healthOf(st) === 'unreachable') return st.error?.message ?? '连不上';
  return [s.user !== 'root' ? `用户 ${s.user}` : '', s.port !== 22 ? `SSH 端口 ${s.port}` : '', s.remembered ? '' : '没记住，关掉网页就忘'].filter(Boolean).join(' · ');
}
</script>

<template>
  <section class="page wide">
    <div class="list-head">
      <h1 class="title-left">我的服务器</h1>
      <button type="button" class="btn ghost sm" data-test="add" @click="emit('add')"><AppIcon name="plus" />添加服务器</button>
    </div>
    <ul class="srv-list">
      <li v-for="s in servers" :key="s.key">
        <button type="button" class="srv" data-test="server-row" @click="emit('open', s)">
          <span class="srv-main">
            <span class="srv-name">{{ s.host }}</span>
            <span v-if="sub(s)" class="srv-sub">{{ sub(s) }}</span>
          </span>
          <StatusPill :health="healthOf(serverState(s.key))" />
          <AppIcon name="chevron" class="rot srv-go" />
        </button>
      </li>
    </ul>

    <!-- 个人推荐：放在列表下面，不抢眼，想再买一台的时候看得到 -->
    <button v-if="hasPromo" type="button" class="promo-tip" data-test="need" @click="emit('need')">
      <span class="soft-badge">个人推荐</span>
      <span class="grow">想再买一台？看看我推荐的 VPS</span>
      <AppIcon name="chevron" class="rot" />
    </button>
  </section>
</template>
