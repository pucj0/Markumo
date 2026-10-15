import { GFM } from '@lezer/markdown'
/** One policy for the source parser and read-only renderer. */
export const markdownSyntaxExtensions = [GFM]
export const markdownSemantics = { html:false, breaks:true, linkify:true, typographer:false } as const
