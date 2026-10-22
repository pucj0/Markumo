import { ref, nextTick } from 'vue'

// Both shell dialogs share focus ownership and keyboard containment.
export function useModal() {
  const visible = ref(false)
  const dialogRef = ref<HTMLElement | null>(null)
  let previousFocus: HTMLElement | null = null

  function open() {
    if (!visible.value) previousFocus = document.activeElement as HTMLElement | null
    visible.value = true
    nextTick(() => {
      if (visible.value) dialogRef.value?.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')?.focus()
    })
  }

  function close() {
    if (!visible.value) return
    visible.value = false
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    previousFocus = null
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      const controls = Array.from(dialogRef.value?.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)') || [])
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  return { visible, dialogRef, open, close, handleKeydown }
}
