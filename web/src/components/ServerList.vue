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

function sub(s: ListedServer): string {
  const st = serverState(s.key);
  const h = healthOf(st);
  if (h === 'checking') return '正在连接服务器查看状态…';
  if (h === 'unreachable') return st.error?.message ?? '连不上';
  if (h === 'not-installed') return '还没装面板';
  const addr = st.result?.panel?.address;
  const extra = [s.user !== 'root' ? `用户 ${s.user}` : '', s.port !== 22 ? `SSH 端口 ${s.port}` : '', s.remembered ? '' : '没记住，关掉网页就忘'].filter(Boolean).join(' · ');
  return addr ? `面板 ${addr}${extra ? ' · ' + extra : ''}` : extra || 'SSH 端口 22';
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
          <span class="srv-ic"><AppIcon name="server" /></span>
          <span class="srv-main">
            <span class="srv-name">{{ s.host }}</span>
            <span class="srv-sub">{{ sub(s) }}</span>
          </span>
          <StatusPill :health="healthOf(serverState(s.key))" />
          <AppIcon name="chevron" class="rot srv-go" />
        </button>
      </li>
    </ul>
    <button v-if="hasPromo" type="button" class="linkbtn center-block" data-test="need" @click="emit('need')">还没有服务器？看看推荐 →</button>
  </section>
</template>
