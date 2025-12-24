/**
 * Sub-Store Script (sing-box)
 * 作用：
 * 1) 從「訂閱/組合訂閱」產出 sing-box 節點（outbounds items）
 * 2) 把節點 tag 依規則插入到你 config 的指定 outbound(outbounds:[]) 裡（通常是 urltest）
 *
 * 參數：
 * - type: 组合订阅 / collection / 1  => collection；其他 => subscription
 * - name: 订阅或组合订阅名称
 * - url: 也可直接傳訂閱 URL（需 encodeURIComponent）
 * - outbound: 規則字串，用 🕳 分段；每段格式：
 *      🕳<outboundPattern>🏷<tagPattern>
 *   其中 ℹ️ 代表 ignoreCase；tagPattern 省略時默認 .*
 *
 * - includeUnsupportedProxy: true/false（包含 SSR 等）
 * - clearExisting: true/false（是否先清空目標 outbound.outbounds 再插入；默認 true）
 *
 * 例：
 * outbound=
 * 🕳ℹ️🇭🇰 HongKong🏷ℹ️港|hk|hongkong|kong kong|🇭🇰
 * 🕳ℹ️🇺🇸 United States🏷ℹ️美|us|unitedstates|united states|🇺🇸
 * 🕳ℹ️🇸🇬 Singapore🏷ℹ️^(?!.*(?:us)).*(新|sg|singapore|🇸🇬)
 * 🕳ℹ️🇯🇵 Japan🏷ℹ️日本|jp|japan|🇯🇵
 * 🕳ℹ️🇨🇳 Taiwan🏷ℹ️台|tw|taiwan|🇹🇼
 */

log(`🚀 开始`)

let { type, name, outbound, includeUnsupportedProxy, url, clearExisting } = $arguments
clearExisting = String(clearExisting ?? 'true').toLowerCase() !== 'false'

log(
  `传入参数 type: ${type}, name: ${name}, url: ${url ? '[provided]' : '[none]'}, outbound: ${
    outbound ? '[provided]' : '[none]'
  }, clearExisting: ${clearExisting}`
)

type = /^1$|col|组合/i.test(type) ? 'collection' : 'subscription'

const parser = ProxyUtils.JSON5 || JSON
log(`① 使用 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 解析配置文件`)

let config
try {
  config = parser.parse($content ?? $files[0])
} catch (e) {
  log(`${e.message ?? e}`)
  throw new Error(`配置文件不是合法的 ${ProxyUtils.JSON5 ? 'JSON5' : 'JSON'} 格式`)
}

if (!Array.isArray(config.outbounds)) config.outbounds = []

log(`② 获取订阅节点（sing-box outbounds）`)
let proxies
if (url) {
  log(`直接从 URL 读取订阅`)
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
    subscription: {
      name,
      url,
      source: 'remote',
    },
  })
} else {
  log(`将读取名称为 ${name} 的 ${type === 'collection' ? '组合' : ''}订阅`)
  proxies = await produceArtifact({
    name,
    type,
    platform: 'sing-box',
    produceType: 'internal',
    produceOpts: {
      'include-unsupported-proxy': includeUnsupportedProxy,
    },
  })
}

if (!Array.isArray(proxies)) proxies = []
log(`订阅产出节点数量: ${proxies.length}`)

log(`③ outbound 规则解析`)
if (!outbound || !String(outbound).trim()) {
  throw new Error(`缺少 outbound 参数：请用 🕳...🏷... 传入匹配规则`)
}

const rules = String(outbound)
  .split('🕳')
  .filter(Boolean)
  .map(seg => {
    const [outboundPattern, tagPattern = '.*'] = seg.split('🏷')
    const outboundRegex = createRegExp(outboundPattern)
    const tagRegex = createRegExp(tagPattern)
    log(`规则：🕳 ${outboundRegex}  <= 🏷 ${tagRegex}`)
    return { outboundRegex, tagRegex }
  })

log(`④ 插入节点 tag 到目标 outbound.outbounds`)
for (const ob of config.outbounds) {
  for (const { outboundRegex, tagRegex } of rules) {
    if (!outboundRegex.test(ob.tag)) continue

    if (!Array.isArray(ob.outbounds)) ob.outbounds = []
    if (clearExisting) ob.outbounds = []

    const tags = getTags(proxies, tagRegex)
    const before = ob.outbounds.length

    // 去重合并
    const merged = new Set(ob.outbounds)
    for (const t of tags) merged.add(t)
    ob.outbounds = Array.from(merged)

    log(`🕳 命中: ${ob.tag}，插入 ${tags.length} 个（原 ${before} -> 现 ${ob.outbounds.length}）`)
  }
}

log(`⑤ 空 outbounds 兜底（避免 sing-box 报错）`)
const compatibleOutbound = { tag: 'COMPATIBLE', type: 'direct' }
let compatibleAdded = false

for (const ob of config.outbounds) {
  for (const { outboundRegex } of rules) {
    if (!outboundRegex.test(ob.tag)) continue

    if (!Array.isArray(ob.outbounds)) ob.outbounds = []
    if (ob.outbounds.length === 0) {
      if (!compatibleAdded) {
        // 只加一次
        if (!config.outbounds.some(x => x.tag === compatibleOutbound.tag)) {
          config.outbounds.push(compatibleOutbound)
        }
        compatibleAdded = true
      }
      ob.outbounds.push(compatibleOutbound.tag)
      log(`🕳 ${ob.tag} 的 outbounds 为空 -> 自动插入 COMPATIBLE(direct)`)
    }
  }
}

log(`⑥ 追加节点本体到 config.outbounds（按 tag 去重）`)
const existing = new Set(config.outbounds.map(o => o.tag))
let appended = 0
for (const p of proxies) {
  if (!p || !p.tag) continue
  if (existing.has(p.tag)) continue
  config.outbounds.push(p)
  existing.add(p.tag)
  appended++
}
log(`追加节点本体: ${appended}`)

$content = JSON.stringify(config, null, 2)
log(`🔚 结束`)

function getTags(proxies, regex) {
  return proxies.filter(p => p?.tag && regex.test(p.tag)).map(p => p.tag)
}

function createRegExp(pattern) {
  const s = String(pattern ?? '')
  const ignoreCase = s.includes('ℹ️')
  const body = s.replaceAll('ℹ️', '')
  return new RegExp(body, ignoreCase ? 'i' : undefined)
}

function log(v) {
  console.log(`[📦 sing-box 插入节点脚本] ${v}`)
}
