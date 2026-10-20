<template>
  <svg
    class="md-toolbar-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(path, index) in paths[name] || []" :key="index" :d="path" />
  </svg>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number }>(), { size: 17 })

// Small, dependency-free Lucide-style set used by the native toolbar. Paths use
// a 24px grid and the same rounded 1.8px stroke as the rest of Markumo's chrome.
const paths: Record<string, string[]> = {
  heading: ['M6 4v16', 'M18 4v16', 'M6 12h12'],
  paragraph: ['M13 4v16', 'M17 4v16', 'M19 4H9.5a4.5 4.5 0 0 0 0 9H13'],
  bold: ['M7 5h6a4 4 0 0 1 0 8H7z', 'M7 13h7a4 4 0 0 1 0 8H7z'],
  italic: ['M19 4h-9', 'M14 20H5', 'M15 4 9 20'],
  strike: ['M16 4H9a3 3 0 0 0-2.83 3', 'M14 20H8a3 3 0 0 1-2.83-3', 'M4 12h16'],
  'inline-code': ['m16 18 6-6-6-6', 'M8 6l-6 6 6 6'],
  'list-ordered': ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M4 6h1v4', 'M4 16h2', 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1'],
  'list-bullet': ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  'list-task': ['M10 6h11', 'M10 12h11', 'M10 18h11', 'M3 6l1.5 1.5L7 5', 'M3 12l1.5 1.5L7 11', 'M3 18l1.5 1.5L7 17'],
  quote: ['M4 5h16', 'M4 19h16', 'M8 9h8', 'M8 13h5'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  image: ['M4 5h16v14H4z', 'M8 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4', 'm20 15-4.5-4.5L6 20'],
  table: ['M4 5h16v14H4z', 'M4 10h16', 'M4 15h16', 'M10 5v14', 'M16 5v14'],
  'code-block': ['M4 5h16v14H4z', 'm9 10-3 2 3 2', 'm15 10 3 2-3 2'],
  sigma: ['M18 7V4H6l6 8-6 8h12v-3'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'm20 20-4-4'],
  width: ['M4 12h16', 'm8 8-4 4 4 4', 'm16 8 4 4-4 4'],
  live: ['M12 6c-4 0-7 3-9 6 2 3 5 6 9 6s7-3 9-6c-2-3-5-6-9-6', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4'],
  source: ['m8 6-6 6 6 6', 'm16 6 6 6-6 6', 'm14 3-4 18'],
  split: ['M4 5h16v14H4z', 'M12 5v14'],
  outline: ['M4 6h6', 'M4 12h10', 'M4 18h14', 'M18 6h2', 'M16 12h4', 'M20 18h0'],
  'chevron-up': ['m6 15 6-6 6 6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  check: ['m5 12 4 4L19 7'],
  'width-narrow': ['M9 4v16', 'M15 4v16', 'M4 8l2-2 2 2', 'M20 8l-2-2-2 2'],
}
</script>
