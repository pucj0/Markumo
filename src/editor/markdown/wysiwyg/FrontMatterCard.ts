import { parseFrontMatter, updateFrontMatterField, type ParsedFrontMatter } from '../frontmatter/frontMatterParser'

export function renderFrontMatterCard(
  container: HTMLElement,
  yamlSource: string,
  onUpdateSource: (newYaml: string) => void,
  onOpenSource: () => void,
  readOnly: boolean = false
) {
  container.replaceChildren()
  container.className = 'md-frontmatter-card'

  const parsed: ParsedFrontMatter = parseFrontMatter(yamlSource)

  // Card Header
  const header = document.createElement('div')
  header.className = 'md-frontmatter-header'

  const titleGroup = document.createElement('div')
  titleGroup.className = 'md-frontmatter-title-group'
  titleGroup.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="md-frontmatter-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg><span>元数据 (Front Matter)</span>`

  const actions = document.createElement('div')
  actions.className = 'md-frontmatter-actions'

  const copyBtn = document.createElement('button')
  copyBtn.type = 'button'
  copyBtn.className = 'md-frontmatter-btn'
  copyBtn.title = '复制原始 YAML'
  copyBtn.textContent = '复制'
  copyBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard?.writeText(yamlSource)
    copyBtn.textContent = '已复制'
    setTimeout(() => { copyBtn.textContent = '复制' }, 1500)
  }

  const rawBtn = document.createElement('button')
  rawBtn.type = 'button'
  rawBtn.className = 'md-frontmatter-btn md-frontmatter-edit-raw'
  rawBtn.title = '编辑原始 YAML 源码'
  rawBtn.textContent = '编辑源码'
  rawBtn.onclick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onOpenSource()
  }

  actions.append(copyBtn, rawBtn)
  header.append(titleGroup, actions)
  container.append(header)

  if (!parsed.valid) {
    const errorEl = document.createElement('div')
    errorEl.className = 'md-frontmatter-error'
    errorEl.textContent = `YAML 解析提示：${parsed.error || '语法不规范，点击“编辑源码”进行调整'}`
    container.append(errorEl)
    return
  }

  // Visual Body
  const body = document.createElement('div')
  body.className = 'md-frontmatter-body'

  // Field 1: Title
  const titleRow = document.createElement('div')
  titleRow.className = 'md-frontmatter-row'
  const titleLabel = document.createElement('span')
  titleLabel.className = 'md-frontmatter-field-label'
  titleLabel.textContent = '标题'
  const titleVal = document.createElement('input')
  titleVal.type = 'text'
  titleVal.className = 'md-frontmatter-input md-frontmatter-title-input'
  titleVal.value = parsed.title || ''
  titleVal.placeholder = '（未设置文档标题）'
  titleVal.disabled = readOnly
  titleVal.onchange = () => {
    const nextYaml = updateFrontMatterField(yamlSource, 'title', titleVal.value.trim())
    if (nextYaml !== yamlSource) onUpdateSource(nextYaml)
  }
  titleRow.append(titleLabel, titleVal)
  body.append(titleRow)

  // Field 2: Tags
  if (parsed.tags.length > 0 || !readOnly) {
    const tagsRow = document.createElement('div')
    tagsRow.className = 'md-frontmatter-row'
    const tagsLabel = document.createElement('span')
    tagsLabel.className = 'md-frontmatter-field-label'
    tagsLabel.textContent = '标签'
    const tagsWrap = document.createElement('div')
    tagsWrap.className = 'md-frontmatter-tags'

    for (const tag of parsed.tags) {
      const tagBadge = document.createElement('span')
      tagBadge.className = 'md-frontmatter-tag-badge'
      tagBadge.textContent = `#${tag}`
      tagsWrap.append(tagBadge)
    }

    if (!parsed.tags.length) {
      const emptyTag = document.createElement('span')
      emptyTag.className = 'md-frontmatter-empty'
      emptyTag.textContent = '（无标签）'
      tagsWrap.append(emptyTag)
    }

    tagsRow.append(tagsLabel, tagsWrap)
    body.append(tagsRow)
  }

  // Field 3: Status / Dates / Others
  const metaRow = document.createElement('div')
  metaRow.className = 'md-frontmatter-row md-frontmatter-meta-row'

  if (parsed.status) {
    const statusWrap = document.createElement('span')
    statusWrap.className = 'md-frontmatter-meta-item'
    statusWrap.innerHTML = `<strong>状态:</strong> <span class="md-frontmatter-status-val">${parsed.status}</span>`
    metaRow.append(statusWrap)
  }

  if (parsed.created) {
    const createdWrap = document.createElement('span')
    createdWrap.className = 'md-frontmatter-meta-item'
    createdWrap.innerHTML = `<strong>创建:</strong> ${parsed.created}`
    metaRow.append(createdWrap)
  }

  if (parsed.otherCount > 0) {
    const otherWrap = document.createElement('span')
    otherWrap.className = 'md-frontmatter-meta-item md-frontmatter-others'
    otherWrap.textContent = `+${parsed.otherCount} 个自定义属性`
    metaRow.append(otherWrap)
  }

  if (metaRow.children.length > 0) {
    body.append(metaRow)
  }

  container.append(body)
}
