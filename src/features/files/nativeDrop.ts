import type { NativeImageInput } from '../../editor/markdown/imageImport'

export interface NativeDropInput extends NativeImageInput { isDirectory?: boolean }

/** Directories always open as workspace roots, including names ending in .png.
 * Return only files to the existing file-open / Markdown image-import routing. */
export async function openDroppedDirectories(inputs: NativeDropInput[], open: (token: string) => Promise<boolean>): Promise<NativeDropInput[]> {
  for (const input of inputs) if (input.isDirectory) await open(input.token)
  return inputs.filter(input => !input.isDirectory)
}
