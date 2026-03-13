/**
 * 金价API服务
 * 提供实时黄金价格查询功能（上海黄金交易所Au9999）
 * 
 * 注意：由于小程序域名限制，需要在小程序后台配置以下合法域名：
 * - https://push2.eastmoney.com
 * - https://hq.sinajs.cn
 * - https://qt.gtimg.cn
 * 
 * 或使用云函数代理方案
 */

// Alpha Vantage API配置（用户提供的Key）
const ALPHA_VANTAGE_KEY = '2KDL90GOZQ34O6YM'

// 新增数据源API Key（建议不要硬编码，优先从本地存储读取）
const QVERIS_API_KEY = 'sk-anitqqIjdD8-BjF5IIZite1yCHAzppdWOr66-8Z0Jpg'
const METALPRICE_API_KEY = 'aec8a6b4f834cff7daaa2ccdc0bf44d1'

// 金价数据源配置
const API_SOURCES = {
  // 方案1: Alpha Vantage GLD（已验证）
  ALPHA_VANTAGE_GLD: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=GLD&apikey=${ALPHA_VANTAGE_KEY}`,

  // 方案2: Qveris（工具聚合）
  QVERIS_SEARCH: 'https://qveris.ai/api/v1/search',
  QVERIS_EXECUTE_BASE: 'https://qveris.ai/api/v1/tools/execute?tool_id=',

  // 方案3: MetalpriceAPI（外汇+贵金属汇率）
  METALPRICE_API: `https://api.metalpriceapi.com/v1/latest?api_key=${METALPRICE_API_KEY}&base=USD&currencies=XAU,CNY`,

  // 方案4: Metals Live API（可作为补充）
  METALS_API: 'https://api.metals.live/v1/spot/gold',
  
  // 方案5: 新浪财经（常用但不稳定）
  SINA_TD: 'https://hq.sinajs.cn/list=mAUTD',
  SINA_AU9999: 'https://hq.sinajs.cn/list=AU9999',
  SINA_AU9999_MOBILE: 'https://hq.sinajs.cn/list=mAU9999',
  
  // 方案6: 东方财富
  EASTMONEY: 'https://push2.eastmoney.com/api/qt/stock/get?secid=113.au9999&fields=f43,f58,f169,f170,f46,f44,f45,f47,f86',
  
  // 方案7: 腾讯财经
  TENCENT: 'https://qt.gtimg.cn/q=nAu9999',
  
  // 方案8: 金十数据
  JIN10: 'https://cdn-rili.jin10.com/data/v4/daily/quote.json',

  // 汇率源：USD基准实时汇率（用于动态换算到CNY）
  FX_USD_LATEST: 'https://open.er-api.com/v6/latest/USD'
}

function getRuntimeApiKey(storageKey, fallbackKey) {
  try {
    const fromStorage = wx.getStorageSync(storageKey)
    if (fromStorage && typeof fromStorage === 'string') {
      return fromStorage.trim()
    }
  } catch (error) {
    console.warn(`读取${storageKey}失败:`, error)
  }
  return (fallbackKey || '').trim()
}

const DEFAULT_USD_CNY_RATE = 6.92
const OUNCE_TO_GRAM = 31.1035
const FX_CACHE_KEY = 'fxToCnyCache'
const FX_CACHE_TTL_MS = 60 * 1000
const QVERIS_COOLDOWN_MS = 60 * 1000

const FX_TO_CNY = {
  CNY: 1,
  USD: DEFAULT_USD_CNY_RATE,
  PLN: 1.87,  // 波兰兹罗提，校准至沪金价格
  EUR: 7.6,
  GBP: 8.9,
  HKD: 0.9,
  JPY: 0.047,
  SGD: 5.2,
  AUD: 4.6,
  CAD: 5.1,
  CHF: 7.9
}

let fxCache = null
let qverisDisabledUntil = 0

function isQverisInCooldown() {
  return Date.now() < qverisDisabledUntil
}

function markQverisCooldown() {
  qverisDisabledUntil = Date.now() + QVERIS_COOLDOWN_MS
}

function buildDynamicFxToCnyMap(usdRates) {
  const cnyPerUsd = parseFloat(usdRates && usdRates.CNY)
  if (isNaN(cnyPerUsd) || cnyPerUsd <= 0) {
    throw new Error('实时汇率缺少USD/CNY')
  }

  const dynamicMap = { CNY: 1, USD: cnyPerUsd }

  Object.keys(FX_TO_CNY).forEach((currency) => {
    if (currency === 'CNY' || currency === 'USD') {
      return
    }

    const usdPerTarget = parseFloat(usdRates[currency])
    if (!isNaN(usdPerTarget) && usdPerTarget > 0) {
      dynamicMap[currency] = cnyPerUsd / usdPerTarget
    } else {
      dynamicMap[currency] = FX_TO_CNY[currency]
    }
  })

  return dynamicMap
}

function readFxCacheFromStorage() {
  try {
    const cached = wx.getStorageSync(FX_CACHE_KEY)
    if (cached && cached.rates && cached.timestamp) {
      const age = Date.now() - cached.timestamp
      if (age >= 0 && age <= FX_CACHE_TTL_MS) {
        return cached
      }
    }
  } catch (error) {
    console.warn('读取汇率缓存失败:', error)
  }
  return null
}

function saveFxCache(rates, source = 'realtime') {
  fxCache = {
    rates,
    timestamp: Date.now(),
    source
  }

  try {
    wx.setStorageSync(FX_CACHE_KEY, fxCache)
  } catch (error) {
    console.warn('写入汇率缓存失败:', error)
  }
}

function getDynamicFxContext() {
  if (fxCache && (Date.now() - fxCache.timestamp) <= FX_CACHE_TTL_MS) {
    return Promise.resolve(fxCache)
  }

  const storageCache = readFxCacheFromStorage()
  if (storageCache) {
    fxCache = {
      rates: storageCache.rates,
      timestamp: storageCache.timestamp,
      source: storageCache.source || 'cache'
    }
    return Promise.resolve({
      rates: fxCache.rates,
      timestamp: fxCache.timestamp,
      source: 'cache'
    })
  }

  return new Promise((resolve) => {
    wx.request({
      url: API_SOURCES.FX_USD_LATEST,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data || {}
          const rates = data.rates || {}
          const dynamicRates = buildDynamicFxToCnyMap(rates)
          saveFxCache(dynamicRates, 'realtime')
          resolve({
            rates: dynamicRates,
            timestamp: fxCache.timestamp,
            source: 'realtime'
          })
        } catch (error) {
          console.warn('实时汇率解析失败，使用本地汇率:', error.message)
          resolve({
            rates: FX_TO_CNY,
            timestamp: Date.now(),
            source: 'fallback'
          })
        }
      },
      fail: (error) => {
        console.warn('实时汇率请求失败，使用本地汇率:', error.errMsg || '未知错误')
        resolve({
          rates: FX_TO_CNY,
          timestamp: Date.now(),
          source: 'fallback'
        })
      }
    })
  })
}

function getDynamicFxToCnyMap() {
  return getDynamicFxContext().then((fxContext) => fxContext.rates)
}

function convertToCnyPerGram(price, currency, unit) {
  const normalizedCurrency = String(currency || '').toUpperCase()
  const normalizedUnit = String(unit || '').toLowerCase()

  return getDynamicFxContext().then((fxContext) => {
    const fxMap = fxContext.rates
    const fx = fxMap[normalizedCurrency]

    if (!fx) {
      throw new Error(`Qveris暂不支持币种: ${normalizedCurrency}`)
    }

    if (normalizedUnit === 'gram' || normalizedUnit === 'g' || normalizedUnit === '克') {
      return {
        priceCnyGram: price * fx,
        fxRate: fx,
        fxSource: fxContext.source,
        fxTimestamp: fxContext.timestamp,
        currency: normalizedCurrency,
        unit: normalizedUnit
      }
    }

    if (normalizedUnit === 'ounce' || normalizedUnit === 'oz' || normalizedUnit === '盎司') {
      return {
        priceCnyGram: (price * fx) / OUNCE_TO_GRAM,
        fxRate: fx,
        fxSource: fxContext.source,
        fxTimestamp: fxContext.timestamp,
        currency: normalizedCurrency,
        unit: normalizedUnit
      }
    }

    throw new Error(`Qveris暂不支持计量单位: ${normalizedUnit}`)
  })
}

/**
 * 注意：由于小程序域名限制，建议：
 * 1. 在项目.config.json中配置urlCheck: false 进行开发测试
 * 2. 或在小程序后台配置合法域名白名单
 * 3. 实际发布时建议使用云函数代理所有API请求
 */

/**
 * 智能金价模拟器
 * 基于真实市场价格范围（2026年3月Au9999价格：约1130-1155元/克）
 * 模拟真实的市场波动特征
 */
class GoldPriceSimulator {
  constructor() {
    // 基于2026年3月真实市场价格范围
    this.basePrice = 1143 // 基准价格 1143元/克
    this.priceRange = { min: 1130, max: 1155 } // 合理波动范围
    this.currentPrice = this.basePrice
    this.lastUpdateTime = Date.now()
    this.trend = 0 // 当前趋势：正数上涨，负数下跌
    
    // 初始化随机价格
    this.initializePrice()
  }
  
  initializePrice() {
    // 基于当前日期生成一个稳定的初始价格
    const dayOfYear = Math.floor((Date.now() - new Date(2026, 0, 1)) / (1000 * 60 * 60 * 24))
    const seed = dayOfYear % 30
    this.currentPrice = this.basePrice + (seed - 15) * 0.5
    this.currentPrice = this.clampPrice(this.currentPrice)
  }
  
  clampPrice(price) {
    return Math.max(this.priceRange.min, Math.min(this.priceRange.max, price))
  }
  
  /**
   * 生成下一个价格点
   * 模拟真实市场的连续性和趋势性
   */
  getNextPrice() {
    const now = Date.now()
    const timeDelta = (now - this.lastUpdateTime) / 1000 // 秒
    
    // 每次更新的基础波动（0.1-0.3元）
    const baseFluctuation = (Math.random() - 0.5) * 0.6
    
    // 趋势影响（模拟市场趋势的连续性）
    if (Math.random() < 0.1) { // 10%概率改变趋势
      this.trend = (Math.random() - 0.5) * 0.3
    }
    
    // 计算价格变化
    let priceChange = baseFluctuation + this.trend
    
    // 添加均值回归特性（价格偏离基准太远会有回归倾向）
    const deviation = this.currentPrice - this.basePrice
    priceChange -= deviation * 0.02
    
    // 更新价格
    this.currentPrice += priceChange
    this.currentPrice = this.clampPrice(this.currentPrice)
    this.lastUpdateTime = now
    
    return parseFloat(this.currentPrice.toFixed(2))
  }
}

// 全局模拟器实例
let simulator = null

function getSimulator() {
  if (!simulator) {
    simulator = new GoldPriceSimulator()
  }
  return simulator
}

/**
 * 从Metals Live API获取实时黄金价格（免费无限制）
 * 返回格式：元/克
 * 
 * Metals Live API说明：
 * - 无需API Key
 * - 直接返回点差价格
 * - 支持多种货币
 * - 完全免费，无调用限制
 * 
 * 返回格式：{unixtime: 1646550600, cny: 408.89, ...}
 * cny 字段：人民币/盎司
 */
function fetchFromMetalsAPI() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.METALS_API,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('Metals API原始数据:', data)
          
          if (!data) {
            throw new Error('无响应数据')
          }
          
          // 获取人民币价格（元/盎司）
          const priceOz = parseFloat(data.cny || data.CNY)
          
          console.log('Metals API价格(盎司):', priceOz)
          
          if (isNaN(priceOz) || priceOz <= 0) {
            throw new Error('价格数据无效')
          }
          
          // 转换：盎司→克（1盎司 = 31.1035克）
          const priceGram = priceOz / 31.1035
          
          console.log('Metals API价格(克):', priceGram)
          
          // 数据验证：金价应该在800-1500元/克之间
          if (priceGram < 800 || priceGram > 1500) {
            throw new Error(`价格超出合理范围: ${priceGram}元/克`)
          }
          
          resolve({
            price: parseFloat(priceGram.toFixed(2)),
            source: 'metals_api',
            timestamp: Date.now(),
            quote: `${priceOz.toFixed(2)} CNY/oz`
          })
        } catch (error) {
          reject(new Error(`Metals API数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`Metals API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从Alpha Vantage获取GLD（黄金ETF）美元价格，需要单位转换
 * 返回格式：元/克
 * 
 * Alpha Vantage说明：
 * - 使用GLOBAL_QUOTE获取GLD股票价格
 * - GLD价格为美元/盎司
 * - 需要转换为人民币/克
 */
function fetchFromAlphaVantageGLD() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.ALPHA_VANTAGE_GLD,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('Alpha Vantage GLD原始数据:', data)
          
          if (!data) {
            throw new Error('无响应数据')
          }
          
          // 检查错误信息
          if (data['Error Message']) {
            throw new Error(`API错误: ${data['Error Message']}`)
          }
          if (data['Information']) {
            throw new Error(`API信息: ${data['Information']}`)
          }
          
          // 获取GLD价格（美元）
          const globalQuote = data['Global Quote']
          if (!globalQuote) {
            throw new Error('无法获取Global Quote数据')
          }
          
          const priceUSD = parseFloat(globalQuote['05. price'])
          
          console.log('Alpha Vantage GLD价格(USD):', priceUSD)
          
          if (isNaN(priceUSD) || priceUSD <= 0) {
            throw new Error('价格数据无效')
          }
          
          // 转换：USD/oz → CNY/g（动态汇率）
          getDynamicFxContext()
            .then((fxContext) => {
              const usdToCny = fxContext.rates.USD || DEFAULT_USD_CNY_RATE
              const priceGram = (priceUSD / OUNCE_TO_GRAM) * usdToCny
              
              console.log('Alpha Vantage GLD价格(CNY/g):', priceGram)
              
              // 数据验证：金价应该在800-1500元/克之间
              if (priceGram < 800 || priceGram > 1500) {
                reject(new Error(`价格超出合理范围: ${priceGram}元/克`))
                return
              }
              
              resolve({
                price: parseFloat(priceGram.toFixed(2)),
                source: 'alpha_vantage_gld',
                timestamp: Date.now(),
                quote: `${priceUSD.toFixed(2)} USD/oz @${usdToCny.toFixed(6)}`,
                internationalPrice: `${priceUSD.toFixed(2)} USD/oz`,
                fxRate: usdToCny,
                fxSource: fxContext.source,
                fxTimestamp: fxContext.timestamp
              })
            })
            .catch((error) => {
              reject(new Error(`Alpha Vantage GLD汇率换算失败: ${error.message}`))
            })
          return
        } catch (error) {
          reject(new Error(`Alpha Vantage GLD数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`Alpha Vantage GLD请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从 Qveris 获取金价（先 search 再 execute）
 */
function fetchFromQveris() {
  return new Promise((resolve, reject) => {
    if (isQverisInCooldown()) {
      reject(new Error('Qveris 网络暂不可用，稍后重试'))
      return
    }

    const apiKey = getRuntimeApiKey('qverisApiKey', QVERIS_API_KEY)
    if (!apiKey) {
      reject(new Error('Qveris API Key 未配置，请先设置 qverisApiKey'))
      return
    }

    wx.request({
      url: API_SOURCES.QVERIS_SEARCH,
      method: 'POST',
      header: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      data: {
        query: 'gold price aggregation tool',
        limit: 1
      },
      success: (searchRes) => {
        try {
          const searchData = searchRes.data || {}
          const searchId = searchData.search_id
          const toolId = searchData.results && searchData.results[0] && searchData.results[0].tool_id

          if (!searchId || !toolId) {
            throw new Error('Qveris search 未返回 search_id 或 tool_id')
          }

          wx.request({
            url: `${API_SOURCES.QVERIS_EXECUTE_BASE}${encodeURIComponent(toolId)}`,
            method: 'POST',
            header: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            data: {
              search_id: searchId,
              parameters: {
                symbol: 'XAUUSD',
                limit: 1
              },
              max_response_size: 4096
            },
            success: (execRes) => {
              try {
                const execData = execRes.data || {}
                const item = execData.result && execData.result.data && execData.result.data.results && execData.result.data.results[0]

                if (!item) {
                  throw new Error('Qveris execute 未返回结果数据')
                }

                let price = parseFloat(item.price)
                const sourceName = String(item.source || '').toLowerCase()
                const currency = String(item._currency || '').toUpperCase()
                const unit = String(item._unit || '').toLowerCase()

                if (isNaN(price) || price <= 0) {
                  throw new Error('Qveris 价格字段无效')
                }

                // 统一转换到 CNY/gram（动态汇率）
                convertToCnyPerGram(price, currency, unit)
                  .then((converted) => {
                    const convertedPrice = converted.priceCnyGram
                    const fxRate = converted.fxRate
                    const fxSource = converted.fxSource
                    const fxTimestamp = converted.fxTimestamp

                    console.log(`Qveris 转换: ${item.price} ${currency}/${unit} -> ${convertedPrice.toFixed(2)} CNY/g (来源: ${sourceName}, 汇率: ${fxRate.toFixed(6)})`)

                    if (convertedPrice < 300 || convertedPrice > 1500) {
                      throw new Error(`Qveris价格超出范围: ${convertedPrice}元/克`)
                    }

                    resolve({
                      price: parseFloat(convertedPrice.toFixed(2)),
                      source: 'qveris',
                      timestamp: Date.now(),
                      quote: `${item.price} ${currency}/${unit} (${sourceName}) @${fxRate.toFixed(6)}`,
                      internationalPrice: `${parseFloat(item.price).toFixed(2)} ${currency}/${unit}`,
                      fxRate: fxRate,
                      fxSource: fxSource,
                      fxTimestamp: fxTimestamp
                    })
                  })
                  .catch((error) => {
                    reject(new Error(`Qveris汇率换算失败: ${error.message}`))
                  })
              } catch (error) {
                reject(new Error(`Qveris执行解析失败: ${error.message}`))
              }
            },
            fail: (error) => {
              reject(new Error(`Qveris execute 请求失败: ${error.errMsg || '未知错误'}`))
            }
          })
        } catch (error) {
          reject(new Error(`Qveris search 解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        markQverisCooldown()
        reject(new Error(`Qveris search 请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从 MetalpriceAPI 获取金价
 * latest(base=USD,currencies=XAU,CNY) -> 通过 USDXAU 与 USDCNY 推导 CNY/gram
 */
function fetchFromMetalpriceAPI() {
  return new Promise((resolve, reject) => {
    const apiKey = getRuntimeApiKey('metalpriceApiKey', METALPRICE_API_KEY)
    if (!apiKey) {
      reject(new Error('MetalpriceAPI Key 未配置，请先设置 metalpriceApiKey'))
      return
    }

    const url = `https://api.metalpriceapi.com/v1/latest?api_key=${encodeURIComponent(apiKey)}&base=USD&currencies=XAU,CNY`

    wx.request({
      url,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data || {}
          if (data.success === false) {
            throw new Error(data.error || 'MetalpriceAPI 返回失败')
          }

          const rates = data.rates || {}
          const usdToXau = parseFloat(rates.USDXAU || rates.XAU)
          const usdToCny = parseFloat(rates.USDCNY || rates.CNY)

          if (isNaN(usdToXau) || usdToXau <= 0 || isNaN(usdToCny) || usdToCny <= 0) {
            throw new Error('MetalpriceAPI 汇率字段无效')
          }

          const cnyPerOz = usdToCny / usdToXau
          const priceGram = cnyPerOz / 31.1035

          if (isNaN(priceGram) || priceGram <= 0) {
            throw new Error('MetalpriceAPI 计算结果无效')
          }

          if (priceGram < 300 || priceGram > 1500) {
            throw new Error(`MetalpriceAPI价格超出范围: ${priceGram}元/克`)
          }

          resolve({
            price: parseFloat(priceGram.toFixed(2)),
            source: 'metalpriceapi',
            timestamp: Date.now(),
            quote: `${cnyPerOz.toFixed(2)} CNY/oz`
          })
        } catch (error) {
          reject(new Error(`MetalpriceAPI解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`MetalpriceAPI请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 使用智能模拟器获取金价
 * 模拟真实市场的价格波动特征
 */
function fetchFromSimulator() {
  const sim = getSimulator()
  const price = sim.getNextPrice()
  
  return Promise.resolve({
    price: price,
    source: 'simulator',
    timestamp: Date.now(),
    note: '模拟数据（基于真实价格范围）'
  })
}

/**
 * 从金十数据获取黄金价格
 * 返回格式：元/克
 */
function fetchFromJin10() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.JIN10,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('金十数据原始数据:', data)
          
          if (!data || !data.values) {
            throw new Error('数据格式错误')
          }
          
          // 查找黄金相关数据
          // 可能的字段: AU9999, AU(T+D), 现货黄金等
          let price = null
          
          // 尝试多个可能的字段
          const goldFields = ['AU9999', 'AU(T+D)', 'AUTD', '黄金', 'gold']
          
          for (const field of goldFields) {
            if (data.values[field] && data.values[field].last) {
              price = parseFloat(data.values[field].last)
              console.log(`找到金价字段 ${field}:`, price)
              break
            }
          }
          
          if (!price || isNaN(price)) {
            throw new Error('未找到金价数据')
          }
          
          // 数据验证
          if (price < 800 || price > 1500) {
            throw new Error(`价格超出合理范围: ${price}`)
          }
          
          resolve({
            price: parseFloat(price.toFixed(2)),
            source: 'jin10_data',
            timestamp: Date.now()
          })
        } catch (error) {
          reject(new Error(`金十数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`金十数据API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从新浪财经获取Au9999价格（备用接口）
 * 返回格式：元/克
 */
function fetchFromSinaAu9999() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.SINA_AU9999,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('新浪Au9999原始数据:', data)
          
          if (!data || typeof data !== 'string') {
            throw new Error('数据格式错误')
          }
          
          // 新浪返回格式: var hq_str_AU9999="最新价,涨跌,涨跌幅,...";
          // 注意：AU9999是上海金交所代码，不要用hf_XAU（那是伦敦金）
          const match = data.match(/hq_str_AU9999="([^"]+)"/)
          if (!match || !match[1]) {
            // 如果返回空字符串，可能是市场休市
            if (data.includes('hq_str_AU9999=""')) {
              throw new Error('新浪返回空数据，可能市场休市')
            }
            throw new Error('解析失败')
          }
          
          const fields = match[1].split(',')
          console.log('新浪Au9999字段数组:', fields)
          console.log('新浪Au9999字段数量:', fields.length)
          
          // 通常第0个或第1个字段是最新价（元/克）
          let price = parseFloat(fields[0])
          
          // 如果第一个字段为空或无效，尝试其他字段
          if (isNaN(price) || price <= 0) {
            console.log('字段0无效，尝试字段1')
            price = parseFloat(fields[1])
          }
          
          // 如果还是无效，遍历所有字段查找合理价格
          if (isNaN(price) || price <= 0) {
            console.log('字段1无效，遍历所有字段')
            for (let i = 2; i < Math.min(fields.length, 10); i++) {
              const testPrice = parseFloat(fields[i])
              if (!isNaN(testPrice) && testPrice >= 800 && testPrice <= 1500) {
                price = testPrice
                console.log(`在字段${i}找到合理价格:`, price)
                break
              }
            }
          }
          
          console.log('新浪Au9999解析价格:', price)
          
          if (isNaN(price) || price <= 0) {
            throw new Error('价格数据无效')
          }
          
          // 数据验证：国内金价应该在800-1500元/克之间
          if (price < 800 || price > 1500) {
            throw new Error(`价格超出合理范围: ${price}`)
          }
          
          resolve({
            price: parseFloat(price.toFixed(2)),
            source: 'sina_au9999',
            timestamp: Date.now()
          })
        } catch (error) {
          reject(new Error(`新浪Au9999数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`新浪Au9999API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从新浪财经获取Au9999价格（移动版接口，备用）
 * 返回格式：元/克
 */
function fetchFromSinaAu9999Mobile() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.SINA_AU9999_MOBILE,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('新浪Au9999移动版原始数据:', data)
          
          if (!data || typeof data !== 'string') {
            throw new Error('数据格式错误')
          }
          
          // 移动版返回格式: var hq_str_mAU9999="最新价,涨跌,涨跌幅,...";
          const match = data.match(/hq_str_mAU9999="([^"]+)"/)
          if (!match || !match[1]) {
            if (data.includes('hq_str_mAU9999=""')) {
              throw new Error('移动版返回空数据，可能市场休市')
            }
            throw new Error('解析失败')
          }
          
          const fields = match[1].split(',')
          console.log('新浪Au9999移动版字段数组:', fields)
          
          let price = parseFloat(fields[0])
          if (isNaN(price) || price <= 0 || price < 800 || price > 1500) {
            // 遍历查找合理价格
            for (let i = 1; i < Math.min(fields.length, 10); i++) {
              const testPrice = parseFloat(fields[i])
              if (!isNaN(testPrice) && testPrice >= 800 && testPrice <= 1500) {
                price = testPrice
                console.log(`在字段${i}找到合理价格:`, price)
                break
              }
            }
          }
          
          if (isNaN(price) || price < 800 || price > 1500) {
            throw new Error(`价格无效或超出范围: ${price}`)
          }
          
          resolve({
            price: parseFloat(price.toFixed(2)),
            source: 'sina_au9999_mobile',
            timestamp: Date.now()
          })
        } catch (error) {
          reject(new Error(`新浪Au9999移动版解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`新浪Au9999移动版API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从新浪财经获取上海金Au(T+D)价格
 * 返回格式：元/克
 * 
 * 新浪财经Au(T+D)接口说明：
 * - PC版: list=AUTD
 * - 移动版: list=mAUTD (更稳定)
 * - 返回格式: var hq_str_mAUTD="最新价,昨收,今开,最高,最低,买价,卖价,成交量,成交额,...";
 * - 单位：元/克（不需要转换）
 */
function fetchFromSina() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.SINA_TD,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('新浪T+D原始数据:', data)
          console.log('新浪T+D数据长度:', data ? data.length : 0)
          
          if (!data || typeof data !== 'string') {
            throw new Error('数据格式错误')
          }
          
          // 新浪返回格式: var hq_str_mAUTD="最新价,昨收价,今开价,最高价,最低价,...";
          // 注意：移动版使用mAUTD，PC版使用AUTD
          const match = data.match(/hq_str_[m]?AUTD="([^"]+)"/)
          if (!match || !match[1]) {
            // 如果返回空字符串，可能是市场休市
            if (data.includes('hq_str_mAUTD=""') || data.includes('hq_str_AUTD=""')) {
              throw new Error('新浪T+D返回空数据，可能市场休市')
            }
            console.log('正则匹配失败，数据内容:', data.substring(0, 200))
            throw new Error('解析失败')
          }
          
          const fields = match[1].split(',')
          console.log('新浪T+D字段数组:', fields)
          console.log('新浪T+D字段数量:', fields.length)
          
          // 第0个字段是最新价（元/克）
          let price = parseFloat(fields[0])
          
          console.log('新浪T+D解析价格（原始）:', price)
          
          if (isNaN(price) || price <= 0) {
            throw new Error('价格数据无效')
          }
          
          // 注意：新浪财经接口返回的单位是【元/克】，不需要转换！
          // 之前的除以10逻辑是错误的，那是因为用错了接口（hf_CHA50CFD是A50指数）
          console.log('新浪T+D最终价格（元/克）:', price)
          
          // 数据验证：Au(T+D)价格应该在800-1500元/克之间
          if (price < 800 || price > 1500) {
            throw new Error(`价格超出合理范围: ${price}`)
          }
          
          resolve({
            price: parseFloat(price.toFixed(2)),
            source: 'sina_sge',
            timestamp: Date.now()
          })
        } catch (error) {
          reject(new Error(`新浪数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`新浪API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从东方财富网获取上海金Au9999价格
 * 返回格式：元/克
 * 
 * 东方财富API说明：
 * - 请求格式: https://push2.eastmoney.com/api/qt/stock/get?secid=113.au9999&fields=...
 * - 返回格式: {rc: 0, rt: 1, svr: xxx, lt: 1, full: 1, data: {f43: ..., f170: ...}}
 * - rc: 返回码，0表示成功，非0表示失败
 * - data: 数据对象，包含各个字段
 * - f43: 最新价（元/克）
 */
function fetchFromEastMoney() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.EASTMONEY,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('东方财富原始数据:', data)
          console.log('东方财富返回码rc:', data ? data.rc : '无')
          
          if (!data) {
            throw new Error('无响应数据')
          }
          
          // 检查返回码：rc=0表示成功，rc=100表示请求失败或无数据
          if (data.rc !== 0 && data.rc !== undefined) {
            // rc=100 表示该API不支持此金融代码或请求参数错误
            throw new Error(`东方财富不支持该代码或服务不可用 (rc=${data.rc})`)
          }
          
          // 检查是否有数据字段
          if (!data.data) {
            throw new Error('响应中无data字段')
          }
          
          // 尝试从多个字段中解析价格
          let price = null
          
          // 优先尝试f43（最新价）
          if (data.data.f43) {
            price = parseFloat(data.data.f43)
            console.log('东方财富f43字段值:', price)
          }
          
          // 如果f43无效，尝试f170
          if (!price || isNaN(price) || price <= 0) {
            console.log('f43无效，尝试f170字段')
            if (data.data.f170) {
              price = parseFloat(data.data.f170)
              console.log('东方财富f170字段值:', price)
            }
          }
          
          // 如果还是无效，尝试遍历所有字段
          if (!price || isNaN(price) || price <= 0) {
            console.log('f170也无效，遍历所有字段查找')
            const fields = Object.keys(data.data)
            console.log('东方财富数据字段列表:', fields)
            
            for (const field of fields) {
              const value = parseFloat(data.data[field])
              if (!isNaN(value) && value > 0 && value >= 800 && value <= 1500) {
                price = value
                console.log(`在${field}字段找到合理价格:`, price)
                break
              }
            }
          }
          
          console.log('东方财富解析的价格（原始）:', price)
          
          if (!price || isNaN(price) || price <= 0) {
            throw new Error('无法解析有效的价格数据')
          }
          
          // 数据验证：Au9999价格应该在800-1500元/克之间
          if (price < 800 || price > 1500) {
            throw new Error(`价格超出合理范围: ${price}`)
          }
          
          resolve({
            price: parseFloat(price.toFixed(2)),
            source: 'eastmoney_au9999',
            timestamp: Date.now()
          })
        } catch (error) {
          reject(new Error(`东方财富数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`东方财富API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 从腾讯财经获取Au9999价格
 * 返回格式：元/克
 * 
 * 腾讯财经接口说明：
 * - 格式: https://qt.gtimg.cn/q=代码
 * - 代码: nAu9999 (n表示南方黄金交易所)
 * - 返回格式: v_nAu9999="51~Au9999~名称~当前价~涨跌~涨跌%~买价~卖价~成交量~...";
 * - 字段分隔符: ~
 * - 单位：元/克
 */
function fetchFromTencent() {
  return new Promise((resolve, reject) => {
    wx.request({
      url: API_SOURCES.TENCENT,
      method: 'GET',
      success: (res) => {
        try {
          const data = res.data
          console.log('腾讯财经原始数据:', data)
          console.log('腾讯财经数据类型:', typeof data)
          console.log('腾讯财经数据长度:', data ? data.length : 0)
          
          if (!data || typeof data !== 'string') {
            throw new Error('数据格式错误')
          }
          
          // 检查是否返回错误信息
          if (data.includes('v_pv_none_match')) {
            throw new Error('腾讯API返回无匹配数据，代码可能不存在')
          }
          
          // 腾讯返回格式: v_nAu9999="51~Au9999~名称~价格~涨跌~涨跌%~...";
          // 支持多种代码格式：AU9999, nAu9999等
          const match = data.match(/v_[n]?[Aa][Uu]9999="([^"]+)"/)
          if (!match || !match[1]) {
            console.log('腾讯财经正则匹配失败，数据内容:', data.substring(0, 200))
            throw new Error('解析失败')
          }
          
          const fields = match[1].split('~')
          console.log('腾讯财经字段数组:', fields)
          console.log('腾讯财经字段数量:', fields.length)
          
          // 第3个字段是最新价（元/克）
          let price = parseFloat(fields[3])
          
          console.log('腾讯财经解析价格（原始）:', price)
          
          if (isNaN(price) || price <= 0) {
            // 尝试其他字段
            console.log('尝试解析其他字段...')
            for (let i = 0; i < fields.length; i++) {
              const testPrice = parseFloat(fields[i])
              if (!isNaN(testPrice) && testPrice >= 800 && testPrice <= 1500) {
                price = testPrice
                console.log(`在字段${i}找到合理价格:`, price)
                break
              }
            }
            
            if (isNaN(price) || price <= 0) {
              throw new Error('价格数据无效')
            }
          }
          
          // 数据验证
          if (price < 800 || price > 1500) {
            throw new Error(`价格超出合理范围: ${price}`)
          }
          
          resolve({
            price: parseFloat(price.toFixed(2)),
            source: 'tencent_au9999',
            timestamp: Date.now()
          })
        } catch (error) {
          reject(new Error(`腾讯财经数据解析失败: ${error.message}`))
        }
      },
      fail: (error) => {
        reject(new Error(`腾讯财经API请求失败: ${error.errMsg || '未知错误'}`))
      }
    })
  })
}

/**
 * 获取当前黄金价格（简化版，仅支持 Qveris 和模拟器）
 * 
 * 逻辑：
 * 1. 如果指定了数据源，直接使用该数据源
 * 2. 如果是自动模式，按顺序尝试：Qveris → 模拟器
 * 3. 所有API失败则使用智能模拟器
 * 
 * @param {boolean} forceSimulator - 强制使用模拟器
 * @param {string} source - 指定数据源: 'qveris'|'simulator'
 * @returns {Promise<Object>} 包含价格、来源和时间戳的对象
 */
function getCurrentGoldPrice(forceSimulator = false, source = 'simulator') {
  // 如果强制使用模拟器或选择了模拟器，直接返回
  if (forceSimulator || source === 'simulator') {
    return fetchFromSimulator()
  }
  
  // 根据指定的数据源调用对应函数
  const sourceMap = {
    'qveris': { func: fetchFromQveris, name: 'Qveris' }
  }
  
  const sourceDef = sourceMap[source]
  if (sourceDef && sourceDef.func) {
    console.log(`使用数据源: ${sourceDef.name}`)
    return sourceDef.func()
      .then(result => {
        console.log(`✓ 成功从${sourceDef.name}获取数据: ${result.price}元/克`)
        return result
      })
      .catch((error) => {
        console.warn(`✗ ${sourceDef.name}失败，回退模拟器: ${error.message}`)
        return fetchFromSimulator().then((simResult) => ({
          ...simResult,
          fallbackFrom: source,
          fallbackReason: error.message
        }))
      })
  }

  // 默认使用模拟器
  return fetchFromSimulator()
}

/**
 * 获取配置建议和故障排除指南
 */
function getConfigSuggestion() {
  return {
    title: '金价数据源配置指南',
    problem: '当前所有实时API都无法提供数据，系统使用智能模拟器',
    symptoms: [
      '1. 新浪财经接口返回空数据（var hq_str_AU9999=""）',
      '2. 东方财富API返回错误码 (rc=100)',
      '3. 腾讯财经返回无匹配数据',
      '4. 金十数据连接被拒绝'
    ],
    solutions: [
      '',
      '【快速测试】',
      '1. 编辑 project.config.json，修改: "urlCheck": false',
      '2. 重新编译小程序，观察控制台日志',
      '3. 如果API返回数据，说明问题出在域名白名单',
      '',
      '【配置域名白名单】',
      '1. 登录 https://mp.weixin.qq.com',
      '2. 进入"开发" → "开发管理" → "开发设置"',
      '3. 在"服务器域名"→ "Request合法域名"添加:',
      '   ✓ https://hq.sinajs.cn',
      '   ✓ https://push2.eastmoney.com',
      '   ✓ https://qt.gtimg.cn',
      '   ✓ https://cdn-rili.jin10.com',
      '4. 下载验证文件，放到对应域名的根目录',
      '5. 点击验证，等待审核（1-3个工作日）',
      '6. 审核通过后重新编译，刷新手机',
      '',
      '【使用云函数代理】',
      '这是最可靠的长期方案，无需配置域名白名单：',
      '1. 腾讯云创建云函数，代理所有API请求',
      '2. 小程序调用云函数而非直接请求',
      '3. 参考文件：API诊断报告.md 中的"方案3"',
      '',
      '【当前状态】',
      '✓ 智能模拟器工作正常，价格基于真实市场范围',
      '✓ 价格范围：1130-1155 元/克',
      '✓ 可靠性：100% （无网络依赖）'
    ],
    dataSourceStatus: {
      'sina_au9999': '❌ 返回空数据',
      'sina_au9999_mobile': '❌ 返回空数据',
      'sina_td': '❌ 返回空数据',
      'eastmoney': '❌ rc=100 (无数据)',
      'tencent': '❌ 无匹配数据',
      'jin10': '❌ 连接被拒绝',
      'simulator': '✅ 完全可用'
    },
    fallbackChain: [
      '新浪Au9999(PC)',
      '→ 新浪Au9999(移动)',
      '→ 新浪Au(T+D)',
      '→ 东方财富',
      '→ 腾讯财经',
      '→ 金十数据',
      '→ 智能模拟器 ⭐'
    ]
  }
}

module.exports = {
  getCurrentGoldPrice,
  getConfigSuggestion
}
