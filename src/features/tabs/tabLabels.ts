import { displayPathKey, readablePath } from '../shell/pathDisplay'

export interface TabIdentity { id: string; name: string; path: string }

/** Only names and paths participate; typing/dirty/activation never changes labels. */
export function tabLabels(documents: readonly TabIdentity[]): Map<string, string> {
  const labels = new Map<string, string>(), groups = new Map<string, TabIdentity[]>()
  for (const doc of documents) {
    const key = doc.name.toLocaleLowerCase()
    const group = groups.get(key) || []
    group.push(doc); groups.set(key, group); labels.set(doc.id, doc.name)
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const paths = group.map(doc => readablePath(doc.path).replace(/\\/g, '/').split('/').filter(Boolean))
    for (let index = 0; index < group.length; index++) {
      const doc = group[index], parts = paths[index]
      let label = doc.name
      if (!parts.length) label += ` · ${doc.id}`
      else {
        const windows = /^[a-z]:[\\/]|^\\\\|^\/\//i.test(readablePath(doc.path))
        const key = (value: string) => windows ? value.toLocaleLowerCase() : value
        let count = 2
        while (count < parts.length && paths.some((other, at) => at !== index && key(other.slice(-count).join('/')) === key(parts.slice(-count).join('/')))) count++
        label = parts.slice(-count).join('/')
        if (group.some((other, at) => at !== index && displayPathKey(other.path) === displayPathKey(doc.path))) label += ` · ${doc.id}`
      }
      labels.set(doc.id, label)
    }
  }
  return labels
}
