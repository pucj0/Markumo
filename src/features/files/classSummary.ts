import type { ClassInfo } from './contracts'
/** Derived read-only inspection text, never original Java source or save data. */
export function classSummary(info: ClassInfo) {
  const lines = [`JVM ClassFile · 只读结构查看`, `类名：${info.className}`, `父类：${info.superName || '无'}`,
    `ClassFile 版本：${info.majorVersion}.${info.minorVersion}${info.minorVersion === 65535 ? '（Preview）' : ''}`,
    `访问标志：0x${info.accessFlags.toString(16).padStart(4,'0').toUpperCase()}`, `大小：${info.byteLength.toLocaleString()} 字节`,
    `接口：${info.interfaces.join(', ') || '无'}`, '', `字段 (${info.fieldsCount})`]
  for (const field of info.fields) lines.push(`  ${field.name}  ${field.descriptor}  [0x${field.flags.toString(16)}]`)
  lines.push('', `方法 (${info.methodsCount})`)
  for (const method of info.methods) lines.push(`  ${method.name}  ${method.descriptor}  [0x${method.flags.toString(16)}]`)
  lines.push('', `常量池 (${info.constantPoolCount} 个位置，Long/Double占两个位置)`)
  for (const value of info.constants) lines.push(`#${value.index.toString().padEnd(5)} ${value.tag.padEnd(20)} ${value.value.replace(/\r/g,'\\r').replace(/\n/g,'\\n').replace(/\0/g,'\\0')}`)
  if (info.displayTruncated) lines.push('', '结构展示已按数量截断；十六进制分页仍可查看全部文件字节。')
  lines.push('', '以上为安全结构解析，并非 Java 源码、反编译或 JVM 字节码验证；未加载或执行目标类。')
  return lines.join('\n')
}
