const https = require('https')

const apiKey = 'sk-anitqqIjdD8-BjF5IIZite1yCHAzppdWOr66-8Z0Jpg'

function postJson(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(url)
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      }
    }, (res) => {
      let raw = ''
      res.on('data', c => raw += c)
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(raw) })
        } catch {
          resolve({ status: res.statusCode, data: raw })
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

;(async () => {
  const search = await postJson('https://qveris.ai/api/v1/search', {
    query: 'gold price aggregation tool',
    limit: 1
  }, { Authorization: `Bearer ${apiKey}` })

  console.log('search status:', search.status)
  const searchId = search.data?.search_id
  const toolId = search.data?.results?.[0]?.tool_id
  console.log('search_id:', searchId)
  console.log('tool_id:', toolId)

  for (const l of [1, 3, 5, 10]) {
    const exec = await postJson(`https://qveris.ai/api/v1/tools/execute?tool_id=${encodeURIComponent(toolId)}`, {
      search_id: searchId,
      parameters: {
        symbol: 'XAUUSD',
        limit: l
      },
      max_response_size: 8192
    }, { Authorization: `Bearer ${apiKey}` })

    const list = exec.data?.result?.data?.results || []
    console.log('\n==== limit =', l, ' status =', exec.status, ' total=', exec.data?.result?.data?.total)
    list.slice(0, 10).forEach((item, idx) => {
      console.log(idx + 1, {
        date: item.date,
        price: item.price,
        source: item.source,
        currency: item._currency,
        unit: item._unit
      })
    })
  }
})().catch(err => {
  console.error(err)
  process.exit(1)
})
