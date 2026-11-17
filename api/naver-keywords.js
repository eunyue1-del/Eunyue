'use strict';

/**
 * POST /api/naver-keywords
 * 네이버 "황금 키워드" 지표 조회 (Vercel Serverless Function)
 *
 * 1) 네이버 검색광고 키워드도구 API  → 월간 PC/모바일 검색량, 경쟁정도
 *    GET https://api.searchad.naver.com/keywordstool?hintKeywords=...&showDetail=1
 *    필수 환경변수: NAVER_AD_API_KEY(액세스라이선스), NAVER_AD_SECRET_KEY(비밀키), NAVER_AD_CUSTOMER_ID
 *
 * 2) 네이버 블로그 검색 API → 해당 키워드의 블로그 문서수(total)
 *    - 신규: NAVER API HUB  (NAVER_HUB_CLIENT_ID / NAVER_HUB_CLIENT_SECRET)
 *      GET https://naverapihub.apigw.ntruss.com/search/v1/blog?query=...&display=1
 *    - 기존: 개발자센터 (NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)
 *      GET https://openapi.naver.com/v1/search/blog.json?query=...&display=1
 *
 * 키가 하나도 없으면 200 + { ok:true, naver_connected:false } 로 조용히 돌려보내
 * 앱이 Gemini 만으로 계속 동작하게 합니다.
 *
 * 요청: { keywords: ["키워드", ...] }   (최대 12개)
 * 응답: { ok:true, naver_connected:true, ad_connected, blog_connected, blog_source, items:[...], warnings:[] }
 */

const crypto = require('node:crypto');

const AD_HOST = 'https://api.searchad.naver.com';
const AD_PATH = '/keywordstool';
const HUB_HOST = 'https://naverapihub.apigw.ntruss.com';
const HUB_PATH = '/search/v1/blog';
const LEGACY_HOST = 'https://openapi.naver.com';
const LEGACY_PATH = '/v1/search/blog.json';

const MAX_KEYWORDS = 12;
const MAX_DOC_KEYWORDS = 8;     // 블로그 문서수는 키워드당 1회 호출이라 상한을 둡니다
const AD_BATCH = 5;             // keywordstool hintKeywords 최대 5개
const AD_GAP_MS = 260;          // 검색광고 API 호출 간격 (초당 3회 권장)
const BLOG_GAP_MS = 90;
const BLOG_DELAY_MS = 60;

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 40;
const hits = new Map();

/* ---------------------------------------------------------------- utils */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  if (Array.isArray(forwarded) && forwarded.length) return String(forwarded[0]).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function allow(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_PER_WINDOW) {
    hits.set(ip, list);
    return false;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) {
    for (const [key, arr] of hits) {
      if (!arr.some((t) => now - t < WINDOW_MS)) hits.delete(key);
    }
  }
  return true;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try { return JSON.parse(req.body); } catch (err) { return null; }
  }
  return null;
}

/** 검색광고 API는 공백 없는 형태로 집계합니다. 응답도 공백 제거 + 영문 대문자입니다. */
function normKey(value) {
  return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
}

/** '< 10' 처럼 숫자가 아닌 값이 옵니다. */
function parseCount(raw) {
  if (typeof raw === 'number' && isFinite(raw)) return { value: raw, approx: false };
  const digits = Number(String(raw == null ? '' : raw).replace(/[^0-9]/g, ''));
  if (!isFinite(digits) || String(raw == null ? '' : raw).replace(/[^0-9]/g, '') === '') {
    return { value: null, approx: false };
  }
  return { value: digits, approx: true };
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 9000);
  try {
    const res = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (err) { body = null; }
    return { status: res.status, ok: res.ok, body: body, text: text };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- 검색광고 */

function signature(timestamp, method, path, secret) {
  return crypto.createHmac('sha256', secret)
    .update(timestamp + '.' + method + '.' + path)
    .digest('base64');
}

function adHeaders(env) {
  const timestamp = String(Date.now());
  return {
    'X-Timestamp': timestamp,
    'X-API-KEY': env.adKey,
    'X-Customer': String(env.adCustomer),
    'X-Signature': signature(timestamp, 'GET', AD_PATH, env.adSecret)
  };
}

async function fetchAdBatch(hints, env) {
  const query = hints.map((h) => h.replace(/\s+/g, '')).join(',');
  const url = AD_HOST + AD_PATH + '?hintKeywords=' + encodeURIComponent(query) + '&showDetail=1';
  const res = await fetchJson(url, { method: 'GET', headers: adHeaders(env) }, 9000);

  if (!res.ok) {
    let message = '검색광고 API 오류 (' + res.status + ')';
    if (res.status === 401 || res.status === 403) {
      message = '검색광고 API 인증 실패 — NAVER_AD_API_KEY · NAVER_AD_SECRET_KEY · NAVER_AD_CUSTOMER_ID 를 확인해 주세요.';
    } else if (res.status === 429) {
      message = '검색광고 API 호출 한도를 넘었어요. 잠시 뒤 다시 시도해 주세요.';
    } else if (res.status === 400) {
      message = '검색광고 API 요청 형식 오류 — 키워드에 특수문자가 있는지 확인해 주세요.';
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  const list = res.body && Array.isArray(res.body.keywordList) ? res.body.keywordList : [];
  return list;
}

/* ---------------------------------------------------------------- 블로그 검색 */

function blogConfig(env) {
  if (env.hubId && env.hubSecret) {
    return {
      host: HUB_HOST,
      path: HUB_PATH,
      source: 'hub',
      headers: {
        'X-NCP-APIGW-API-KEY-ID': env.hubId,
        'X-NCP-APIGW-API-KEY': env.hubSecret
      }
    };
  }
  if (env.legacyId && env.legacySecret) {
    return {
      host: LEGACY_HOST,
      path: LEGACY_PATH,
      source: 'legacy',
      headers: {
        'X-Naver-Client-Id': env.legacyId,
        'X-Naver-Client-Secret': env.legacySecret
      }
    };
  }
  return null;
}

async function fetchBlogTotal(keyword, cfg) {
  const url = cfg.host + cfg.path + '?query=' + encodeURIComponent(keyword) + '&display=1&sort=sim';
  const res = await fetchJson(url, { method: 'GET', headers: cfg.headers }, 9000);
  if (!res.ok) {
    let message = '블로그 검색 API 오류 (' + res.status + ')';
    if (res.status === 401) {
      message = '블로그 검색 API 인증 실패 — 키가 만료됐거나(개발자센터 키는 2027-06-30 종료) 헤더 형식이 달라요.';
    } else if (res.status === 403) {
      message = '블로그 검색 API 권한이 없어요. 앱에서 "검색" API 사용을 켜 주세요.';
    } else if (res.status === 429) {
      message = '블로그 검색 API 일일 한도를 넘었어요.';
    }
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  const total = res.body && typeof res.body.total === 'number' ? res.body.total : null;
  return total;
}

/* ---------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const env = {
    adKey: process.env.NAVER_AD_API_KEY || '',
    adSecret: process.env.NAVER_AD_SECRET_KEY || '',
    adCustomer: process.env.NAVER_AD_CUSTOMER_ID || '',
    hubId: process.env.NAVER_HUB_CLIENT_ID || '',
    hubSecret: process.env.NAVER_HUB_CLIENT_SECRET || '',
    legacyId: process.env.NAVER_CLIENT_ID || '',
    legacySecret: process.env.NAVER_CLIENT_SECRET || ''
  };

  const adReady = !!(env.adKey && env.adSecret && env.adCustomer);
  const blogCfg = blogConfig(env);
  const connected = adReady || !!blogCfg;

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      naver_connected: connected,
      ad_connected: adReady,
      blog_connected: !!blogCfg,
      blog_source: blogCfg ? blogCfg.source : 'none'
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD', message: 'POST 요청만 지원해요.' });
    return;
  }

  if (!connected) {
    // 키가 아직 없어도 앱은 Gemini 만으로 계속 동작해야 합니다.
    res.status(200).json({
      ok: true,
      naver_connected: false,
      ad_connected: false,
      blog_connected: false,
      blog_source: 'none',
      reason: 'NO_ENV',
      items: []
    });
    return;
  }

  const ip = clientIp(req);
  if (!allow(ip)) {
    res.status(429).json({ ok: false, code: 'RATE', message: '요청이 너무 잦아요. 잠시 뒤 다시 시도해 주세요.' });
    return;
  }

  const body = readBody(req);
  const rawList = body && Array.isArray(body.keywords) ? body.keywords : [];
  const seen = new Set();
  const keywords = [];
  for (const raw of rawList) {
    const value = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, 40);
    const key = normKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keywords.push(value);
    if (keywords.length >= MAX_KEYWORDS) break;
  }

  if (!keywords.length) {
    res.status(400).json({ ok: false, code: 'INPUT', message: '키워드를 하나 이상 보내 주세요.' });
    return;
  }

  const cacheKey = keywords.map(normKey).sort().join('|');
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    res.status(200).json(Object.assign({}, cached.data, { cached: true }));
    return;
  }

  const warnings = [];
  const volumeMap = new Map();   // normKey → { pc, mobile, total, approx, comp }
  let adConnected = adReady;
  let blogConnected = !!blogCfg;

  /* 1) 검색량 ------------------------------------------------------------- */
  if (adReady) {
    try {
      for (let i = 0; i < keywords.length; i += AD_BATCH) {
        const batch = keywords.slice(i, i + AD_BATCH);
        const rows = await fetchAdBatch(batch, env);
        for (const row of rows) {
          if (!row || !row.relKeyword) continue;
          const pc = parseCount(row.monthlyPcQcCnt);
          const mobile = parseCount(row.monthlyMobileQcCnt);
          if (pc.value == null && mobile.value == null) continue;
          const total = (pc.value || 0) + (mobile.value || 0);
          const key = normKey(row.relKeyword);
          if (!volumeMap.has(key)) {
            volumeMap.set(key, {
              pc: pc.value,
              mobile: mobile.value,
              total: total,
              approx: pc.approx || mobile.approx,
              comp: row.compIdx || null
            });
          }
        }
        if (i + AD_BATCH < keywords.length) await sleep(AD_GAP_MS);
      }
    } catch (err) {
      adConnected = false;
      warnings.push(err && err.message ? err.message : '검색광고 API 오류');
    }
  }

  /* 2) 블로그 문서수 ----------------------------------------------------- */
  const docMap = new Map();      // normKey → total
  if (blogCfg) {
    // 검색량이 확인된 키워드 중 상위부터 (블로그 문서수는 하루 호출 한도가 있습니다)
    const ordered = keywords.slice().sort((a, b) => {
      const av = volumeMap.get(normKey(a));
      const bv = volumeMap.get(normKey(b));
      return (bv ? bv.total : 0) - (av ? av.total : 0);
    }).slice(0, MAX_DOC_KEYWORDS);

    for (let i = 0; i < ordered.length; i += 1) {
      try {
        const total = await fetchBlogTotal(ordered[i], blogCfg);
        if (total != null) docMap.set(normKey(ordered[i]), total);
      } catch (err) {
        blogConnected = false;
        warnings.push(err && err.message ? err.message : '블로그 검색 API 오류');
        break;
      }
      if (i + 1 < ordered.length) await sleep(BLOG_GAP_MS + BLOG_DELAY_MS);
    }
  }

  /* 3) 조합 ------------------------------------------------------------- */
  const items = [];
  for (const keyword of keywords) {
    const key = normKey(keyword);
    const volume = volumeMap.get(key) || null;
    const docs = docMap.has(key) ? docMap.get(key) : null;
    if (!volume && docs == null) continue;

    let golden = null;
    if (volume && volume.total > 0 && docs != null) {
      golden = Math.round((docs / volume.total) * 100) / 100;
    }

    items.push({
      keyword: keyword,
      pc: volume ? volume.pc : null,
      mobile: volume ? volume.mobile : null,
      total: volume ? volume.total : null,
      approx: volume ? !!volume.approx : false,
      comp: volume ? volume.comp : null,
      docs: docs,
      golden: golden
    });
  }

  if (!items.length && (adConnected || blogConnected)) {
    warnings.push('이 키워드들의 지표를 찾지 못했어요. 키워드를 조금 더 짧게 바꿔 보세요.');
  }

  const payload = {
    ok: true,
    naver_connected: true,
    ad_connected: adConnected,
    blog_connected: blogConnected,
    blog_source: blogCfg ? blogCfg.source : 'none',
    items: items,
    warnings: warnings.slice(0, 3)
  };

  cache.set(cacheKey, { at: Date.now(), data: payload });
  if (cache.size > 300) {
    for (const [key, value] of cache) {
      if (Date.now() - value.at > CACHE_TTL_MS) cache.delete(key);
    }
  }

  res.status(200).json(payload);
};
