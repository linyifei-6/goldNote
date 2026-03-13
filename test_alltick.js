// Alltick API 测试
const https = require('https');

const token = '8d7031314a450b75cf2dcb3224b1f8db-c-app';
const baseUrl = 'https://quote.alltick.co/quote-b-api/trade-tick';

// 查询参数 (需要 URL 编码)
const queryData = {
  "trace": "test-gold-price-001",
  "data": {
    "symbol_list": [
      {
        "code": "XAUUSD"
      }
    ]
  }
};

// URL 编码查询参数
const encodedQuery = encodeURIComponent(JSON.stringify(queryData));
const fullUrl = `${baseUrl}?token=${token}&query=${encodedQuery}`;

console.log('请求 URL:', fullUrl);
console.log('---');

https.get(fullUrl, (res) => {
  let data = '';
  
  console.log('状态码:', res.statusCode);
  console.log('响应头:', JSON.stringify(res.headers, null, 2));
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('---');
    console.log('响应数据:', data);
    try {
      const jsonData = JSON.parse(data);
      console.log('---');
      console.log('格式化 JSON:', JSON.stringify(jsonData, null, 2));
      
      if (jsonData.ret === 200 && jsonData.data && jsonData.data.tick_list) {
        const tick = jsonData.data.tick_list[0];
        if (tick) {
          console.log('---');
          console.log('✅ 成功获取金价数据:');
          console.log('  产品代码:', tick.code);
          console.log('  价格 (USD/oz):', tick.price);
          console.log('  时间戳:', tick.tick_time);
          console.log('  成交量:', tick.volume);
          
          // 转换为 CNY/g
          const priceUsdOz = parseFloat(tick.price);
          const priceCnyGram = (priceUsdOz * 7.0) / 31.1035;
          console.log('  换算后 (CNY/g):', priceCnyGram.toFixed(2));
        }
      }
    } catch (e) {
      console.error('解析 JSON 失败:', e.message);
    }
  });
}).on('error', (e) => {
  console.error('请求失败:', e.message);
});
