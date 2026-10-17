import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'
const markdown = new MarkdownIt({html:false,linkify:false,breaks:true})
export function safeReleaseNotes(notes:string):string {
  return DOMPurify.sanitize(markdown.render(notes.slice(0,65536)),{
    ALLOWED_TAGS:['h1','h2','h3','h4','p','ul','ol','li','strong','em','code','pre','blockquote','a','br','hr'],
    ALLOWED_ATTR:['href','title'], ALLOW_DATA_ATTR:false,
  })
}
