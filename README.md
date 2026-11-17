# 블로그 글 자동 생성기 (Gemini AI + 네이버 황금 키워드)

주제 한 줄만 넣으면 **① 주제·목적 → ② 황금 키워드·제목 3안 → ③ SEO 구조 → ④ 본문**까지 만들어 주는 웹툴입니다.
네이버 검색광고 API를 연결하면 각 키워드에 **실제 월간 검색량 / 블로그 문서수 / 황금지수**까지 붙습니다.

- 빌드 없음 — `index.html` 하나로 동작 (HTML/CSS/JS 인라인)
- 모바일·데스크톱 대응
- API 키는 **서버(Vercel 환경변수)** 에만 두고, 방문자는 키 없이 사용
- 네이버 키가 없어도 **Gemini만으로 정상 동작** (지표만 생략)
- 키 없이 화면을 볼 수 있는 **체험 데모 모드** 내장

---

## 1. 폴더 구조

```
blog-auto-generator/
├── index.html              # 화면 전체 (4단계 UI · 프롬프트 · 데모 데이터)
├── api/
│   ├── generate.js         # Gemini 프록시 (Vercel Serverless Function)
│   └── naver-keywords.js   # 네이버 검색량 · 블로그 문서수 조회
├── vercel.json             # 함수 실행시간 / 보안 헤더
├── package.json
└── README.md
```

---

## 2. 3가지 사용 모드

| 모드 | 언제 | 필요한 것 |
|---|---|---|
| **서버 모드** | Vercel에 배포했을 때 (권장) | `GEMINI_API_KEY` 환경변수 |
| **내 키 모드** | 파일로 열거나 로컬에서 쓸 때 | Google AI Studio Gemini API 키 (브라우저 localStorage에 저장) |
| **체험 데모** | 키가 아직 없을 때 | 없음 (예시 데이터로 4단계 화면 확인) |

오른쪽 위 **`API 설정`** 버튼에서 키를 넣거나 데모를 켤 수 있습니다.

---

## 3. 바로 열어 보기 (데모)

1. `index.html` 을 더블클릭해서 브라우저로 엽니다.
2. 오른쪽 위 **API 설정 → 🧪 체험 데모 켜기**.
3. 주제를 넣고 `🔍 황금 키워드 찾기` 를 눌러 4단계를 끝까지 따라가 봅니다.

> 데모는 실제 AI가 아닙니다. 화면과 흐름만 확인하는 용도예요.

---

## 4. 내 Gemini 키로 쓰기 (로컬, 2분)

1. <https://aistudio.google.com/apikey> 접속 → Google 계정으로 로그인
2. **Create API key** → 프로젝트 선택(없으면 자동 생성) → 키 복사 (`AIza...`)
3. `index.html` 열고 **API 설정** → 키 붙여넣기 → **저장**

- 키는 그 브라우저의 `localStorage`(`bloggen.gemini.key`)에만 저장되고 서버로 보내지 않습니다.
- **삭제** 버튼을 누르면 바로 지워집니다.
- 무료 티어에도 분당·일일 한도가 있습니다. 한도에 걸리면 `요청 한도를 넘었어요` 안내가 뜨고, 1분 뒤 다시 시도하면 됩니다.
- `file://` 로 열면 브라우저에 따라 API 호출이 막힐 수 있습니다. 그럴 때는 폴더에서 아래처럼 로컬 서버를 띄워 `http://localhost:3000` 으로 여세요.

```bash
npx serve .          # Node.js 필요
# 또는
python3 -m http.server 3000
```

---

## 5. Vercel 배포 (3분) — 방문자는 키 없이 사용

### 방법 A. GitHub + Vercel (클릭 몇 번)

1. 이 `blog-auto-generator` 폴더를 GitHub 저장소로 올립니다.
2. <https://vercel.com/new> → **Import Git Repository** → 저장소 선택
3. Framework Preset: **Other**, Build Command: 비움, Output Directory: 비움 (그대로 두면 됩니다)
4. **Environment Variables** 에 아래를 추가

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | AI Studio에서 받은 키 |

5. **Deploy** → `https://내프로젝트.vercel.app` 접속

### 방법 B. Vercel CLI

```bash
npm i -g vercel
cd blog-auto-generator
vercel                 # 프로젝트 연결 (처음 한 번)
vercel env add GEMINI_API_KEY production   # 키 붙여넣기
vercel --prod
```

배포 후 확인:

```bash
curl https://내프로젝트.vercel.app/api/generate
# {"ok":true,"model":"gemini-2.5-flash","hasKey":true}
```

`hasKey` 가 `false` 면 환경변수가 저장되지 않은 것입니다. Vercel → Settings → Environment Variables 에서 추가하고 **Redeploy** 하세요.

---

## 6. 네이버 황금 키워드 연결 (선택 · 강력 추천)

연결하면 2단계 키워드마다 이런 배지가 붙습니다.

```
서브 키워드
[ 블로그 상위노출  월 12,400 · 문서 3,120 · 지수 0.25 ]
```

- **월간 검색량** = PC + 모바일 (네이버 검색광고 키워드도구 기준)
- **블로그 문서수** = 그 키워드로 검색되는 네이버 블로그 글 수
- **황금지수 = 문서수 ÷ 월간 검색량** — 낮을수록 "수요는 있는데 글이 적은" 키워드입니다
  - `0.6 이하` → 노리기 좋은 구간 (초록)
  - `1.5 초과` → 이미 포화 (빨강)
  - 공식 지표가 아니라 비교용으로 만든 값입니다
- **참고**: 검색광고 API의 `compIdx`(낮음/중간/높음)는 **광고 입찰 경쟁도**입니다. 블로그 글 경쟁도와는 다르므로 이 툴은 화면에 쓰지 않고 데이터만 받아 둡니다.

### 6-1. 검색광고 API 키 3개 (검색량)

1. <https://searchad.naver.com> 로그인 (네이버 광고주 계정 — 없으면 광고 계정을 새로 만듭니다)
2. 상단 **도구 → API 사용 관리**
3. 세 값을 복사합니다.

   | 화면 표기 | 환경변수 이름 |
   |---|---|
   | 액세스라이선스 | `NAVER_AD_API_KEY` |
   | 비밀키 | `NAVER_AD_SECRET_KEY` |
   | CUSTOMER_ID (광고계정 번호) | `NAVER_AD_CUSTOMER_ID` |

4. Vercel → Settings → Environment Variables 에 3개 추가 → **Redeploy**

> **주의**
> - 비밀키는 base64 문자열이라 `l`/`I`, `0`/`O` 가 헷갈립니다. 반드시 **복사 버튼**으로 옮기세요. 한 글자만 틀려도 `Invalid Signature` 만 돌아옵니다.
> - 키워드 조회는 **무료**입니다. 광고를 집행하지 않아도 됩니다.
> - 이 API는 2026년 검색 API 이관과 무관합니다. 계속 `api.searchad.naver.com` 을 씁니다.

이 툴이 대신 처리하는 것들:

- 서명 생성: `base64(HMAC-SHA256(비밀키, "{밀리초타임스탬프}.GET./keywordstool"))`
- `hintKeywords` 는 **한 번에 5개**까지만 되므로 5개씩 나눠 호출
- 키워드의 **공백 제거** (공백이 있으면 400 오류)
- 검색량이 적으면 `"< 10"` 같은 **문자열**로 오기 때문에 숫자로 변환
- 초당 호출 제한을 피하려고 호출 사이에 간격을 둠

### 6-2. 블로그 문서수 (NAVER API HUB)

> 2026년 7월 31일부터 네이버 개발자센터의 **검색 API 신규 신청이 종료**되고, NAVER API HUB(네이버 클라우드 플랫폼)로 이관되었습니다. 지금 새로 시작한다면 **HUB 키**를 발급받으세요.

1. <https://console.ncloud.com/naver-api-hub/application> 접속 (NCP 계정 필요 — 없으면 가입)
2. **Application 등록** → 이름 입력 → **검색(Search)** API 선택 → 등록
3. 해당 Application → **인증 정보** 에서 Client ID / Client Secret 복사
4. Vercel 환경변수에 추가

   | Name | Value |
   |---|---|
   | `NAVER_HUB_CLIENT_ID` | Client ID (`X-NCP-APIGW-API-KEY-ID`) |
   | `NAVER_HUB_CLIENT_SECRET` | Client Secret (`X-NCP-APIGW-API-KEY`) |

**기존 개발자센터 키가 이미 있다면** 그대로 써도 됩니다. (기존 키는 2027년 6월 30일까지 유효)

| Name | Value |
|---|---|
| `NAVER_CLIENT_ID` | 애플리케이션 Client ID |
| `NAVER_CLIENT_SECRET` | Client Secret |

`NAVER_HUB_*` 가 있으면 HUB를, 없으면 `NAVER_CLIENT_*` 를 자동으로 사용합니다.
블로그 검색 API는 하루 25,000회 한도이고, 이 툴은 키워드당 1회(요청당 최대 8회)만 호출합니다.

### 6-3. 연결 확인

```bash
curl https://내프로젝트.vercel.app/api/naver-keywords
# {"ok":true,"naver_connected":true,"ad_connected":true,"blog_connected":true,"blog_source":"hub"}
```

`naver_connected: false` 면 환경변수가 비어 있는 것입니다. 앱은 그대로 Gemini 모드로 동작합니다.

### 6-4. 지표가 안 보일 때

| 증상 | 원인 / 해결 |
|---|---|
| 안내 문구만 나옴 | 환경변수 미설정 → 추가 후 Redeploy |
| 검색량만 나오고 문서수 없음 | `NAVER_HUB_*` / `NAVER_CLIENT_*` 미설정 또는 블로그 검색 API 미구독 |
| `인증 실패` | 비밀키 오타(복사 버튼 사용), CUSTOMER_ID 는 숫자만 |
| `호출 한도` | 잠시 뒤 재시도 (결과는 10분 캐시됨) |
| 값이 `-` | 검색량이 10 미만이거나 결과에 없는 키워드 |

---

## 7. 화면 흐름

| 단계 | 하는 일 | Gemini가 만드는 것 |
|---|---|---|
| 1 · 주제·목적 | 주제, 목적·분위기(선택), 타깃·필수 키워드·말투 | — |
| 2 · 키워드·제목 | 서브/연관 키워드 토글, 제목 3안 선택·수정 | `sub_keywords`, `related_keywords`, `title_candidates` |
| 2 · 네이버 지표 | 키워드별 검색량·문서수·황금지수, 노릴 만한 조합 추천 | (네이버 API) |
| 3 · SEO 구조 | 소제목·포인트 직접 수정, 분량 선택 | `estimated_chars`, `sections[]` |
| 4 · 본문 | 제목·본문·해시태그, 글자수(공백 포함/제외), 키워드 포함 확인, 전체 복사 | `title`, `body`, `hashtags[]` |

프롬프트에는 다음이 들어 있습니다.

- 첫 문단은 인사·정의가 아니라 **독자가 겪는 상황**으로 시작
- `결론적으로`, `이러한`, `~에 대해 알아보겠습니다`, `여러분`, `마무리하며`, `첫째·둘째·셋째` 등 **AI 상투 표현 금지**
- 문단 2~4문장, 길고 짧은 문장 섞기, 구체적 숫자·실패담 넣기
- 사실·의학·법률·금융 단정 금지, 과장 금지
- 목표 글자수의 ±15%

---

## 8. 환경변수 전체

| Name | 필수 | 설명 |
|---|---|---|
| `GEMINI_API_KEY` | ✅ (서버 모드) | Google AI Studio 키 |
| `GEMINI_MODEL` | — | 기본 `gemini-2.5-flash` |
| `NAVER_AD_API_KEY` | 선택 | 검색광고 액세스라이선스 |
| `NAVER_AD_SECRET_KEY` | 선택 | 검색광고 비밀키 (서명용, 외부로 나가지 않음) |
| `NAVER_AD_CUSTOMER_ID` | 선택 | 검색광고 CUSTOMER_ID |
| `NAVER_HUB_CLIENT_ID` | 선택 | NAVER API HUB Client ID |
| `NAVER_HUB_CLIENT_SECRET` | 선택 | NAVER API HUB Client Secret |
| `NAVER_CLIENT_ID` | 선택(대체) | 개발자센터 Client ID (2027-06-30까지) |
| `NAVER_CLIENT_SECRET` | 선택(대체) | 개발자센터 Client Secret |

`NAVER_AD_*` 없이 `NAVER_HUB_*` 만 있어도 문서수만 표시됩니다.

---

## 9. 보안 · 비용 · 제한

- **키는 절대 `index.html` 에 넣지 마세요.** 배포된 HTML은 누구나 볼 수 있습니다. 브라우저에서 직접 Gemini를 호출하는 건 "내 키 모드"(본인 PC)에서만 쓰는 방식입니다.
- 서버 모드에서 요청은 `/api/generate` 를 거치고, 프롬프트도 **서버가 step + 입력값으로 직접 만듭니다.** 방문자가 임의 프롬프트를 보내 과금을 키우는 구조가 아닙니다.
- 요청 제한: IP당 10분에 생성 20회 / 네이버 조회 40회 (메모리 기반이라 서버리스 인스턴스마다 따로 셉니다. 엄격한 제한이 필요하면 Vercel Firewall 이나 Upstash Rate Limit 을 붙이세요.)
- 입력 길이 제한: 주제 120자, 제목 120자, 키워드 40자 × 14개, 소제목 6개.
- 네이버 조회 결과는 서버에서 10분간 캐시합니다.
- 비용: Vercel Hobby 무료 범위, Gemini 무료 티어(한도 있음), 네이버 조회 무료. 트래픽이 커지면 Gemini 유료 티어와 Vercel Pro를 고려하세요.
- 응답 속도: 본문 생성은 보통 10~30초, 함수 최대 실행시간은 60초로 잡아 두었습니다.

---

## 10. 고치고 나서 확인하기

```bash
node --check api/generate.js
node --check api/naver-keywords.js
# index.html 안의 스크립트 확인
python3 - <<'PY'
import re, subprocess, tempfile
html = open('index.html', encoding='utf-8').read()
js = re.search(r'<script>(.*?)</script>', html, re.S).group(1)
open('/tmp/check.js','w',encoding='utf-8').write(js)
print(subprocess.run(['node','--check','/tmp/check.js'], capture_output=True, text=True))
PY
```

로컬에서 서버까지 함께 확인하려면:

```bash
vercel dev      # http://localhost:3000 — /api 함수도 같이 뜹니다
```

---

## 11. 자주 고치는 곳

| 바꾸고 싶은 것 | 위치 |
|---|---|
| AI 말투·글쓰기 규칙 | `index.html` 의 `PROMPTS`, `api/generate.js` 의 `PROMPTS` (**두 곳을 같이** 고치세요) |
| 모델 변경 | `index.html` 의 `MODEL`, 서버는 `GEMINI_MODEL` 환경변수 |
| 색상·디자인 | `index.html` 상단 `:root` 변수 (`--blue` 등) |
| 요청 제한 횟수 | `api/*.js` 의 `MAX_PER_WINDOW` |
| 블로그 문서수 조회 개수 | `api/naver-keywords.js` 의 `MAX_DOC_KEYWORDS` |
| 키워드 개수 | `PROMPTS` 의 "5개" 문구와 `normalizeKeywords` |

---

## 12. 꼭 알아 두세요

- 결과물은 **AI 초안**입니다. 숫자·제품 정보·인용은 반드시 확인하고, 내가 겪은 한 줄을 더해야 글이 살아납니다.
- 체험단·협찬 글에는 공정위 문구(경제적 이해관계 표시)를 맨 앞에 넣어야 합니다.
- 네이버 블로그는 복사한 글을 그대로 올리는 것보다 **사진·경험을 더해 재편집**하는 쪽이 노출에 유리합니다. 이 툴은 "빈 화면에서 시작하지 않기" 위한 도구로 쓰세요.
- 네이버 API 약관상 조회 결과의 저장·재배포 범위는 약관을 확인하세요. 이 툴은 화면 표시용으로만 10분 캐시합니다.
