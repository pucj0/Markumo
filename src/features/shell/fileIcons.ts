export type FileIconTone = 'blue' | 'cyan' | 'green' | 'amber' | 'orange' | 'pink' | 'purple' | 'red' | 'gray'
export interface FileIconDefinition { id: string; label: string; tone: FileIconTone; paths: readonly string[]; monogram?: string }
const icon = (id: string, label: string, tone: FileIconTone, paths: string[], monogram?: string): FileIconDefinition => ({ id,label,tone,paths,monogram })
/** Local vector glyphs: no icon font, network requests, or language-loader coupling. */
export const fileIcons = {
  text: icon('text','纯文本','gray',['M6 3.5h8l4 4V20H6Z M14 3.5V8h4 M9 12h6 M9 15h6']),
  unknown: icon('unknown','文件','gray',['M6 3.5h8l4 4V20H6Z M14 3.5V8h4 M9 13h6 M9 16h4']),
  markdown: icon('markdown','Markdown','purple',['M3.5 16V7l4 5 4-5v9 M15 12l3 3 3-3 M18 6v9']),
  javascript: icon('javascript','JavaScript','amber',[], 'JS'),
  typescript: icon('typescript','TypeScript','blue',[], 'TS'),
  react: icon('react','React JSX','cyan',['M12 4.5c-3 0-3 15 0 15s3-15 0-15 M5.5 8.2c-1.5 2.6 11.5 10.1 13 7.5s-11.5-10.1-13-7.5 M5.5 15.7c1.5 2.6 14.5-4.9 13-7.5s-14.5 4.9-13 7.5 M11.5 12h1']),
  reactTs: icon('react-ts','React TSX','blue',['M12 4.5c-3 0-3 15 0 15s3-15 0-15 M5.5 8.2c-1.5 2.6 11.5 10.1 13 7.5s-11.5-10.1-13-7.5 M5.5 15.7c1.5 2.6 14.5-4.9 13-7.5s-14.5 4.9-13 7.5 M11.5 12h1']),
  vue: icon('vue','Vue','green',['M3 6h4l5 9 5-9h4L12 21Z M7 6h3l2 3.5L14 6h3']),
  html: icon('html','HTML','orange',['m8 7-5 5 5 5 M16 7l5 5-5 5 M14 5l-4 14']),
  css: icon('css','CSS','blue',['M5 4h14l-1.5 15L12 21l-5.5-2Z M9 8h7l-.5 4H10l.3 3 2 1 2.2-.8']),
  sass: icon('sass','Sass / Less','pink',['M5 16c-1-4 7-4 6 0s-6 3-5 0 M6 11c13-1 12-9 6-6S5 10 10 13s8 5 9 0']),
  python: icon('python','Python','amber',['M12 3H8a3 3 0 0 0-3 3v4h8v3H6a3 3 0 0 1-3-3V8 M12 21h4a3 3 0 0 0 3-3v-4h-8v-3h7a3 3 0 0 1 3 3v2 M8 6h.1 M16 18h.1']),
  go: icon('go','Go','cyan',['M2.5 8h4 M1.5 11h3 M2.5 14h3'],'GO'),
  rust: icon('rust','Rust','orange',['M9 4l1-2h4l1 2 2 1 2-.2 2 3-1.1 2v3l1.1 2-2 3-2-.2-2 1-1 2h-4l-1-2-2-1-2 .2-2-3 1.1-2v-3L3 8l2-3 2 .2Z'],'R'),
  json: icon('json','JSON','green',['M9 4H7v5l-3 3 3 3v5h2 M15 4h2v5l3 3-3 3v5h-2 M11 10h.1 M13 14h.1']),
  jsonc: icon('jsonc','JSON with Comments','green',['M9 4H7v5l-3 3 3 3v5h2 M15 4h2v5l3 3-3 3v5h-2 M13 8l-2 8']),
  yaml: icon('yaml','YAML','pink',['m5 5 2 2-2 2-2-2Z M11 7h9 m-15 4 2 2-2 2-2-2Z M11 13h9 m-15 4 2 2-2 2-2-2Z M11 19h6']),
  toml: icon('toml','TOML','pink',['M7 4H4v16h3 M17 4h3v16h-3 M9 8h6 M12 8v8']),
  config: icon('config','配置文件','gray',['M4 6h16 M4 12h16 M4 18h16 M9 4v4 M15 10v4 M8 16v4']),
  xml: icon('xml','XML','cyan',['m8 6-5 6 5 6 M16 6l5 6-5 6 M14 7l-4 10']),
  sql: icon('sql','SQL / 数据库','purple',['M4 6a8 3 0 1 0 16 0 8 3 0 1 0-16 0 M4 6v12c0 4 16 4 16 0V6 M4 12c0 4 16 4 16 0']),
  csv: icon('csv','CSV / 表格','green',['M4 4h16v16H4Z M4 9h16 M4 14h16 M9 4v16 M15 4v16']),
  log: icon('log','日志','gray',['M4 5h13 M4 10h9 M4 15h6 M16 13v4l3 1 M11 17a6 6 0 1 0 12 0 6 6 0 1 0-12 0']),
  batch: icon('batch','Windows Batch','blue',['M3 5h18v14H3Z M7 9l3 3-3 3 M13 15h4']),
  shell: icon('shell','Shell 脚本','green',['m5 6 6 6-6 6 M13 18h7']),
  powershell: icon('powershell','PowerShell','blue',['M7 4h15l-5 16H2Z M9 8l5 4-7 4 M13 17h4']),
  java: icon('java','Java / JVM 字节码','orange',['M6 11h11v4a5.5 5.5 0 0 1-11 0Z M17 11h2a2 2 0 0 1 0 4h-2 M5 21h14 M10 8c-4-4 5-4 1-8 M14 8c-3-2 3-3 2-5']),
  c: icon('c','C','blue',[], 'C'),
  cpp: icon('cpp','C++','blue',[], 'C++'),
  csharp: icon('csharp','C#','purple',[], 'C#'),
  kotlin: icon('kotlin','Kotlin','purple',['M5 4v16h14L5 7 M5 12l14-8H5']),
  swift: icon('swift','Swift','orange',['M4 6l10 7-5-9 9 9c1-3 0-6-2-9 7 5 7 12 4 15l1 3-4-2C9 23 3 16 3 12l8 5Z']),
  ruby: icon('ruby','Ruby','red',['m7 4 10 0 5 6-10 11L2 10Z M2 10h20 M7 4l-1 6 6 11 6-11-1-6 M6 10l6-6 6 6']),
  php: icon('php','PHP','purple',[], 'PHP'),
  dart: icon('dart','Dart','cyan',['M4 8l4-4h7l6 6v11H10l-6-6Z M8 4l13 17 M4 8l6 2 5 11']),
  svelte: icon('svelte','Svelte','orange',['M18 4c-5-4-16 5-12 9l4 3 M6 20c5 4 16-5 12-9l-4-3 M8 13l8-6 M8 17l8-6']),
  graphql: icon('graphql','GraphQL','pink',['m12 3 8 4.5v9L12 21l-8-4.5v-9Z M12 3l8 13.5H4Z M4 7.5l8 13.5 8-13.5']),
  docker: icon('docker','Docker','cyan',['M3 12h17c0 9-14 11-17 0Z M5 8h4v4H5Z M10 8h4v4h-4Z M15 8h4v4h-4Z M10 3h4v4h-4Z M20 9l2 1-2 3']),
  git: icon('git','Git 配置','red',['m12 2 10 10-10 10L2 12Z M8 8l8 8 M8 8v7 M8 7v2 M8 14v2 M15 15h2']),
  package: icon('package','依赖清单','green',['m12 3 9 5v10l-9 5-9-5V8Z M3 8l9 5 9-5 M12 13v10 M7 5.8l9 5V16']),
  lock: icon('lock','依赖锁文件','amber',['M6 10h12v11H6Z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3']),
  env: icon('env','环境变量','green',['M5 4v16 M19 4v16 M5 8h14 M5 16h14 M10 5l-1 14 M15 5l-1 14']),
  license: icon('license','许可证','amber',['M7 4h10l4 8-4 7H7l-4-7Z M8 11l3 3 5-6']),
  readme: icon('readme','README','blue',['M3 5c4-2 6-1 9 1 3-2 5-3 9-1v15c-4-2-6-1-9 1-3-2-5-3-9-1Z M12 6v15']),
  image: icon('image','图片','cyan',['M3 4h18v16H3Z M3 17l6-7 4 5 3-3 5 6 M15 7h.1']),
  vector: icon('vector','SVG / 矢量图','green',['M4 18C4 4 20 4 20 18 M3 4h4v4H3Z M17 4h4v4h-4Z M2 17h4v4H2Z M18 17h4v4h-4Z M7 6h10']),
  archive: icon('archive','压缩包','amber',['M5 3h14v18H5Z M11 3v3h3v3h-3v3h3v3h-3 M10 17h4v3h-4Z']),
  audio: icon('audio','音频','pink',['M9 17V6l11-3v11 M9 9l11-3 M9 17c0 4-7 4-7 1s7-4 7-1 M20 14c0 4-7 4-7 1s7-4 7-1']),
  video: icon('video','视频','purple',['M3 4h18v16H3Z M9 8l7 4-7 4Z']),
  font: icon('font','字体','purple',['m3 19 5-14 5 14 M5 14h6 M15 10h6 M18 10v9']),
  pdf: icon('pdf','PDF','red',['M6 3h8l4 4v14H6Z M14 3v5h4 M7 17c8-1 6-12 4-8s7 7 5 7-8-4-9 1Z']),
  binary: icon('binary','二进制文件','gray',['M4 4h6v7H4Z M7 14v7 M4 21h6 M16 3v8 M13 11h6 M13 15h6v6h-6Z']),
} satisfies Record<string, FileIconDefinition>

type IconId = keyof typeof fileIcons
const extensions: Record<string,IconId> = {}
function register(id: IconId, names: string) { for(const name of names.split(' '))extensions[name]=id }
register('text','txt text rtf')
register('markdown','md markdown mdx mdown mkd')
register('javascript','js mjs cjs')
register('typescript','ts mts cts')
register('react','jsx');register('reactTs','tsx');register('vue','vue')
register('html','html htm xhtml');register('css','css');register('sass','scss sass less styl')
register('python','py pyi pyw ipynb');register('go','go');register('rust','rs')
register('json','json');register('jsonc','jsonc');register('yaml','yaml yml');register('toml','toml')
register('config','ini cfg conf config properties editorconfig')
register('xml','xml xsd xsl xslt plist pom csproj fsproj vbproj props targets resx')
register('sql','sql sqlite sqlite3 db');register('csv','csv tsv xls xlsx ods');register('log','log out trace')
register('batch','bat cmd');register('shell','sh bash zsh fish');register('powershell','ps1 psm1 psd1')
register('java','java class jar');register('c','c h');register('cpp','cpp cc cxx c++ hpp hh hxx');register('csharp','cs csx')
register('kotlin','kt kts');register('swift','swift');register('ruby','rb erb rake');register('php','php phtml')
register('dart','dart');register('svelte','svelte');register('graphql','graphql gql')
register('image','png jpg jpeg gif webp avif bmp ico tif tiff heic');register('vector','svg svgz')
register('archive','zip 7z rar gz bz2 xz tar tgz zst');register('audio','mp3 wav flac ogg m4a aac opus')
register('video','mp4 mkv mov avi webm m4v');register('font','ttf otf woff woff2');register('pdf','pdf')
register('binary','exe dll bin dat wasm so dylib o obj lib a pdb');register('lock','lock')
const filenames: Record<string,IconId> = {
  'package.json':'package','package-lock.json':'lock','pnpm-lock.yaml':'lock','yarn.lock':'lock','bun.lock':'lock','bun.lockb':'lock',
  'cargo.toml':'rust','cargo.lock':'lock','go.mod':'go','go.sum':'lock','gemfile':'ruby','gemfile.lock':'lock',
  'dockerfile':'docker','containerfile':'docker','docker-compose.yml':'docker','docker-compose.yaml':'docker','compose.yml':'docker','compose.yaml':'docker',
  '.gitignore':'git','.gitattributes':'git','.gitmodules':'git','.gitkeep':'git',
  '.editorconfig':'config','.npmrc':'config','.prettierrc':'config','.eslintrc':'config',
  'makefile':'config','cmakelists.txt':'config','justfile':'config',
}
export function fileIconFor(path: string): FileIconDefinition {
  const name=(path.split(/[\\/]/).pop() || '').toLowerCase()
  if(Object.prototype.hasOwnProperty.call(filenames,name))return fileIcons[filenames[name]]
  if(name==='.env'||name.startsWith('.env.'))return fileIcons.env
  if(/^readme(?:\.|$)/.test(name))return fileIcons.readme
  if(/^(?:license|licence|copying)(?:\.|$)/.test(name))return fileIcons.license
  if(/^dockerfile\./.test(name))return fileIcons.docker
  if(/^(?:tsconfig|jsconfig)(?:\.[^.]+)*\.json$/.test(name))return fileIcons.typescript
  const ext=name.includes('.')?name.slice(name.lastIndexOf('.')+1):''
  return fileIcons[Object.prototype.hasOwnProperty.call(extensions,ext)?extensions[ext]:'unknown']
}
