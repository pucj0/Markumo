<template>
  <svg
    class="icon"
    :class="[customClass, { 'small-icon': size === 'small' }]"
    aria-hidden="true"
    viewBox="0 0 24 24"
  >
    <template v-if="name === 'files'">
      <rect x="5" y="3" width="15" height="18" rx="2" />
      <path d="M9 7h7M9 11h7M9 15h4" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </template>
    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>
    <template v-else-if="name === 'split'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
    </template>
    <template v-else-if="name === 'panel'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M8 4v16" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M20 15a8 8 0 1 1-11-11 7 7 0 0 0 11 11Z" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </template>
    <template v-else-if="name === 'gear'">
      <circle cx="12" cy="12" r="3" />
      <path d="m9.5 3-1 2-2 .6-2-1-2 3 1.4 1.6-.2 2.2L2 13l1.8 3 2-.2 1.8 1.2.4 2.2 3.5 1 1-2 2-.6 2 1 2-3-1.4-1.6.2-2.2L20 10l-1.8-3-2 .2-1.8-1.2L14 3.8Z" />
    </template>
    <template v-else-if="name === 'outline'">
      <path d="M4 6h16M4 12h10M4 18h14" />
    </template>
    <template v-else-if="name === 'open'">
      <path d="M4 19V5h6l2 2h8v12Z" />
      <path d="M12 13h6m-3-3 3 3-3 3" />
    </template>
    <template v-else-if="name === 'wrap'">
      <path d="M3 6h18M3 11h13a3 3 0 1 1 0 6H9m3-3-3 3 3 3" />
    </template>
    <template v-else-if="name === 'max'">
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </template>
    <template v-else-if="name === 'close'">
      <path d="M18 6 6 18M6 6l12 12" />
    </template>
    <template v-else-if="name === 'chevron-right'">
      <path d="m9 18 6-6-6-6" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <path d="m6 9 6 6 6-6" />
    </template>
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  size?: 'normal' | 'small'
  customClass?: string
}>()
</script>
