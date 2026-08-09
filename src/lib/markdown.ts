import { marked } from 'marked'
import DOMPurify from 'dompurify'

const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|zdn-img):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i

export async function renderMarkdown(markdown: string): Promise<string> {
  const html = await marked.parse(markdown || '')
  return DOMPurify.sanitize(html, { ALLOWED_URI_REGEXP })
}
