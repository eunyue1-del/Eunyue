'use strict';

/**
 * POST /api/generate
 * 네이버 블로그 글 생성용 Gemini 프록시 (Vercel Serverless Function)
 *
 * 요청: { step: 'keywords' | 'outline' | 'post', input: {...} }
 * 응답: { ok: true, data: {...} }  /  { ok: false, code, message }
 *
 * - GEMINI_API_KEY 는 process.env 에서만 읽습니다. 브라우저로 노출되지 않습니다.
 * - 클라이언트가 프롬프트를 보내지 않고, 서버가 step + 입력값으로 프롬프트를 만듭니다.
 *   (프롬프트 조작·과금 악용을 막기 위해서입니다.)
 */

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';

const SYSTEM_PROMPT = [
  '당신은 네이버 블로그 상위노출 글을 10년 넘게 써 온 한국인 블로거입니다.',
  '검색자의 의도를 먼저 읽고, 사람이 직접 쓴 것처럼 자연스러운 한국어로 씁니다.',
  '요청된 JSON만 출력하고 설명, 인사, 코드블록을 덧붙이지 않습니다.'
].join(' ');

const STEPS = ['keywords', 'outline', 'post'];
const LIMITS = {
  bodyBytes: 24 * 1024,
  topic: 120,
  audience: 60,
  mustKeywords: 80,
  title: 120,
  keyword: 40,
  keywords: 14,
  sections: 6,
  bullets: 5
};

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const hits = new Map();

/* ---------------------------------------------------------------- utils */

function str(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function strList(value, max, itemMax) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const v = str(item, itemMax);
    if (v) out.push(v);
  }
  return out.slice(0, max);
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

/* ---------------------------------------------------------------- prompts
   index.html 의 PROMPTS 와 같은 내용을 유지하세요.
   (빌드 없이 쓰는 단일 HTML 구조라 프롬프트가 두 곳에 있습니다.)
-------------------------------------------------------------------------- */

const PROMPTS = {
  keywords(input) {
    return [
      '[요청] 네이버 블로그 글을 쓰기 전에, 검색에서 실제로 통하는 황금 키워드와 제목 후보를 뽑아 주세요.',
      '',
      '- 주제: ' + input.topic,
      '- 글의 목적·분위기: ' + (input.purpose || '지정 없음'),
      '- 타깃 독자: ' + (input.audience || '지정 없음'),
      '- 꼭 넣어야 할 키워드: ' + (input.mustKeywords || '없음'),
      '- 말투: ' + (input.tone || '친근한 존댓말'),
      '',
      '[규칙]',
      '1. sub_keywords: 이 주제로 사람들이 실제로 검색할 서브 키워드 5개. 2~4어절, 서로 겹치지 않게, 검색 의도가 분명하게.',
      '2. related_keywords: 연관 키워드·롱테일 5개. 이 글을 찾는 사람이 함께 궁금해할 것.',
      '3. title_candidates: 클릭하고 싶은 제목 3개. 각 25~40자, 서로 다른 각도(정보형 / 경험·후기형 / 숫자·호기심형).',
      '4. 제목에는 핵심 키워드를 넣고, 사실과 다른 과장이나 낚시성 표현은 쓰지 마세요.',
      '5. 한국어로만 답하세요.',
      '',
      '출력(JSON만):',
      '{"sub_keywords":["","","","",""],"related_keywords":["","","","",""],"title_candidates":["","",""]}'
    ].join('\n');
  },

  outline(input) {
    return [
      '[요청] 아래 주제와 키워드로 네이버 블로그 상위노출에 맞는 글 구조를 설계하세요.',
      '',
      '- 주제: ' + input.topic,
      '- 확정 제목: ' + input.title,
      '- 넣을 키워드: ' + (input.keywords.join(', ') || '없음'),
      '- 글의 목적·분위기: ' + (input.purpose || '지정 없음'),
      '- 타깃 독자: ' + (input.audience || '지정 없음'),
      '- 말투: ' + (input.tone || '친근한 존댓말'),
      '- 목표 분량: 약 ' + input.targetChars + '자',
      '',
      '[규칙]',
      '1. sections는 4~5개. 검색자가 궁금해하는 순서로: 도입 → 핵심 정보 → 경험·예시 → 주의점·팁 → 짧은 정리.',
      '2. h2_title은 12~22자. 소제목만 봐도 내용이 보이게. 키워드를 최소 1개 자연스럽게 넣기.',
      '3. bullets는 그 소제목에서 다룰 핵심 포인트 3개. 각 30자 이내 명사형.',
      '4. keywords_used는 그 소제목에서 실제로 쓸 키워드 1~3개.',
      '5. est_chars는 소제목당 예상 글자수(숫자).',
      '6. estimated_chars는 전체 예상 글자수를 "약 2,200자" 형식으로.',
      '',
      '출력(JSON만):',
      '{"estimated_chars":"약 2,200자","sections":[{"h2_title":"","bullets":["","",""],"keywords_used":[""],"est_chars":600}]}'
    ].join('\n');
  },

  post(input) {
    const outlineText = (input.outline || []).map((s, i) => {
      const bullets = (s.bullets || []).map((b) => '   - ' + b).join('\n');
      return (i + 1) + '. ' + s.h2_title + (bullets ? '\n' + bullets : '');
    }).join('\n');
    return [
      '[요청] 아래 구조대로 네이버 블로그 본문을 완성하세요. 사람이 직접 쓴 글처럼 읽혀야 합니다.',
      '',
      '- 확정 제목: ' + input.title,
      '- 넣을 키워드: ' + (input.keywords.join(', ') || '없음'),
      '- 목표 분량: 공백 포함 약 ' + input.targetChars + '자 (±15%까지 허용)',
      '- 말투: ' + (input.tone || '친근한 존댓말'),
      '- 타깃 독자: ' + (input.audience || '지정 없음'),
      '',
      '[글 구조]',
      outlineText,
      '',
      '[글쓰기 규칙]',
      '1. 첫 문단은 인사나 정의로 시작하지 말고, 검색자가 지금 겪는 상황이나 고민으로 바로 시작하세요.',
      '2. 각 소제목은 "## 소제목" 형식으로 쓰고, 소제목 아래에 2~4문단.',
      '3. 문단은 2~4문장. 길고 짧은 문장을 섞고, 한 문장은 대체로 40자 안팎.',
      '4. 다음 표현은 쓰지 마세요: 결론적으로, 이러한, ~에 대해 알아보겠습니다, 여러분, 마무리하며, 도움이 되셨길 바랍니다, 첫째·둘째·셋째 나열, 매우 중요합니다, 효과적입니다.',
      '5. 이모지는 본문 전체에서 3개 이하. 목록(bullet)은 꼭 필요한 한 곳에만.',
      '6. 구체적인 숫자·시간·상황·실패담을 넣어 직접 겪은 것처럼 쓰세요. 1인칭("저는", "제 경우")을 자연스럽게.',
      '7. 확인되지 않은 사실, 의학·법률·금융 단정, 광고성 과장은 금지합니다.',
      '8. 마지막 소제목은 한 문단 정리와 짧은 질문 하나로 끝내세요.',
      '9. 본문에 해시태그를 넣지 말고 hashtags 배열로 12~15개(# 기호 없이 단어만).',
      '',
      '출력(JSON만):',
      '{"title":"","body":"","hashtags":["",""]}'
    ].join('\n');
  }
};

/* ---------------------------------------------------------------- input */

function buildInput(step, raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const input = {
    topic: str(src.topic, LIMITS.topic),
    purpose: str(src.purpose, 20),
    audience: str(src.audience, LIMITS.audience),
    mustKeywords: str(src.mustKeywords, LIMITS.mustKeywords),
    tone: str(src.tone, 30)
  };
  if (!input.topic) throw bad('INPUT', '주제를 입력해 주세요.');

  if (step === 'keywords') return input;

  input.title = str(src.title, LIMITS.title);
  input.keywords = strList(src.keywords, LIMITS.keywords, LIMITS.keyword);
  input.targetChars = clampNumber(src.targetChars, 800, 5000, 2200);
  if (!input.title) throw bad('INPUT', '제목을 먼저 골라 주세요.');

  if (step === 'outline') return input;

  const sections = Array.isArray(src.outline) ? src.outline.slice(0, LIMITS.sections) : [];
  input.outline = sections.map((s) => ({
    h2_title: str(s && s.h2_title, 60),
    bullets: strList(s && s.bullets, LIMITS.bullets, 60)
  })).filter((s) => s.h2_title);
  if (!input.outline.length) throw bad('INPUT', '글 구조를 먼저 만들어 주세요.');
  return input;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function bad(code, message) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  return err;
}

/* ---------------------------------------------------------------- gemini */

function cleanJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s >= 0 && e > s) t = t.slice(s, e + 1);
  try {
    return JSON.parse(t);
  } catch (err) {
    const fixed = t.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixed);
  }
}

function extractText(body) {
  const cand = body && body.candidates && body.candidates[0];
  if (!cand) {
    const blocked = body && body.promptFeedback && body.promptFeedback.blockReason;
    const err = new Error(blocked
      ? '이 주제로는 답을 만들기 어렵다고 판단했어요. 표현을 조금 바꿔 보세요.'
      : 'AI가 빈 응답을 보냈어요. 다시 시도해 주세요.');
    err.code = 'EMPTY';
    err.status = 502;
    throw err;
  }
  const parts = (cand.content && cand.content.parts) || [];
  const text = parts.map((p) => p.text || '').join('');
  if (!text) {
    const err = new Error('AI가 빈 응답을 보냈어요. 다시 시도해 주세요.');
    err.code = 'EMPTY';
    err.status = 502;
    throw err;
  }
  return text;
}

async function callGemini(prompt, temperature, maxTokens) {
  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: temperature,
        topP: 0.95,
        maxOutputTokens: maxTokens || 8192,
        responseMimeType: 'application/json'
      }
    })
  });

  let body = null;
  try { body = await res.json(); } catch (err) { body = null; }

  if (!res.ok) {
    const apiMessage = body && body.error && body.error.message ? String(body.error.message) : '';
    let code = 'UPSTREAM';
    let status = 502;
    let message = 'AI 서버가 응답하지 않아요. 잠시 후 다시 시도해 주세요.';
    if (res.status === 429) {
      code = 'QUOTA';
      status = 429;
      message = 'AI 요청 한도를 넘었어요. 1분쯤 뒤에 다시 시도해 주세요.';
    } else if (res.status === 400 || res.status === 403) {
      code = 'KEY';
      status = 502;
      message = '서버의 Gemini 키가 올바르지 않거나 사용할 수 없어요. Vercel 환경변수 GEMINI_API_KEY 를 확인해 주세요.'
        + (apiMessage ? ' (' + apiMessage.slice(0, 120) + ')' : '');
    } else if (res.status === 404) {
      code = 'MODEL';
      message = '모델 이름(' + MODEL + ')을 찾을 수 없어요. GEMINI_MODEL 환경변수를 확인해 주세요.';
    }
    const err = new Error(message);
    err.code = code;
    err.status = status;
    throw err;
  }
  return extractText(body);
}

async function generateJson(prompt) {
  const first = await callGemini(prompt, 0.95, 8192);
  try {
    return cleanJson(first);
  } catch (err) {
    // 한 번만 더 시도합니다. (JSON이 깨져 오는 경우)
    const retryPrompt = prompt + '\n\n[중요] 방금 응답이 JSON으로 읽히지 않았습니다. 설명 없이 올바른 JSON 객체 하나만 다시 출력하세요.';
    const second = await callGemini(retryPrompt, 0.4, 8192);
    try {
      return cleanJson(second);
    } catch (err2) {
      const e = new Error('AI 응답을 해석하지 못했어요. 다시 시도해 주세요.');
      e.code = 'PARSE';
      e.status = 502;
      throw e;
    }
  }
}

/* ---------------------------------------------------------------- handler */

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      model: MODEL,
      hasKey: !!process.env.GEMINI_API_KEY
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, code: 'METHOD', message: 'POST 요청만 지원해요.' });
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({
      ok: false,
      code: 'NO_KEY',
      message: '서버에 GEMINI_API_KEY 가 설정되지 않았어요. Vercel 환경변수에 키를 넣어 주세요.'
    });
    return;
  }

  const ip = clientIp(req);
  if (!allow(ip)) {
    res.status(429).json({
      ok: false,
      code: 'RATE',
      message: '요청이 너무 잦아요. 10분 뒤에 다시 시도해 주세요.'
    });
    return;
  }

  const body = readBody(req);
  if (!body) {
    res.status(400).json({ ok: false, code: 'BODY', message: '요청 본문을 읽지 못했어요.' });
    return;
  }

  const step = String(body.step || '');
  if (STEPS.indexOf(step) === -1) {
    res.status(400).json({ ok: false, code: 'STEP', message: '알 수 없는 단계예요.' });
    return;
  }

  let input;
  try {
    input = buildInput(step, body.input);
  } catch (err) {
    res.status(err.status || 400).json({
      ok: false,
      code: err.code || 'INPUT',
      message: err.message || '입력값을 확인해 주세요.'
    });
    return;
  }

  try {
    const data = await generateJson(PROMPTS[step](input));
    res.status(200).json({ ok: true, model: MODEL, data: data });
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    res.status(status).json({
      ok: false,
      code: (err && err.code) || 'SERVER',
      message: (err && err.message) || '글을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'
    });
  }
};
