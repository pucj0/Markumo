<template>
  <Transition name="toast">
    <div v-if="visible" class="toast" role="status">
      {{ message }}
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onUnmounted } from 'vue'

const visible = ref(false)
const message = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

function show(msg: string, duration = 2800) {
  message.value = msg
  visible.value = true
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    visible.value = false
  }, duration)
}

defineExpose({ show })
onUnmounted(() => { if (timer) clearTimeout(timer) })
</script>

<style scoped>
.toast {
  max-width: calc(100vw - 32px);
  position: fixed;
  left: 50%;
  bottom: 34px;
  transform: translateX(-50%);
  background: var(--paper);
  color: var(--bright);
  padding: 8px 16px;
  border-radius: 9px;
  font-size: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
  border: 1px solid var(--line);
  z-index: 1000;
  pointer-events: none;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
</style>
