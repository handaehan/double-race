/* =========================================================
   Investment Race Studio — 메인 스크립트
   - 좌측 설정 패널로 모든 콘텐츠 편집
   - CSV 붙여넣기 / 시리즈 동적 추가/제거
   - 라인 끝 라벨 / 축 옵션 / 실시간 1위 강조
   ========================================================= */

/* =========================================================
   0. 상수 / 기본 색상
   ========================================================= */
const DEFAULT_COLORS = [
  '#4FC3F7', // 파랑
  '#EC407A', // 핑크
  '#FFD54F', // 노랑
  '#66BB6A', // 그린
  '#AB47BC', // 퍼플
  '#FF7043'  // 오렌지
];

const MAX_SERIES = 6;
const FINISH_GLOW_DURATION = 2600;

/* =========================================================
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   💰 금액 단위 정책 (반드시 읽을 것)
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   원칙: "데이터 한 묶음 내에서 모든 숫자는 같은 단위(RACE.unit) 로 통일"

      [내부 계산]
        - RACE.unit 이 가리키는 단위 하나로 모든 값이 통일됨.
        - CSV 의 모든 셀, INVESTMENT.amount, displayPrincipal,
          시뮬레이션의 shares×price 계산, 차트 y 값 ─ 전부 같은 단위.
        - 단위가 일관되어 있으면 수학은 unit-invariant (단위 무관) 하게 동작.

      [화면 출력]
        - formatMoney(value, RACE.unit) 한 곳만 통과.
        - 값 크기에 따라 자동으로 "2.75억" / "8,250만" 형태로 변환.

      [단위 결정 우선순위]
        1) Python 이 CSV 첫 줄에 적은 '# unit: 만원' 메타 → 자동 적용
        2) 사용자가 사이드바 "값 단위" 입력란에 직접 적은 값
        3) 기본 '만원'

   ❌ 절대 금지:
        - 같은 RACE 안에서 값 일부는 만원, 일부는 원으로 섞기
        - "이건 원이니까 10000 곱해서 비교" 같은 즉석 변환
   ✅ 추천:
        - 단위를 바꾸고 싶으면 Python 에서 OUTPUT_UNIT_DIVIDER 와 # unit:
          을 함께 바꿔 새 CSV 를 생성.
   ========================================================= */

/* =========================================================
   1. RACE 데이터 (단일 진실 — 편집 시 이 객체만 업데이트)
   ========================================================= */
/* RACE 의 series 는 이제 각각 `symbol` 을 가진다.
   웹은 init 시 ./db/manifest.json 을 읽고, 각 series.symbol 에 해당하는
   ./db/<symbol>.csv (date,price) 를 가져와 values 에 채워 넣는다.
   manifest 에 종목이 없으면 그래프에서 빠지고 사용자에게 경고. */
const RACE = {
  // 빈 값 = 자동 생성. INVESTMENT 설정에서 후크 카피 자동 산출
  // (예: "매월 30만원씩\n16년 모았다면?" / "10년 전\n1억을 넣었다면?").
  // 사용자가 사이드바에 직접 적으면 그 값이 우선.
  title: '',
  subtitle: '',
  unit: '원',
  periodUnit: 'month',
  investPerPeriod: 0,
  dates: [],
  series: [
    { name: 'S&P500', symbol: 'sp500', color: '#EC407A',
      icon: { type: 'auto', value: null }, values: [] },
    { name: '코스피', symbol: 'kospi', color: '#4FC3F7',
      icon: { type: 'auto', value: null }, values: [] }
  ]
};

// 종목 메타 — ./db/manifest.json 으로부터 로드. DB 페이지와 데이터 검증이 참조.
let MANIFEST = { updated_at: null, tickers: {} };

// 표시 옵션 — 레퍼런스에 맞춰 축 기본 ON, 추월 이벤트는 기본 OFF
const VIEW = {
  showX: true,
  showY: true,
  showGrid: false,
  showEndLabel: true,
  showOvertake: false   // 그래프 시청 우선 — 기본 비활성
};

// 투자 시뮬레이션 설정 — 기본 ON.
// 종료일은 페이지 로드 시점의 "현재월". 시작일은 정확히 "10년 전" 동적 계산
// (하드코딩 X — 배포 후 시간 지나도 자동 10년 유지).
function _currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function _yearsAgoYearMonth(years) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const INVESTMENT = {
  enabled: true,
  mode: 'monthly',
  amount: 1000000,                       // 100만원 (원 단위)
  startDate: _yearsAgoYearMonth(10),     // 현재 기준 정확히 10년 전
  endDate:   _currentYearMonth()
};

/* 기본값 스냅샷 — "기본값 복원" 버튼이 이 값으로 RACE/VIEW/INVESTMENT 를
   리셋한다. JSON 직렬화로 깊은 복사. */
const DEFAULTS = JSON.parse(JSON.stringify({ RACE, VIEW, INVESTMENT }));

/* =========================================================
   2. DOM 참조
   ========================================================= */
// 미리보기
const titleEl     = document.getElementById('title');
const dateEl      = document.getElementById('date');
const progressBar = document.getElementById('progressBar');
const chartDom    = document.getElementById('chart');
const bannerEl    = document.getElementById('banner');
const frameEl     = document.getElementById('frame');

// 재생 컨트롤
// 구버전 frame-bottom 컨트롤은 새 UX 에서 제거되었지만 다른 코드 호환을 위해
// 참조만 유지 (없으면 null). 핸들러는 null-guard 처리.
const playBtn  = document.getElementById('playBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resetBtn = document.getElementById('resetBtn');
const speedBtn = document.getElementById('speedBtn');

// 새 사이드바 컨트롤 (3단계: 영상 실행)
const sbRestartBtn = document.getElementById('btn-restart-play');
const sbPlayBtn    = document.getElementById('btn-sb-play');
const sbPauseBtn   = document.getElementById('btn-sb-pause');
const generateDataBtn = document.getElementById('btn-generate-data');

// 사이드바 입력
const titleInput      = document.getElementById('inp-title');
const subtitleInput   = document.getElementById('inp-subtitle');
const unitInput       = document.getElementById('inp-unit');
const periodInput     = document.getElementById('inp-period');
const speedInput      = document.getElementById('inp-speed');
const showXInput      = document.getElementById('inp-show-x');
const showYInput      = document.getElementById('inp-show-y');
const showGridInput   = document.getElementById('inp-show-grid');
const showEndLabelInput = document.getElementById('inp-show-endlabel');
const showOvertakeInput = document.getElementById('inp-show-overtake');
const csvInput        = document.getElementById('inp-csv');
const seriesListEl    = document.getElementById('series-list');
const addSeriesBtn    = document.getElementById('btn-add-series');
const csvLoadBtn      = document.getElementById('btn-csv-load');
const csvSyncBtn      = document.getElementById('btn-csv-sync');
const csvReloadBtn    = document.getElementById('btn-csv-reload');
const applyBtn        = document.getElementById('btn-apply');

// 투자 시뮬레이션 입력
const simEnabledInput = document.getElementById('inp-sim-enabled');
const simModeInput    = document.getElementById('inp-sim-mode');
const simAmountInput  = document.getElementById('inp-sim-amount');
const simStartInput   = document.getElementById('inp-sim-start');
const simEndInput     = document.getElementById('inp-sim-end');

// 미리보기 부가 영역 (새 구조)
const subtitleEl      = document.getElementById('subtitle');
const chartLegendEl   = document.getElementById('chartLegend');
const resultsEl       = document.getElementById('results');
const endpointOverlay = document.getElementById('endpointOverlay');
// 구버전 호환: 존재할 수도 있음
const investInfoEl    = document.getElementById('investInfo');
const legendEl        = document.getElementById('legend');

/* =========================================================
   3. ECharts 초기화
   ========================================================= */
const chart = echarts.init(chartDom, null, { renderer: 'canvas' });
new ResizeObserver(() => chart.resize()).observe(chartDom);
window.addEventListener('resize', () => chart.resize());

/* =========================================================
   4. 파생값 / displaySeries / displayDates
      - 시뮬레이션 OFF : displayDates = RACE.dates
      - 시뮬레이션 ON  : displayDates = simulate() 가 만든 달력 타임라인
   ========================================================= */
let X_MAX, FULL_MIN, FULL_MAX, MIN_RANGE;

// 전체 애니메이션 길이(초) — 데이터 길이에 무관하게 일정 시간에 완주
let DURATION_SECONDS = 12;

let displayDates     = RACE.dates;
let displaySeries    = RACE.series;
let displayPrincipal = null;   // 투자금액(원금) 시계열 — 차트의 회색 점선 + 카드 원금 계산용
let displayDateTimes = [];     // 시간축용 timestamp 배열 (parseDate 결과)

/*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📊 CSV "가격" → 그래프 "평가금" — 단일 계산 경로
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   계약: CSV 값은 항상 "가격(price)" 이다. Python 도 가격만 저장.
        DCA 계산(shares += amount/price, value = shares × price) 은
        이 함수 안에서 **단 한 번만** 수행된다.  이중 계산 금지.

       wantsSim  = INVESTMENT.enabled && INVESTMENT.amount > 0
       runSim=T  → simulate() : values = portfolioValues, 원금 = sim 합산
       runSim=F  → values 그대로 표시.  원금은 amount × (i+1) 로 선형 합성
                  (sim 끈 상태에서도 카드의 원금/수익률 줄을 유지하기 위해)
*/
function refreshDisplaySeries() {
  let principalArr = null;

  // 모드 변경 시 UI (CTA / 헤더 텍스트 / .investment-only) 자동 동기화
  applyModeToUI();

  // sports 모드 (모든 시리즈 cumulative_sum) 에선 DCA 무관 — 누적값을 그대로 표시
  const wantsSim = INVESTMENT.enabled && INVESTMENT.amount > 0 && !_allSeriesCumulative();

  if (wantsSim) {
    // 가격 데이터 → DCA 시뮬레이션 → 평가금 시계열 (이중 계산 방지: 여기 한 곳에서만)
    const sim = simulate(RACE, INVESTMENT);
    if (sim) {
      displayDates  = sim.dates;
      displaySeries = RACE.series.map((s, i) => ({
        name:   s.name,
        color:  s.color,
        symbol: s.symbol,
        icon:   s.icon || { type: 'auto', value: null },
        values: sim.series[i].portfolioValues,
        _principalSeries: sim.series[i].principalSeries,
        _finalPrincipal:  sim.series[i].finalPrincipal,
        _finalValue:      sim.series[i].finalValue
      }));
      principalArr = sim.series[0].principalSeries;
    } else {
      // 범위/날짜 오류로 sim 실패 → raw 폴백
      displayDates  = RACE.dates;
      displaySeries = RACE.series;
    }
  } else {
    // sim 비활성: 가격 그대로 표시. 원금은 사이드바 amount 로 선형 합성 — 단,
    // sports 모드는 투자금 개념이 없으므로 회색 점선/기준선/예상선 모두 OFF.
    displayDates  = RACE.dates;
    displaySeries = RACE.series;
    if (INVESTMENT.amount > 0 && RACE.dates.length && !_allSeriesCumulative()) {
      principalArr = RACE.dates.map((_, i) => INVESTMENT.amount * (i + 1));
    }
  }

  displayPrincipal = principalArr;

  /* sports 모드 디버그 로그 — 콘솔에서 데이터/모드/우승자 검증 */
  if (_allSeriesCumulative()) {
    const maxes = RACE.series.map(s =>
      (s._prices && s._prices.length) ? Math.max(...s._prices) : 0
    );
    const overallMax = Math.max(0, ...maxes);
    const hasData    = overallMax > 0;
    const yMax       = hasData ? Math.max(100, overallMax * 1.1) : null;
    const winnerIdx  = hasData ? maxes.indexOf(overallMax) : -1;
    const winner     = winnerIdx >= 0 ? (RACE.series[winnerIdx].name || null) : null;
    console.log('[SPORTS]', {
      mode:    getCurrentMode(),
      hasData: hasData,
      yMax:    yMax,
      winner:  winner,
      series:  RACE.series.map((s, i) => ({ name: s.name, max: maxes[i] }))
    });
  }

  // 타임스탬프 배열 (시간축용). 파싱 실패 시 균등 분포 fallback.
  displayDateTimes = displayDates.map((d, i) => {
    const p = parseDate(d);
    return p ? p.getTime() : i;
  });

  recomputeDerived();
}

function recomputeDerived() {
  X_MAX = Math.max(0, displayDates.length - 1);
  const flat = displaySeries.flatMap(s => s.values).filter(Number.isFinite);
  FULL_MIN  = flat.length ? Math.min(...flat) : 0;
  FULL_MAX  = flat.length ? Math.max(...flat) : 100;
  const range = FULL_MAX - FULL_MIN;
  MIN_RANGE = range > 0 ? range * 0.20 : 20;
}

/* =========================================================
   5. 재생 상태
   ========================================================= */
let progress    = 0;
let speedMul    = 1;       // 하단 버튼 x1/x2/x4
let playing     = false;
let lastTime    = 0;
let finishedAt  = null;

let yMinSmooth = null;
let yMaxSmooth = null;
let xMaxSmooth = null;     // 동적 X축 — 라인이 항상 우측 가까이 닿도록 progress 따라 확장
let prevDiffs  = {};

/* =========================================================
   6. 유틸
   ========================================================= */
function lerp(a, b, t) { return a + (b - a) * t; }

// 시간축(type:'time') 용 [timestamp, value] 점 배열을 progress 까지 만든다
function buildLine(values, dateTimes, p) {
  if (p >= values.length - 1) {
    return values.map((v, i) => [dateTimes[i], v]);
  }
  const floor = Math.floor(p);
  const frac  = p - floor;
  const out   = [];
  for (let i = 0; i <= floor; i++) out.push([dateTimes[i], values[i]]);
  if (frac > 0) {
    const t = lerp(dateTimes[floor], dateTimes[floor + 1], frac);
    const v = lerp(values[floor], values[floor + 1], frac);
    out.push([t, v]);
  }
  return out;
}

function valueAt(values, p) {
  if (p >= values.length - 1) return values[values.length - 1];
  const floor = Math.floor(p);
  return lerp(values[floor], values[floor + 1], p - floor);
}

function dateAt(p) {
  return displayDates[Math.min(Math.floor(p), displayDates.length - 1)] || '';
}

// 진행도 p 시점의 timestamp (시간축 동적 스케일링용)
function timeAt(p) {
  if (!displayDateTimes.length) return 0;
  if (p >= displayDateTimes.length - 1) return displayDateTimes[displayDateTimes.length - 1];
  if (p <= 0) return displayDateTimes[0];
  const floor = Math.floor(p);
  return lerp(displayDateTimes[floor], displayDateTimes[floor + 1], p - floor);
}

// 한국어 주격 조사 (이/가)
function subjectParticle(name) {
  if (!name) return '이';
  const last = name.charCodeAt(name.length - 1);
  if (last < 0xAC00 || last > 0xD7A3) return '이';
  return ((last - 0xAC00) % 28) === 0 ? '가' : '이';
}

function rgbaFromHex(hex, a = 0.5) {
  const c = (hex || '#ffffff').replace('#', '');
  const r = parseInt(c.slice(0, 2), 16) || 0;
  const g = parseInt(c.slice(2, 4), 16) || 0;
  const b = parseInt(c.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// 숫자 포맷: 1,234 형태 (큰 값 가독성)
function fmtNum(n) {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('ko-KR');
}

// 소수점 trailing 0 제거: 2.50 → "2.5", 3.00 → "3", 2.75 → "2.75"
function trimZero(n, decimals) {
  return n.toFixed(decimals).replace(/\.?0+$/, '');
}

// 값 크기에 따라 소수 자리 자동 조정 (큰 수는 0자리, 중간 1자리, 작은 수 2자리)
function fmtScalar(n) {
  const abs = Math.abs(n);
  if (abs >= 100) return Math.round(n).toLocaleString('ko-KR');
  if (abs >= 10)  return trimZero(n, 1);
  return trimZero(n, 2);
}

/*
   금액 자동 단위 변환.
   baseUnit 이 무엇이냐에 따라 값을 더 큰 단위로 바꿔서 보기 좋게 만든다.

     baseUnit = '만원':
       값 >= 10000(만원=1억) → 억원
       그 외 → 만원
     baseUnit = '원':
       값 >= 1억 → 억원
       값 >= 1만 → 만원
       그 외 → 원
     기타 단위 (USD 등): 변환 없이 천 단위 콤마

   반환: { text, unit }  — 합치면 그대로 표시 문자열
*/
function fmtMoney(value, baseUnit) {
  if (!Number.isFinite(value)) return { text: '0', unit: baseUnit || '' };
  const abs = Math.abs(value);

  if (baseUnit === '만원') {
    if (abs >= 10000) return { text: fmtScalar(value / 10000), unit: '억원' };
    return { text: Math.round(value).toLocaleString('ko-KR'), unit: '만원' };
  }
  if (baseUnit === '원') {
    if (abs >= 100000000) return { text: fmtScalar(value / 100000000), unit: '억원' };
    if (abs >= 10000)     return { text: Math.round(value / 10000).toLocaleString('ko-KR'), unit: '만원' };
    return { text: Math.round(value).toLocaleString('ko-KR'), unit: '원' };
  }
  return { text: Math.round(value).toLocaleString('ko-KR'), unit: baseUnit || '' };
}

function fmtMoneyStr(value, baseUnit) {
  const m = fmtMoney(value, baseUnit);
  return m.text + m.unit;
}

/*
   숏츠용 짧은 금액 표기 — 레퍼런스 스타일
     formatMoney(28000, '만원') → "2.8억"
     formatMoney(27452, '만원') → "2.75억"
     formatMoney(7625,  '만원') → "7,625만"
     formatMoney(300,   '만원') → "300만"
     formatMoney(300000, '원')  → "30만"
     formatMoney(280000000, '원') → "2.8억"
   USD 등 기타 단위는 천 단위 콤마만 적용.
*/
function formatMoney(value, baseUnit = '만원') {
  if (!Number.isFinite(value)) return '0';

  // 한국 통화가 아니면 천 단위 콤마만
  if (baseUnit && baseUnit !== '만원' && baseUnit !== '원' && baseUnit !== '억원') {
    return `${Math.round(value).toLocaleString('ko-KR')}${baseUnit}`;
  }

  // 항상 "만원" 단위로 정규화
  let manwon = value;
  if (baseUnit === '원')   manwon = value / 10000;
  if (baseUnit === '억원') manwon = value * 10000;

  const abs = Math.abs(manwon);

  // 1억 (=10000만) 이상 → 억 단위
  if (abs >= 10000) {
    const eok = manwon / 10000;
    if (Math.abs(eok) >= 100) return `${Math.round(eok).toLocaleString('ko-KR')}억`;
    if (Math.abs(eok) >= 10)  return `${trimZero(eok, 1)}억`;
    return `${trimZero(eok, 2)}억`;
  }
  // 그 외 → 만 단위
  return `${Math.round(manwon).toLocaleString('ko-KR')}만`;
}

// 수익률 표기 (+16% / +75% / -3.2% 식으로 콘텐츠용)
function fmtPct(p) {
  if (!Number.isFinite(p)) return '0%';
  const sign = p >= 0 ? '+' : '';
  const abs  = Math.abs(p);
  if (abs >= 10) return `${sign}${Math.round(p)}%`;
  return `${sign}${p.toFixed(1)}%`;
}

// 자연어 기간 ("10년간", "8년 4개월간", "9개월간")
function fmtPeriodKr(startD, endD) {
  if (!startD || !endD) return '';
  const months = (endD.getFullYear() - startD.getFullYear()) * 12
               + (endD.getMonth() - startD.getMonth());
  if (months >= 12) {
    const y = Math.floor(months / 12);
    const m = months % 12;
    return m === 0 ? `${y}년간` : `${y}년 ${m}개월간`;
  }
  return `${Math.max(1, months)}개월간`;
}

function freqKr(mode) {
  return mode === 'lump'    ? '일시'
       : mode === 'daily'   ? '매일'
       : mode === 'weekly'  ? '매주'
       : '매월';
}

// 날짜 → 한국어
//   2010-01     → "2010년 1월"
//   2010-01-15  → "2010년 1월 15일"
//   2010        → "2010년"
function fmtDateKr(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})[-./]?(\d{1,2})?[-./]?(\d{1,2})?/);
  if (!m) return dateStr;
  const y = m[1];
  if (m[3]) return `${y}년 ${parseInt(m[2], 10)}월 ${parseInt(m[3], 10)}일`;
  if (m[2]) return `${y}년 ${parseInt(m[2], 10)}월`;
  return `${y}년`;
}

function modeLabel(m) {
  return m === 'lump'    ? '일시투자'
       : m === 'daily'   ? '매일 적립'
       : m === 'weekly'  ? '매주 적립'
       : m === 'monthly' ? '매월 적립'
       : m;
}

/* =========================================================
   6-b. 날짜 파싱 / 범위 / 시뮬레이션
   ========================================================= */
function parseDate(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})[\-./]?(\d{1,2})?[\-./]?(\d{1,2})?/);
  if (!m) return null;
  const y  = +m[1];
  const mo = m[2] ? +m[2] - 1 : 0;
  const d  = m[3] ? +m[3] : 1;
  return new Date(y, mo, d);
}

function isWithinRange(dateStr, start, end) {
  if (!start && !end) return true;
  const d = parseDate(dateStr);
  if (!d) return true;
  if (start) {
    const s = parseDate(start);
    if (s && d < s) return false;
  }
  if (end) {
    const e = parseDate(end);
    if (e && d > e) return false;
  }
  return true;
}

// ----- 날짜 / 가격 lookup 헬퍼 -----

// 디스플레이용 라벨 포맷 (애니메이션 X축 라벨)
function fmtDateStr(d, resolution) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  if (resolution === 'month') return `${y}-${m}`;
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 기간 길이에 따라 X축에 찍을 점 간격 선택 (점 수 ~200개 이내)
function pickResolution(startD, endD) {
  const days = (endD - startD) / 86400000;
  if (days <= 90)   return 'day';     // 3개월 이하 → 일별
  if (days <= 1100) return 'week';    // 약 3년 이하 → 주별
  return 'month';                     // 그 이상 → 월별
}

// 시작~종료 사이의 디스플레이 타임라인 (X축에 표시될 Date 배열)
function genTimeline(startD, endD, resolution) {
  const out = [];
  const cur = new Date(startD); cur.setHours(0, 0, 0, 0);
  const end = new Date(endD);   end.setHours(0, 0, 0, 0);
  // 매월 적립인데 1일이 아닌 시작일이면 그대로 사용. cursor 가 endD 를 넘기 전까지 push.
  while (cur <= end) {
    out.push(new Date(cur));
    if (resolution === 'day')        cur.setDate(cur.getDate() + 1);
    else if (resolution === 'week')  cur.setDate(cur.getDate() + 7);
    else                             cur.setMonth(cur.getMonth() + 1);
  }
  // 마지막 점이 endD 가 아니면 endD 도 추가해서 정확히 그 시점에 끝나도록
  if (out.length && out[out.length - 1].getTime() !== end.getTime()) {
    out.push(new Date(end));
  }
  return out;
}

// 실제 매수 이벤트 시점 배열 (mode 에 따라 일/주/월/일시)
function genInvestEvents(startD, endD, mode) {
  if (mode === 'lump') return [new Date(startD)];
  const out = [];
  const cur = new Date(startD); cur.setHours(0, 0, 0, 0);
  const end = new Date(endD);   end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    out.push(new Date(cur));
    if (mode === 'daily')        cur.setDate(cur.getDate() + 1);
    else if (mode === 'weekly')  cur.setDate(cur.getDate() + 7);
    else if (mode === 'monthly') cur.setMonth(cur.getMonth() + 1);
    else break;
  }
  return out;
}

// CSV 가격을 [time, value] 정렬 배열로 변환
function buildPriceLookups(race) {
  return race.series.map(s => {
    const pairs = [];
    for (let i = 0; i < race.dates.length; i++) {
      const d = parseDate(race.dates[i]);
      const v = s.values[i];
      if (d && Number.isFinite(v)) pairs.push({ t: d.getTime(), v });
    }
    pairs.sort((a, b) => a.t - b.t);
    return pairs;
  });
}

// forward-fill: queryTime 이전(또는 같은) 가장 최근 가격
function priceAt(pairs, queryTime) {
  if (!pairs.length) return null;
  let lo = 0, hi = pairs.length - 1, result = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pairs[mid].t <= queryTime) {
      result = pairs[mid].v;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/* ----- 시뮬레이션 본체 -----
   1) 시작/종료일을 결정 (사용자 입력 > CSV 첫/마지막)
   2) 디스플레이 타임라인 생성 (X축에 그려질 날짜 시퀀스)
   3) 매수 이벤트 시점 생성 (mode 에 따라 달력 기반)
   4) CSV 가격을 [time, value] 로 정렬, forward-fill 로 임의 날짜의 가격 조회
   5) 타임라인을 따라 진행하며 그 사이 발생한 매수 이벤트를 모두 처리
*/
/*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📈 DCA 시뮬레이션 — CSV 행 단위로 명시적 계산
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   설계 원칙:
     • CSV 의 한 행 = 한 시점.  X 축 = CSV 의 dates 그대로.
     • 매 행마다 mode 규칙으로 "이번 행에 매수할지" 결정.
     • 매수 시:  shares    += amount / price[i]
                principal += amount
                ※ 위 두 줄이 곧 사용자가 요구한 DCA 공식과 수학적 동치:
                  prevValue = shares * prevPrice  →  shares = prevValue / prevPrice
                  currentValue = shares*currentPrice + amount
                              = (prevValue * currentPrice/prevPrice) + amount
     • 평가금  portfolio[i] = shares * price[i]
     • 원금    principal[i] = 지금까지 누적 투자금
     • 수익률  (portfolio - principal) / principal * 100   ← 별도 계산 (renderResults)

   mode 별 "이 행에 매수?" 규칙:
     lump    : 최초 1회만 (in-range 첫 유효 행)
     daily   : 모든 행
     weekly  : 직전 매수와 ≥ 7일 차이 (날짜 비교)
     monthly : 직전 매수와 다른 (년,월) — 같은 달 내 여러 행이면 첫 행만

   ⚠️ 행이 곧 시점 — 월별 CSV 면 한 행이 한 달 = monthly DCA 가 행마다 1회.
       일별 CSV 면 한 행이 하루 = daily DCA 가 행마다 1회.
       데이터 granularity 와 mode 가 맞아야 직관적인 결과가 나옵니다.
*/
/*
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   📈 DCA 시뮬레이션 — 캘린더 기반 타임라인
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   X축은 항상 [INVESTMENT.startDate, INVESTMENT.endDate] 전체 범위.
   재생 중에는 값(values)만 slice 되어 늘어나고, X축 자체는 변하지 않는다.

   설계:
     1) 시작~종료 사이에 캘린더 timeline (월/주/일 해상도 자동 선택) 생성
     2) 매수 이벤트(mode 별)도 캘린더 기반으로 생성
     3) CSV 가격은 (날짜, 가격) 쌍으로 정렬 후 binary-search forward-fill
        → timeline 의 어떤 시점에서도 "그 이전 최근 CSV 가격" 조회 가능
     4) timeline 을 따라 가면서 매수 이벤트 처리 → 누적 shares/principal
     5) 각 timeline 점에서 평가금 = shares × forward-filled 가격
*/
function simulate(race, inv) {
  // 범위 결정 — INVESTMENT.startDate/endDate 우선, 없으면 CSV 첫/마지막
  const fallbackStart = race.dates.length ? parseDate(race.dates[0]) : null;
  const fallbackEnd   = race.dates.length ? parseDate(race.dates[race.dates.length - 1]) : null;
  const startD = parseDate(inv.startDate) || fallbackStart;
  const endD   = parseDate(inv.endDate)   || fallbackEnd;
  if (!startD || !endD || startD > endD) return null;

  const amount = Math.max(0, Number(inv.amount) || 0);
  const mode   = inv.mode || 'monthly';

  // 1) 캘린더 디스플레이 타임라인 (X축)
  const resolution   = pickResolution(startD, endD);
  const timelineDts  = genTimeline(startD, endD, resolution);
  if (!timelineDts.length) return null;

  // 2) 매수 이벤트 (mode 기준, 캘린더 기반)
  const investEvents = genInvestEvents(startD, endD, mode);

  // 3) CSV 가격 lookup (binary search 가능한 정렬 배열)
  const lookups = buildPriceLookups(race);

  const seriesOut = race.series.map((_, idx) => {
    const lookup = lookups[idx];
    const portfolioValues = [];
    const principalSeries = [];
    let shares    = 0;
    let principal = 0;
    let evtIdx    = 0;
    let buyCount  = 0;

    // 4) timeline 점을 따라 진행하며 그 사이의 매수 이벤트를 모두 소화
    for (const td of timelineDts) {
      const tdTime = td.getTime();

      while (evtIdx < investEvents.length && investEvents[evtIdx].getTime() <= tdTime) {
        const evtTime  = investEvents[evtIdx].getTime();
        const evtPrice = priceAt(lookup, evtTime);
        if (evtPrice && evtPrice > 0 && amount > 0) {
          shares    += amount / evtPrice;
          principal += amount;
          buyCount++;
        }
        evtIdx++;
      }

      // 5) 이 timeline 시점의 평가금 (가격 없으면 0)
      const tdPrice = priceAt(lookup, tdTime);
      portfolioValues.push(tdPrice ? shares * tdPrice : 0);
      principalSeries.push(principal);
    }

    return {
      portfolioValues,
      principalSeries,
      finalShares:    shares,
      finalPrincipal: principal,
      finalValue:     portfolioValues[portfolioValues.length - 1] || 0,
      buyCount
    };
  });

  // 디버깅: 콘솔에 핵심 수치 한 줄 출력
  if (seriesOut[0]) {
    console.log(
      `[DCA] mode=${mode}, range=${inv.startDate || '(auto)'}~${inv.endDate || '(auto)'}, ` +
      `amount=${amount} → 타임라인 ${timelineDts.length}점, ` +
      `매수 ${seriesOut[0].buyCount}회, ` +
      `원금=${seriesOut[0].finalPrincipal}, ` +
      `평가금=${Math.round(seriesOut[0].finalValue)}`
    );
  }

  return {
    // 🎯 X축 라벨로 쓰일 날짜 — 시작일~종료일 전체 범위의 캘린더 타임라인
    dates: timelineDts.map(d => fmtDateStr(d, resolution)),
    series: seriesOut,
    resolution,
    startD, endD
  };
}

/* =========================================================
   7. CSV 파싱 / 직렬화
   ========================================================= */
/* ═══════════════════════════════════════════════════════════════
   📦 manifest + 종목별 CSV 로딩 (새 데이터 구조)
   ═══════════════════════════════════════════════════════════════ */
async function loadManifest() {
  try {
    const r = await fetch('./db/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('no manifest');
    MANIFEST = await r.json();
    if (!MANIFEST.tickers) MANIFEST.tickers = {};
  } catch (e) {
    MANIFEST = { updated_at: null, tickers: {} };
    console.warn('[manifest] 로드 실패 — db/manifest.json 이 없거나 정적 서버가 안 떠 있습니다.');
  }
}

// "date,price" 단일 컬럼 CSV 파서
function parseTickerCSV(text) {
  const lines = (text || '').trim().split(/\r?\n/);
  const dates = [];
  const prices = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    if (i === 0 && /^date\s*,/i.test(line)) continue; // 헤더 스킵
    const cells = line.split(',');
    if (cells.length < 2) continue;
    const d = cells[0].trim();
    const p = parseFloat(cells[1]);
    if (d && Number.isFinite(p)) {
      dates.push(d);
      prices.push(p);
    }
  }
  return { dates, prices };
}

/* 각 RACE.series.symbol 에 해당하는 db/<symbol>.csv 를 받아 _dates/_prices 채움.
   manifest 에 없는 심볼은 _missing = true 로 표시 (사전 검증에서 잡힘). */
async function loadSeriesData() {
  await Promise.all(RACE.series.map(async (s) => {
    if (!s.symbol) { s._missing = true; return; }
    const entry = MANIFEST.tickers[s.symbol];
    if (!entry) {
      s._missing = true;
      s._dates = []; s._prices = [];
      return;
    }
    try {
      const r = await fetch(`./db/${s.symbol}.csv`, { cache: 'no-cache' });
      if (!r.ok) throw 0;
      const text = await r.text();
      const { dates, prices } = parseTickerCSV(text);
      s._dates = dates.slice();
      // manifest 의 value_mode='cumulative_sum' 이면 월별 증분 → 누적합으로 변환
      // (스포츠 골 카테고리 — 프론트가 "현재 누적 골 수"를 직접 그래프에 표시)
      if (entry.value_mode === 'cumulative_sum') {
        let sum = 0;
        s._prices = prices.map(v => (sum += v));

        /* Forward-fill: 마지막 데이터 이후 (last+1 ~ 현재월) 미수집 월에 대해
           직전 누적값을 유지하여 시각적으로 선이 끊기지 않게 함.
           (점선 처리 X — 그냥 평평하게 이어짐) */
        if (s._dates.length && s._prices.length) {
          const lastDate = s._dates[s._dates.length - 1];
          const lastVal  = s._prices[s._prices.length - 1];
          const now      = new Date();
          const todayYM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          if (lastDate < todayYM) {
            let [y, m] = lastDate.split('-').map(Number);
            while (true) {
              m++; if (m > 12) { m = 1; y++; }
              const ym = `${y}-${String(m).padStart(2, '0')}`;
              if (ym > todayYM) break;
              s._dates.push(ym);
              s._prices.push(lastVal);
            }
          }
        }
      } else {
        s._prices = prices;
      }
      s._missing = (dates.length === 0);
    } catch (e) {
      s._missing = true;
      s._dates = []; s._prices = [];
    }
  }));
  alignSeriesToCommonDates();
}

/* 여러 종목의 날짜를 공통 타임라인으로 정렬 — 모든 종목에 공통으로 존재하는
   날짜만 사용 (intersection). 그 결과로 RACE.dates / s.values 를 채움. */
function alignSeriesToCommonDates() {
  const valid = RACE.series.filter(s => !s._missing && s._dates && s._dates.length);
  if (!valid.length) {
    RACE.dates = [];
    RACE.series.forEach(s => { s.values = []; });
    return;
  }
  let common = new Set(valid[0]._dates);
  for (let i = 1; i < valid.length; i++) {
    const set = new Set(valid[i]._dates);
    common = new Set([...common].filter(d => set.has(d)));
  }
  RACE.dates = [...common].sort();
  for (const s of RACE.series) {
    if (s._missing) { s.values = new Array(RACE.dates.length).fill(0); continue; }
    const map = new Map(s._dates.map((d, i) => [d, s._prices[i]]));
    s.values = RACE.dates.map(d => map.get(d) ?? 0);
  }
}

/* 사전 검증 — 현재 선택된 series 중 manifest 에 없는(_missing) 항목 목록 반환.
   재생 전에 호출해서 누락 종목이 있으면 alert 후 재생 차단. */
function getMissingSeries() {
  return RACE.series.filter(s => s._missing).map(s => `${s.name} (${s.symbol})`);
}

function parseCSV(text) {
  if (!text || !text.trim()) return null;
  let lines = text.trim().split(/\r?\n/).filter(l => l.trim().length > 0);

  // 맨 앞의 '# key: value' 메타데이터 라인들 추출 (subtitle 등)
  const meta = {};
  while (lines.length && lines[0].startsWith('#')) {
    const m = lines[0].match(/^#\s*([\w-]+)\s*:\s*(.+)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
    lines = lines.slice(1);
  }

  if (lines.length < 2) return null;

  const header = lines[0].split(',').map(s => s.trim());
  if (header.length < 2) return null;

  const seriesNames = header.slice(1);
  const dates = [];
  const valuesPerCol = seriesNames.map(() => []);

  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(s => s.trim());
    if (!cells[0]) continue;
    dates.push(cells[0]);
    for (let j = 0; j < seriesNames.length; j++) {
      const n = Number(cells[j + 1]);
      valuesPerCol[j].push(Number.isFinite(n) ? n : 0);
    }
  }

  if (dates.length === 0) return null;

  return {
    dates,
    series: seriesNames.map((name, i) => ({
      name,
      values: valuesPerCol[i]
    })),
    meta
  };
}

function serializeCSV(race) {
  const header = ['date', ...race.series.map(s => s.name)].join(',');
  const rows = race.dates.map((d, i) =>
    [d, ...race.series.map(s => s.values[i] ?? '')].join(',')
  );
  return [header, ...rows].join('\n');
}

/* =========================================================
   8. 동적 카메라 (y축 부드러운 추적)
   ========================================================= */
function computeCameraTargets(currentValues, currentPrincipal) {
  let vMax = -Infinity, vMin = Infinity;

  displaySeries.forEach((s, i) => {
    const upTo = Math.min(Math.floor(progress) + 1, s.values.length);
    for (let j = 0; j < upTo; j++) {
      if (s.values[j] > vMax) vMax = s.values[j];
      if (s.values[j] < vMin) vMin = s.values[j];
    }
    const v = currentValues[i];
    if (Number.isFinite(v)) {
      if (v > vMax) vMax = v;
      if (v < vMin) vMin = v;
    }
  });

  /* sports 모드 — Y축 단순화: 0 시작, max*1.1 끝, 최소 100골.
     투자금/원금 계산 / minRange 패딩 다 무시. */
  if (_allSeriesCumulative()) {
    const effectiveMax = Number.isFinite(vMax) ? Math.max(0, vMax) : 0;
    return { min: 0, max: Math.max(100, effectiveMax * 1.1) };
  }

  // 원금(투자금액) 시계열도 카메라 범위에 포함
  if (displayPrincipal) {
    const upTo = Math.min(Math.floor(progress) + 1, displayPrincipal.length);
    for (let j = 0; j < upTo; j++) {
      const v = displayPrincipal[j];
      if (Number.isFinite(v)) {
        if (v > vMax) vMax = v;
        if (v < vMin) vMin = v;
      }
    }
    if (Number.isFinite(currentPrincipal)) {
      if (currentPrincipal > vMax) vMax = currentPrincipal;
      if (currentPrincipal < vMin) vMin = currentPrincipal;
    }
  }

  if (!Number.isFinite(vMax) || !Number.isFinite(vMin)) {
    vMax = FULL_MAX; vMin = FULL_MIN;
  }

  let range = vMax - vMin;
  if (range < MIN_RANGE) {
    const center = (vMax + vMin) / 2;
    vMax = center + MIN_RANGE / 2;
    vMin = center - MIN_RANGE / 2;
    range = MIN_RANGE;
  }

  /* DCA 평가금은 음수가 될 수 없음 → 카메라 최소값을 0 으로 클램프.
     (이전 코드는 MIN_RANGE 클램프 후 vMin 이 음수로 떨어져 Y축에 -1,687만
      같은 무의미한 값이 잠깐 나타나는 버그가 있었음.) */
  const startsLow = vMin >= 0 && vMin < range * 0.6;
  const candMin   = startsLow ? 0 : vMin - range * 0.08;
  return {
    min: Math.max(0, candMin),
    max: vMax + range * 0.18
  };
}

/* =========================================================
   9. 역전 감지 + 배너 큐
      - VIEW.showOvertake 가 false 면 모두 무시 (기본값 OFF)
      - 1.2초 노출 → 0.3초 fade out → 다음 이벤트
      - 같은 메시지 연속이면 무시
   ========================================================= */
let bannerQueue   = [];
let bannerVisible = false;
let bannerHideTm  = null;
let bannerNextTm  = null;

function enqueueBanner(text) {
  if (!VIEW.showOvertake) return;
  if (bannerQueue[bannerQueue.length - 1] === text) return; // 중복 억제
  bannerQueue.push(text);
  pumpBanner();
}

function pumpBanner() {
  if (bannerVisible) return;
  const text = bannerQueue.shift();
  if (!text) return;
  bannerVisible = true;
  bannerEl.textContent = text;
  bannerEl.classList.remove('show');
  void bannerEl.offsetWidth;
  bannerEl.classList.add('show');
  clearTimeout(bannerHideTm);
  bannerHideTm = setTimeout(() => {
    bannerEl.classList.remove('show');
    clearTimeout(bannerNextTm);
    bannerNextTm = setTimeout(() => {
      bannerVisible = false;
      pumpBanner();
    }, 280);
  }, 1200);
}

function clearBanner() {
  bannerQueue   = [];
  bannerVisible = false;
  clearTimeout(bannerHideTm);
  clearTimeout(bannerNextTm);
  bannerEl.classList.remove('show');
}

/* 추월 감지 — 두 시리즈의 대소관계가 뒤집힌 프레임에서 호출.
   기존 배너 팝업은 VIEW.showOvertake 가 off 면 자동 침묵.
   추가: 추월한 시리즈 idx 를 _overtakePulse 에 timestamp 로 기록 →
   renderEndpointIcons 가 이 데이터를 보고 0.5s 동안 .overtake-pulse 클래스 부여. */
const _overtakePulse = new Map();   // idx → timestamp(ms)
const OVERTAKE_PULSE_MS = 500;

function detectOvertakes(items) {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const diff = items[i].value - items[j].value;
      const sign = diff > 0.3 ? 1 : diff < -0.3 ? -1 : 0;
      const key  = `${i}_${j}`;
      const prev = prevDiffs[key];

      if (prev !== undefined && prev !== 0 && sign !== 0 && sign !== prev) {
        // 추월한 쪽 = 새로운 우위 (sign > 0 ? items[i] : items[j])
        const winnerIdx = sign > 0 ? i : j;
        _overtakePulse.set(winnerIdx, performance.now());
        // 배너는 VIEW.showOvertake 에 따라 (기본 off — 조용한 추월)
        const winner = items[winnerIdx];
        const loser  = sign > 0 ? items[j] : items[i];
        enqueueBanner(
          `🔥 ${winner.name}${subjectParticle(winner.name)} ${loser.name} 추월!`
        );
      }
      if (sign !== 0) prevDiffs[key] = sign;
    }
  }
}

/* =========================================================
   10. 렌더
   ========================================================= */
/* 모든 선택된 시리즈가 cumulative_sum (스포츠 모드) 인지 검사.
   true 면 DCA 무관, 단위 '골', 제목/축/끝점 라벨 모두 스포츠용 포맷 사용. */
function _allSeriesCumulative() {
  if (!RACE.series.length) return false;
  return RACE.series.every(s => {
    const e = MANIFEST.tickers && MANIFEST.tickers[s.symbol];
    return e && e.value_mode === 'cumulative_sum';
  });
}

/* cumulative_sum (sports) 모드에서 "실제 데이터" 가 있는지 검사.
   판단: 어느 한 시리즈라도 누적값이 0 보다 큰 게 있으면 hasData=true.
   모든 시리즈가 비어있거나 전부 0 이면 hasData=false → 0골 노출/WIN/축/그래프 전부 차단. */
function _hasSportsData() {
  if (!_allSeriesCumulative()) return true;   // sports 가 아니면 의미 없음 — 항상 true
  if (!RACE.series.length) return false;
  return RACE.series.some(s => s._prices && s._prices.some(v => v > 0));
}

/* 스포츠 모드용 숫자 포맷 — Y축/끝점 라벨 공통. 한국어 "1,234골" / 영어 "1,234 goals" */
function _formatGoals(v) {
  const n = Math.round(v);
  const fn = (I18N[_currentLang()] || I18N.ko).goals;
  return fn ? fn(n) : `${n.toLocaleString()}골`;
}

/* ── 모드 추론 ──
   현재 선택된 시리즈의 manifest 메타로 자동 판단.
   향후 확장: ranking / custom 등은 별도 value_mode 키로 분기 가능. */
function getCurrentMode() {
  if (_allSeriesCumulative()) return 'sports';
  // 미래 확장 자리: ranking, custom 등
  return 'investment';     // 기본 — DCA 시뮬레이션
}

/* 모드별 CTA 문구. 향후 ranking 등 추가 시 여기만 늘리면 됨. */
const MODE_CTA_LABELS = {
  investment: '▶ 투자 결과 보기',
  sports:     '▶ 골 레이스 시작',
  ranking:    '▶ 레이스 시작'
};

/* ── 데이터 상태 정규화 (단일 진실) ──
   manifest 의 status 값을 UI 표시용 {kind, label} 로 변환.
   호환: 기존 'ok' → 'active', 기존 'no_data' → 'preparing'.
   향후 확장: 'planned' (아직 작업 시작 전 종목) */
function getEntryStatus(entry) {
  if (!entry) return { kind: 'planned', label: '예정' };
  const raw = (entry.status || '').toLowerCase();
  if (raw === 'ok' || raw === 'active')         return { kind: 'active',    label: '정상' };
  if (raw === 'preparing' || raw === 'no_data') return { kind: 'preparing', label: '준비중' };
  if (raw === 'planned')                        return { kind: 'planned',   label: '예정' };
  return { kind: 'preparing', label: '준비중' };
}

/* 상태 정렬 우선순위 — active 우선, 그 다음 preparing, 그 다음 planned */
const STATUS_RANK = { active: 0, preparing: 1, planned: 2 };
function _statusRank(entry) {
  return STATUS_RANK[getEntryStatus(entry).kind] ?? 9;
}

/* ── UI 동기화 ──
   - body[data-mode]   : CSS 가 .investment-only 등을 조건부로 hide
   - frame.empty-sports : sports 모드 + 모든 시리즈 데이터 없음 → 중앙 ⚽ 안내
   - CTA 버튼 텍스트   : 모드별 라벨
   - [data-mode-text]  : 헤더 텍스트 모드별 교체
   기존 DOM 은 절대 제거하지 않음 — 모드 복귀 시 즉시 원복. */
function applyModeToUI() {
  const mode = getCurrentMode();
  document.body.dataset.mode = mode;

  // CTA 버튼 문구 — 사이드바 인라인 CTA + 모바일 sticky CTA 미러링
  const dict = I18N[_currentLang()] || I18N.ko;
  const key  = 'cta' + mode.charAt(0).toUpperCase() + mode.slice(1);   // ctaInvestment / ctaSports / ctaRanking
  const ctaLabel = dict[key] || MODE_CTA_LABELS[mode] || '▶ 시작';

  const cta = document.getElementById('btn-restart-play');
  if (cta) cta.textContent = ctaLabel;

  const mobileCta = document.getElementById('btn-mobile-cta');
  if (mobileCta) mobileCta.textContent = ctaLabel;

  // 모드별 텍스트 노드 (data-mode-text="investment값|sports값|...")
  document.querySelectorAll('[data-mode-text]').forEach(el => {
    const map = {};
    el.dataset.modeText.split('|').forEach(pair => {
      const [k, v] = pair.split('=');
      if (k && v != null) map[k.trim()] = v.trim();
    });
    if (map[mode]) el.textContent = map[mode];
  });

  // sports + 데이터 없음 → 빈 그래프 안내 표시 (단일 helper 사용)
  if (frameEl) {
    const sportsEmpty = (mode === 'sports') && !_hasSportsData();
    frameEl.classList.toggle('empty-sports', sportsEmpty);

    // 시리즈명 동적 표시 (호날두 vs 메시 / Ronaldo vs Messi)
    const pairEl = document.getElementById('emptyOverlayPair');
    if (pairEl && sportsEmpty) {
      const names = RACE.series.map(s => _seriesDisplayName(s)).filter(Boolean);
      pairEl.textContent = names.length >= 2 ? names.join(' vs ') : '';
    }
  }
}

/* ── 데이터 준비중 안내 모달 (alert 대체) ── */
function showDataPrepModal() {
  const dlg = document.getElementById('dataPrepModal');
  if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
  else alert('⚽ 데이터 준비중 — 실제 경기 기록 정리 후 자동 활성화됩니다.');  // dialog 미지원 fallback
}

/*
  화면 제목 — 후크 카피. 3줄 리듬으로 그루핑 (Shorts hook 톤):
    1) 사용자가 입력란에 직접 적은 RACE.title 이 있으면 그 값
    2) sports 모드면 "이름 vs 이름 / 누적 골 / 레이스" 자동
    3) 그 외 INVESTMENT 설정에서 자동 생성
         monthly : "매월 100만원씩 / 10년 / 모았다면?"
         lump    : "10년 전 / 1억을 / 넣었다면?"
*/
function getDisplayTitle() {
  if (RACE.title && RACE.title.trim()) return RACE.title.trim();
  const lang = _currentLang();
  const dict = I18N[lang] || I18N.ko;

  if (_allSeriesCumulative()) {
    const names = RACE.series.map(s => _seriesDisplayName(s)).filter(Boolean);
    if (names.length >= 2) return dict.titleSports(names[0], names[1]);
    return lang === 'en' ? 'Goal Race' : '골 레이스';
  }

  if (INVESTMENT.enabled && INVESTMENT.amount > 0) {
    const startD = parseDate(INVESTMENT.startDate) || parseDate(displayDates[0]);
    const endD   = parseDate(INVESTMENT.endDate)   || parseDate(displayDates[displayDates.length - 1]);
    const amt    = _amountFmtFull(INVESTMENT.amount);
    const period = _fmtPeriodLang(startD, endD);

    if (INVESTMENT.mode === 'lump') {
      return dict.titleLumpInvest(amt, period);
    }
    // 적립식 — 짧은 기간이면 압축(2줄), 길면 3줄 그루핑
    const shortPeriod = period.length <= 4;
    return shortPeriod
      ? dict.titleMonthlyShort(amt, period)
      : dict.titleMonthlyInvest(amt, period);
  }
  return dict.titleFallback;
}

function renderTitle() {
  titleEl.textContent = getDisplayTitle();
  _fitTitle();
}

/* 제목 auto-fit (shrink-to-fit) — 영문 모드에서 긴 문장이 잘리지 않도록 폰트 자동 축소.
   원칙:
     - 컨테이너 가로폭을 넘기지 않을 것 (scrollWidth ≤ clientWidth)
     - 3줄(또는 줄바꿈 \n 개수+1) 안에서 내용이 모두 보일 것 (overflow 없이)
   동작:
     1) 인라인 font-size 제거 → CSS clamp() 가 우선 결정
     2) -webkit-line-clamp 를 잠시 해제하고 실제 콘텐츠 높이 측정
     3) overflow 가 발생하면 1px씩 축소, 최소 14px 까지
     4) clamp 복원
   ko/en 공통으로 작동 — 입력값이 짧으면 측정값이 이미 작아서 축소 발생 안 함. */
let _fitTitleCache = { txt: null, w: 0, lang: null, fz: '' };
function _fitTitle() {
  if (!titleEl) return;
  const txt   = titleEl.textContent || '';
  const w     = titleEl.clientWidth;
  const lang  = _currentLang();
  // 같은 텍스트 + 같은 폭 + 같은 lang 이면 재계산 스킵 (매 프레임 호출 비용 절감)
  if (_fitTitleCache.txt === txt &&
      _fitTitleCache.w   === w   &&
      _fitTitleCache.lang === lang) {
    if (_fitTitleCache.fz) titleEl.style.fontSize = _fitTitleCache.fz;
    return;
  }
  // 현재 텍스트의 줄바꿈 수 + 1 (최소 1줄, 최대 3줄)
  const targetLines = Math.min(3, Math.max(1, (txt.match(/\n/g) || []).length + 1));

  // 1) 인라인 font-size 제거 — CSS clamp() 우선
  titleEl.style.fontSize = '';

  // 2) line-clamp 임시 해제로 실제 콘텐츠 높이 측정.
  //    -webkit-line-clamp 는 setProperty/getPropertyValue 로 다뤄야 TS 의 deprecated 경고 회피.
  const prevClamp = titleEl.style.getPropertyValue('-webkit-line-clamp');
  titleEl.style.setProperty('-webkit-line-clamp', 'unset');

  const cs = getComputedStyle(titleEl);
  let fz = parseFloat(cs.fontSize) || 32;
  // line-height: number(0.92) 일 수 있음 → 직접 계산
  const lhRaw = cs.lineHeight;
  let lhRatio = parseFloat(lhRaw) / fz;
  if (!isFinite(lhRatio) || lhRatio <= 0) lhRatio = 1.0;
  // line-height 가 'normal' 또는 단위 없는 숫자면 그대로 ratio
  if (/^[\d.]+$/.test(lhRaw)) lhRatio = parseFloat(lhRaw);

  const minFz = 14;
  for (let i = 0; i < 60; i++) {
    const targetH = fz * lhRatio * targetLines + 2;   // 2px 여유
    const overflowH = titleEl.scrollHeight > targetH;
    const overflowW = titleEl.scrollWidth  > titleEl.clientWidth + 1;
    if (!overflowH && !overflowW) break;
    if (fz <= minFz) break;
    fz -= 1;
    titleEl.style.fontSize = `${fz}px`;
  }

  // 3) line-clamp 복원
  if (prevClamp) titleEl.style.setProperty('-webkit-line-clamp', prevClamp);
  else           titleEl.style.removeProperty('-webkit-line-clamp');

  // 캐시 — 다음 프레임에서 동일 입력이면 측정 스킵
  _fitTitleCache = { txt, w, lang, fz: titleEl.style.fontSize || '' };
}
function renderDate()     { dateEl.textContent  = fmtDateKr(dateAt(progress)); }
function renderProgress() {
  const pct = X_MAX === 0 ? 0 : (progress / X_MAX) * 100;
  progressBar.style.width = `${pct}%`;
}

/* =========================================================
   끝점 아이콘 시스템
   - HTML 오버레이가 chart.convertToPixel 좌표에 절대 위치
   - 도착 시 bounce / 마지막 2초 동안 🥇 WINNER 배지 / icon.type 별 렌더
   ========================================================= */

/* 업로드 이미지 → 정사각 원형 crop dataURL (Canvas)
   - 가운데 정사각형으로 잘라 size × size 로 정규화
   - alpha 마스크는 CSS border-radius 로 처리되므로 캔버스는 사각형 PNG 로도 OK */
/* 업로드 이미지 정책
   - 허용 형식: image/png · image/jpeg · image/webp  (gif/svg/heic 등 거부)
   - 최대 원본 크기: 3 MB
   - 최대 원본 해상도: 1500 × 1500 — 초과 시 캔버스 다운스케일
   - 출력: 정사각 원형 crop. 출력 픽셀 = size × min(devicePixelRatio, 2)
           (레티나 대응 + 메모리 안전 캡) */
const IMG_ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const IMG_MAX_BYTES      = 3 * 1024 * 1024;
const IMG_MAX_DIM        = 1500;

function _loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

function cropImageToCircle(file, size = 160) {
  return new Promise(async (resolve, reject) => {
    // 1) 형식 화이트리스트
    if (!IMG_ALLOWED_MIMES.has(file.type)) {
      return reject(new Error('PNG / JPG / WebP 만 지원합니다 (gif·svg 미지원)'));
    }
    // 2) 사이즈 한도 — 초과면 거부 (사용자에게 더 작은 파일 권유)
    if (file.size > IMG_MAX_BYTES) {
      return reject(new Error(
        `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB).\n` +
        `최대 ${IMG_MAX_BYTES / 1024 / 1024}MB 까지 가능합니다.`
      ));
    }

    try {
      const img = await _loadImageFromFile(file);

      // 3) 원본 해상도 한도 — 초과면 1500 이하로 자동 다운스케일 (canvas)
      let srcCanvas = img;
      const longest = Math.max(img.width, img.height);
      if (longest > IMG_MAX_DIM) {
        const scale = IMG_MAX_DIM / longest;
        const w = Math.round(img.width  * scale);
        const h = Math.round(img.height * scale);
        const tmp = document.createElement('canvas');
        tmp.width = w;
        tmp.height = h;
        const tctx = tmp.getContext('2d');
        tctx.imageSmoothingEnabled = true;
        tctx.imageSmoothingQuality = 'high';
        tctx.drawImage(img, 0, 0, w, h);
        srcCanvas = tmp;
      }

      // 4) 정사각 center-crop + size × dpr 로 정규화 (선명도)
      const dpr   = Math.min(window.devicePixelRatio || 1, 2);
      const outPx = Math.round(size * dpr);
      const canvas = document.createElement('canvas');
      canvas.width  = outPx;
      canvas.height = outPx;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const sw = srcCanvas.width;
      const sh = srcCanvas.height;
      const s  = Math.min(sw, sh);
      const sx = (sw - s) / 2;
      const sy = (sh - s) / 2;
      ctx.drawImage(srcCanvas, sx, sy, s, s, 0, 0, outPx, outPx);

      // PNG 무손실 출력 (작은 사이즈라 용량 크게 늘지 않음)
      resolve(canvas.toDataURL('image/png'));
    } catch (e) {
      reject(e);
    }
  });
}

/* 시리즈 idx 별 아이콘 노드 캐시 — 매 프레임 재생성 대신 위치만 갱신 */
const _iconNodes = new Map();    // key: "idx:type:value" → element
let   _prevFinished = false;     // 진입 프레임 한 번만 bounce 트리거
const _bouncePlayed = new Set(); // idx — 이번 종료에서 bounce 한 번만 실행
const ICON_SIZE_HALF = 17;        // icon-inner 가 34px 이므로 절반 = 17px (앵커 보정)

/* ── 자동 아이콘 시스템 ──
   icon.type='auto' 시 시리즈 이름/심볼에서 짧은 텍스트 약어 산출 → 시리즈 색 원형/육각/카드 안에 흰색 굵게 표시.
   사용자가 emoji/image 탭으로 명시 선택하면 그 값이 우선. */
/* ─── 시리즈 메타 (브랜드 컬러) ───
   로고에서 색을 추출하지 못하거나 (CORS / 추출 실패) 로고 파일이 없을 때 사용하는
   수동 명시 컬러. 향후 신규 종목 추가 시 여기 한 줄 추가하면 그래프 선/글로우/영역
   /끝점 아이콘 글로우/금액 텍스트 등 UI 전체가 자동으로 이 색으로 통일된다. */
const SERIES_META = {
  // 지수
  sp500:      { color: '#EC407A' },   // 핑크 — 기존 디폴트 톤 유지
  nasdaq:     { color: '#4FC3F7' },   // 하늘
  kospi:      { color: '#5C6BC0' },   // 인디고

  // 미국 주식 (공식 브랜드 컬러, 다크 배경 가독성 보정)
  tsla:       { color: '#E82127' },   // Tesla red
  nvda:       { color: '#76B900' },   // NVIDIA green
  aapl:       { color: '#A2AAAD' },   // Apple silver
  msft:       { color: '#00A4EF' },   // Microsoft blue
  amzn:       { color: '#FF9900' },   // Amazon orange
  googl:      { color: '#4285F4' },   // Google blue
  meta:       { color: '#0866FF' },   // Meta blue
  avgo:       { color: '#CC0000' },   // Broadcom red
  brk_b:      { color: '#4A90B5' },   // Berkshire (lighter blue for dark bg)
  jpm:        { color: '#1E88E5' },   // JPMorgan blue
  nflx:       { color: '#E50914' },   // Netflix red
  pltr:       { color: '#5A6378' },   // Palantir gray (브랜드 black → 가시성 보정)
  amd:        { color: '#ED1C24' },   // AMD red
  orcl:       { color: '#FF4D4D' },   // Oracle red (가시성 보정)
  cost:       { color: '#E31837' },
  wmt:        { color: '#0071CE' },   // Walmart blue
  ko:         { color: '#F40009' },   // Coca-Cola red
  mcd:        { color: '#FFC72C' },   // McDonald's yellow
  visa:       { color: '#1A4FE0' },   // Visa blue (밝게 보정)
  mastercard: { color: '#FF5F00' },   // Mastercard orange

  // 한국 주식
  samsung:    { color: '#1428A0' },   // Samsung blue
  skhynix:    { color: '#E1251B' },   // SK red
  lges:       { color: '#A50034' },   // LG dark red
  sbiologics: { color: '#1428A0' },   // Samsung group blue
  hyundai:    { color: '#002C5F' },   // Hyundai navy → lighter
  kia:        { color: '#BB162B' },   // Kia red
  celltrion:  { color: '#34A853' },   // Celltrion green
  kbfin:      { color: '#FFB81C' },   // KB yellow
  naver:      { color: '#03C75A' },   // NAVER green
  hanwhaaero: { color: '#FF6F00' },   // Hanwha orange
  kakao:      { color: '#FEE500' },   // Kakao yellow
  doosanener: { color: '#0F4C81' },   // Doosan blue
  hdhi:       { color: '#003B71' },   // HD현대 blue
  posco:      { color: '#0066CC' },   // POSCO blue
  krafton:    { color: '#FF7A00' },   // Krafton orange

  // ETF (대표 톤)
  qqq:        { color: '#5BBA47' },   // Invesco green
  voo:        { color: '#C8102E' },   // Vanguard red
  vti:        { color: '#C8102E' },
  schd:       { color: '#C8102E' },
  soxx:       { color: '#FF6F00' },   // 반도체 orange
  smh:        { color: '#FF6F00' },
  soxl:       { color: '#FF3D00' },   // 레버리지 강한 톤
  tqqq:       { color: '#5BBA47' },
  upro:       { color: '#E84E1B' },
  jepi:       { color: '#2E7D32' },   // 배당 green
  jepq:       { color: '#43A047' },

  // 암호화폐
  btc:        { color: '#F7931A' },   // Bitcoin orange
  bitcoin:    { color: '#F7931A' },
  eth:        { color: '#627EEA' },   // Ethereum blue/purple
  sol:        { color: '#9945FF' },   // Solana purple
  xrp:        { color: '#7E8285' },   // Ripple gray (black → 가시성 보정)
  doge:       { color: '#C2A633' },   // Dogecoin gold
  bnb:        { color: '#F0B90B' },   // Binance yellow
  ada:        { color: '#0066FF' },   // Cardano blue (가시성 보정)
  link:       { color: '#2A5ADA' },   // Chainlink blue
  sui:        { color: '#6FBCF0' },   // Sui light blue
  avax:       { color: '#E84142' },   // Avalanche red

  // 원자재
  gold:       { color: '#FFB300' },   // Gold yellow
  silver:     { color: '#BDBDBD' },   // Silver light gray
  copper:     { color: '#B87333' },   // Copper bronze
  oil:        { color: '#546E7A' },   // Oil (black → 슬레이트 그레이로 가시성)
  gas:        { color: '#26C6DA' },   // Natural gas cyan
};

/* ─── 종목명 i18n 테이블 (SYMBOL_LABELS) ───
   화면에 표시되는 종목명을 lang 별로 매핑. RACE.series[].name (manifest 의 한국어명)
   은 운영자용 raw 데이터로 그대로 두고, 영상/Shorts 출력 시점에만 _seriesDisplayName()
   으로 EN/KO 교체.
   새 종목 추가 시 여기 한 줄만 추가하면 차트/끝점/부제/제목/해시태그 모두 자동 반영. */
const SYMBOL_LABELS = {
  // 지수
  sp500:   { ko: 'S&P500',  en: 'S&P 500' },
  nasdaq:  { ko: '나스닥',  en: 'Nasdaq'  },
  kospi:   { ko: '코스피',  en: 'KOSPI'   },

  // 미국 주식
  tsla:    { ko: '테슬라',           en: 'Tesla' },
  nvda:    { ko: '엔비디아',         en: 'NVIDIA' },
  aapl:    { ko: '애플',             en: 'Apple' },
  msft:    { ko: '마이크로소프트',   en: 'Microsoft' },
  amzn:    { ko: '아마존',           en: 'Amazon' },
  googl:   { ko: '알파벳',           en: 'Alphabet' },
  meta:    { ko: '메타',             en: 'Meta' },
  avgo:    { ko: '브로드컴',         en: 'Broadcom' },
  brk_b:   { ko: '버크셔',           en: 'Berkshire' },
  jpm:     { ko: 'JP모건',           en: 'JPMorgan' },
  nflx:    { ko: '넷플릭스',         en: 'Netflix' },
  pltr:    { ko: '팔란티어',         en: 'Palantir' },
  amd:     { ko: 'AMD',              en: 'AMD' },
  orcl:    { ko: '오라클',           en: 'Oracle' },
  cost:    { ko: '코스트코',         en: 'Costco' },
  wmt:     { ko: '월마트',           en: 'Walmart' },
  ko:      { ko: '코카콜라',         en: 'Coca-Cola' },
  mcd:     { ko: '맥도날드',         en: "McDonald's" },
  visa:    { ko: '비자',             en: 'Visa' },
  mastercard: { ko: '마스터카드',    en: 'Mastercard' },

  // 한국 주식
  samsung:    { ko: '삼성전자',         en: 'Samsung Electronics' },
  skhynix:    { ko: 'SK하이닉스',       en: 'SK Hynix' },
  lges:       { ko: 'LG에너지솔루션',   en: 'LG Energy Solution' },
  sbiologics: { ko: '삼성바이오로직스', en: 'Samsung Biologics' },
  hyundai:    { ko: '현대차',           en: 'Hyundai Motor' },
  kia:        { ko: '기아',             en: 'Kia' },
  celltrion:  { ko: '셀트리온',         en: 'Celltrion' },
  kbfin:      { ko: 'KB금융',           en: 'KB Financial' },
  naver:      { ko: 'NAVER',            en: 'NAVER' },
  hanwhaaero: { ko: '한화에어로스페이스', en: 'Hanwha Aerospace' },
  kakao:      { ko: '카카오',           en: 'Kakao' },
  doosanener: { ko: '두산에너빌리티',   en: 'Doosan Enerbility' },
  hdhi:       { ko: 'HD현대중공업',     en: 'HD Hyundai Heavy' },
  posco:      { ko: 'POSCO홀딩스',      en: 'POSCO Holdings' },
  krafton:    { ko: '크래프톤',         en: 'Krafton' },

  // ETF (티커는 그대로 — 영문도 동일)
  qqq:  { ko: 'QQQ',  en: 'QQQ'  },
  voo:  { ko: 'VOO',  en: 'VOO'  },
  vti:  { ko: 'VTI',  en: 'VTI'  },
  schd: { ko: 'SCHD', en: 'SCHD' },
  soxx: { ko: 'SOXX', en: 'SOXX' },
  smh:  { ko: 'SMH',  en: 'SMH'  },
  soxl: { ko: 'SOXL', en: 'SOXL' },
  tqqq: { ko: 'TQQQ', en: 'TQQQ' },
  upro: { ko: 'UPRO', en: 'UPRO' },
  jepi: { ko: 'JEPI', en: 'JEPI' },
  jepq: { ko: 'JEPQ', en: 'JEPQ' },

  // 암호화폐
  btc:     { ko: '비트코인',  en: 'Bitcoin' },
  bitcoin: { ko: '비트코인',  en: 'Bitcoin' },
  eth:     { ko: '이더리움',  en: 'Ethereum' },
  sol:     { ko: '솔라나',    en: 'Solana' },
  xrp:     { ko: '리플',      en: 'XRP' },
  doge:    { ko: '도지코인',  en: 'Dogecoin' },
  bnb:     { ko: 'BNB',       en: 'BNB' },
  ada:     { ko: '에이다',    en: 'Cardano' },
  link:    { ko: '체인링크',  en: 'Chainlink' },
  sui:     { ko: '수이',      en: 'Sui' },
  avax:    { ko: '아발란체',  en: 'Avalanche' },

  // 원자재
  gold:    { ko: '금',        en: 'Gold' },
  silver:  { ko: '은',        en: 'Silver' },
  copper:  { ko: '구리',      en: 'Copper' },
  oil:     { ko: '원유',      en: 'Oil' },
  gas:     { ko: '천연가스',  en: 'Natural Gas' },

  // 스포츠 / 카드
  pokemon_charizard: { ko: '포켓몬카드', en: 'Pokémon Card' },
  ronaldo: { ko: '호날두', en: 'Ronaldo' },
  messi:   { ko: '메시',   en: 'Messi' },
};

/* lang 에 맞는 종목 표시명 반환. SYMBOL_LABELS 미등록 종목은 s.name (한국어) 폴백. */
function _seriesDisplayName(s) {
  if (!s) return '';
  const lang = _currentLang();
  const entry = s.symbol && SYMBOL_LABELS[s.symbol];
  if (entry && entry[lang]) return entry[lang];
  return s.name || '';
}

/* 로고 색 추출 캐시 — 같은 logoURL 반복 호출 방지 */
const _logoColorCache = new Map();

/* manifest 의 logo 필드 조회 — 'assets/logos/nvda.png' 등 상대 경로.
   없으면 null. */
function _resolveLogo(symbol) {
  if (!symbol) return null;
  const e = MANIFEST.tickers && MANIFEST.tickers[symbol];
  return e && e.logo ? e.logo : null;
}

/* 시리즈 컬러 결정 우선순위:
   1) MANIFEST 의 _extractedColor (로고에서 추출 성공)
   2) SERIES_META[symbol].color (수동 명시 — 권장)
   3) fallback (기존 series.color / DEFAULT_COLORS) */
function _resolveSeriesColor(symbol, fallback) {
  if (!symbol) return fallback;
  const e = MANIFEST.tickers && MANIFEST.tickers[symbol];
  if (e && e._extractedColor) return e._extractedColor;
  if (SERIES_META[symbol] && SERIES_META[symbol].color) return SERIES_META[symbol].color;
  return fallback;
}

/* Canvas 로 로고 이미지에서 dominant color 추출.
   - 64x64 다운샘플 → 4-bit 버킷팅 → 가장 많이 등장한 버킷의 평균
   - 흰/검/회색 (저채도) 픽셀 제외 (배경 무시)
   - 실패 / CORS → null */
async function _extractDominantColor(imageURL) {
  if (_logoColorCache.has(imageURL)) return _logoColorCache.get(imageURL);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => { _logoColorCache.set(imageURL, null); resolve(null); };
    img.onload  = () => {
      try {
        const size = 64;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const buckets = {};
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
          if (a < 128) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          if (max - min < 30) continue;    // 회색 제외
          if (max < 30 || min > 230) continue;  // 너무 어둡거나 밝으면 제외
          const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
          const buck = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
          buck.n++; buck.r += r; buck.g += g; buck.b += b;
        }
        let best = null;
        for (const k in buckets) {
          if (!best || buckets[k].n > best.n) best = buckets[k];
        }
        if (!best) { _logoColorCache.set(imageURL, null); resolve(null); return; }
        const rr = Math.round(best.r / best.n);
        const gg = Math.round(best.g / best.n);
        const bb = Math.round(best.b / best.n);
        const hex = '#' + [rr, gg, bb].map(x => x.toString(16).padStart(2, '0')).join('');
        _logoColorCache.set(imageURL, hex);
        resolve(hex);
      } catch (e) {
        _logoColorCache.set(imageURL, null);
        resolve(null);
      }
    };
    img.src = imageURL;
  });
}

/* 시리즈 컬러 일괄 갱신 — symbol 기준.
   동기 부분: SERIES_META 적용 (즉시 반영)
   비동기 부분: 로고 색 추출 → 성공 시 다시 갱신 + render 호출 */
function _refreshSeriesColors() {
  // 1) SERIES_META 동기 적용 — 즉시 색 변경
  for (const s of RACE.series) {
    s.color = _resolveSeriesColor(s.symbol, s.color);
  }
  // 2) 로고 색 추출 (있는 종목만, 캐시 미스 시) — 끝나면 다시 적용
  for (const s of RACE.series) {
    const logo = _resolveLogo(s.symbol);
    if (!logo || _logoColorCache.has(logo)) continue;
    _extractDominantColor(logo).then(ext => {
      if (!ext) return;
      const e = MANIFEST.tickers && MANIFEST.tickers[s.symbol];
      if (e) e._extractedColor = ext;
      // 재적용
      s.color = _resolveSeriesColor(s.symbol, s.color);
      refreshDisplaySeries();
      renderSeriesRows();
      render();
    });
  }
}

const AUTO_LABEL_PRESETS = {
  // 지수
  sp500:             'S&P',
  nasdaq:            'NASDAQ',
  kospi:             'KOSPI',

  // 미국 주식 (US ticker 는 대부분 ASCII 폴백으로 자동 처리되지만, 명시 권장)
  tsla:              'TSLA',
  nvda:              'NVDA',
  aapl:              'AAPL',
  msft:              'MSFT',
  amzn:              'AMZN',
  googl:             'GOOGL',
  meta:              'META',
  avgo:              'AVGO',
  brk_b:             'BRK.B',
  jpm:               'JPM',
  nflx:              'NFLX',
  pltr:              'PLTR',
  amd:               'AMD',
  orcl:              'ORCL',
  cost:              'COST',
  wmt:               'WMT',
  ko:                'KO',
  mcd:               'MCD',
  visa:              'VISA',
  mastercard:        'MC',

  // 한국 주식 (Korean name 폴백은 앞 2-3자만 — 명시 라벨로 가독성↑)
  samsung:           'SS',
  skhynix:           'SK HX',
  lges:              'LGES',
  sbiologics:        'SBL',
  hyundai:           'HMC',
  kia:               'KIA',
  celltrion:         'CELL',
  kbfin:             'KB',
  naver:             'NAVER',
  hanwhaaero:        'HAA',
  kakao:             'KAKAO',
  doosanener:        'DSE',
  hdhi:              'HD HI',
  posco:             'POSCO',
  krafton:           'KRAF',

  // ETF
  qqq:   'QQQ',  voo:  'VOO',  vti:  'VTI',  schd: 'SCHD',
  soxx:  'SOXX', smh:  'SMH',  soxl: 'SOXL', tqqq: 'TQQQ',
  upro:  'UPRO', jepi: 'JEPI', jepq: 'JEPQ',

  // 암호화폐
  btc:               'BTC',
  bitcoin:           'BTC',
  eth:               'ETH',
  sol:               'SOL',
  xrp:               'XRP',
  doge:              'DOGE',
  bnb:               'BNB',
  ada:               'ADA',
  link:              'LINK',
  sui:               'SUI',
  avax:              'AVAX',

  // 원자재
  gold:              'GOLD',
  silver:            'AG',
  copper:            'CU',
  oil:               'OIL',
  gas:               'GAS',

  // 카드 / 스포츠
  pokemon_charizard: 'ZARD',
  pokemon_pikachu:   'PIKA',
  pokemon_mew:       'MEW',
  pokemon_lugia:     'LUGIA',
  black_lotus:       'LOTUS',
  rolex:             'ROLEX',
  ronaldo:           'CR7',
  messi:             'MESSI'
};

/* 한글이 섞여있으면 앞 2글자, 영문/숫자만 있으면 첫 단어의 앞 4글자 (대문자).
   결과가 비면 '?' 로 대체 — 절대 빈값 노출 금지. */
function _resolveAutoLabel(symbol, name) {
  const key = (symbol || '').toLowerCase();
  if (AUTO_LABEL_PRESETS[key]) return AUTO_LABEL_PRESETS[key];

  const raw = (name || symbol || '').trim();
  if (!raw) return '?';

  // 영문/숫자/기호 만 → 4자 (대문자)
  const isAscii = /^[\x20-\x7E]+$/.test(raw);
  if (isAscii) {
    const first = raw.split(/\s+/)[0] || raw;
    const clean = first.replace(/[^\w&\.]/g, '');
    return (clean.slice(0, 4) || raw.slice(0, 2)).toUpperCase();
  }
  // 한글/혼합 → 앞 2~3 글자 (4글자는 좁은 원에서 잘림)
  const stripped = raw.replace(/\s+/g, '');
  return stripped.slice(0, stripped.length <= 3 ? stripped.length : 3);
}

function _iconNodeKey(idx, ico, symbol) {
  // 모양도 키에 포함해 변경 시 노드 재생성
  return `${idx}:${ico.type}:${ico.value ?? ''}:${ico.shape || 'circle'}:${symbol || ''}`;
}

function _buildIconInner(ico, color, symbol, name) {
  if (ico.type === 'image' && ico.value) {
    return `<img src="${ico.value}" alt="" />`;
  }
  if (ico.type === 'emoji' && ico.value) {
    return `<span class="icon-emoji-glyph">${ico.value}</span>`;
  }
  /* auto: manifest 에 logo 가 등록되어 있으면 우선 사용 (영속 — 한 번 등록하면 계속).
     없으면 텍스트 약어 폴백 (시리즈 색 배경 + 흰색 굵음). */
  const logo = _resolveLogo(symbol);
  if (logo) return `<img src="${logo}" alt="" />`;
  const label = _resolveAutoLabel(symbol, name);
  const lenCls = label.length >= 6 ? 'len-xs' :
                 label.length >= 5 ? 'len-sm' :
                 label.length >= 4 ? 'len-md' : 'len-lg';
  return `<span class="icon-auto-label ${lenCls}" style="background:${color}">${label}</span>`;
}

function renderEndpointIcons(currentValues, leaderIdx, finished) {
  if (!endpointOverlay) return;

  /* sports 모드 + 실데이터 없음 → 끝점 아이콘/이름/금액/WIN 전부 차단.
     기존 노드도 깨끗이 정리. (CSS opacity 만으로는 충분치 않음 — DOM 자체 비움.) */
  if (_allSeriesCumulative() && !_hasSportsData()) {
    for (const [k, node] of _iconNodes) {
      node.remove();
      _iconNodes.delete(k);
    }
    // 원금 라벨도 같이 숨김 (sports 모드라 원래 안 보여야 하지만 이중 안전)
    const pe = document.getElementById('principalEndLabel');
    if (pe) pe.hidden = true;
    return;
  }

  /* finished 전환 (false → true) 프레임에서만 bounce 큐 리셋 */
  if (finished && !_prevFinished) {
    _bouncePlayed.clear();
  }
  if (!finished) _bouncePlayed.clear();
  _prevFinished = finished;

  // 미사용 노드 제거: 새 키 셋과 비교해 빠진 것 정리
  const seenKeys = new Set();

  /* ── 충돌 회피 사전계산 ──
     1) 각 시리즈의 자연 픽셀 좌표 산출
     2) ⭐ Shorts Safe — 2단계 clamp:
        (a) 아이콘 중심 X ≤ SHORTS_MAX_X_RATIO (소프트 가이드)
        (b) 렌더 후 라벨 bounding box 우측 끝 ≤ LABEL_MAX_RIGHT_RATIO (하드 보장)
        라인 자체는 끝까지 그려짐 — 아이콘 + 라벨 위치만 좌측으로 당김.
     3) Y 순으로 정렬 후 최소 간격(MIN_VGAP) 미만이면 아래로 밀어냄 */
  const MIN_VGAP   = 44;
  /* 아이콘 중심 1차 clamp — 62% (이전 69% 에서 7% 축소).
     긴 금액/이름이 없을 때도 끝점이 시각적으로 우측 너무 붙지 않게 */
  const SHORTS_MAX_X_RATIO    = 0.62;
  /* 라벨(아이콘+이름+금액+WIN) 전체 우측 끝 절대 한계 = 69% (Safe overlay 빨강 시작점).
     실제 측정한 offsetWidth 기준으로 초과 시 그만큼 좌측 이동. */
  const LABEL_MAX_RIGHT_RATIO = 0.69;
  const overlayW   = endpointOverlay.clientWidth || endpointOverlay.getBoundingClientRect().width;
  const maxXPx     = overlayW * SHORTS_MAX_X_RATIO;
  const maxLabelRightPx = overlayW * LABEL_MAX_RIGHT_RATIO;
  const liveTs     = timeAt(progress);
  const layout     = displaySeries.map((_s, idx) => {
    const v = currentValues[idx];
    if (liveTs == null || v == null || !isFinite(v)) return null;
    let p;
    try { p = chart.convertToPixel({ gridIndex: 0 }, [liveTs, v]); }
    catch { return null; }
    if (!p || !isFinite(p[0]) || !isFinite(p[1])) return null;
    // Shorts safe-area clamp — 라인 끝이 78% 를 넘어도 아이콘은 78% 에서 멈춤.
    const clampedX = Math.min(p[0], maxXPx);
    return { idx, x: clampedX, naturalY: p[1], y: p[1] };
  }).filter(Boolean);

  // Y 가 작은(위쪽) 항목부터 처리 — 충돌 시 아래로 push
  const sorted = layout.slice().sort((a, b) => a.naturalY - b.naturalY);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i].y - prev.y < MIN_VGAP) {
      sorted[i].y = prev.y + MIN_VGAP;
    }
  }
  // idx 로 빠르게 조회할 수 있도록 맵 구성
  const layoutByIdx = new Map(layout.map(l => [l.idx, l]));

  displaySeries.forEach((s, idx) => {
    const ico = s.icon || { type: 'auto', value: null };
    const key = _iconNodeKey(idx, ico, s.symbol);
    seenKeys.add(key);

    const pos = layoutByIdx.get(idx);
    if (!pos) return;
    const px = [pos.x, pos.y];
    const v  = currentValues[idx];

    // 노드 가져오기/생성
    let node = _iconNodes.get(`__idx${idx}`);
    if (!node || node.dataset.key !== key) {
      if (node) node.remove();
      node = document.createElement('div');
      node.className = 'endpoint-icon';
      node.dataset.key = key;
      node.style.color = s.color;
      node.innerHTML = `
        <div class="icon-inner shape-${ico.shape || 'circle'}">${_buildIconInner(ico, s.color, s.symbol, s.name)}</div>
        <div class="icon-meta">
          <div class="icon-name"></div>
          <div class="icon-ret"></div>
          <div class="icon-win" hidden>WIN</div>
        </div>
      `;
      endpointOverlay.appendChild(node);
      _iconNodes.set(`__idx${idx}`, node);
    }

    /* 위치: icon-inner (34px 원) 의 가운데가 정확히 데이터 포인트에 오도록 보정.
       flex 컨테이너 top-left = (px - 17, py - 17) → 첫 자식 icon-inner 중심 = (px, py).
       meta 텍스트는 자연스럽게 오른쪽으로 흐름. */
    node.style.left = `${px[0] - ICON_SIZE_HALF}px`;
    node.style.top  = `${px[1] - ICON_SIZE_HALF}px`;

    /* Bold. 레퍼런스 스타일: 이름(흰색) + 금액(시리즈 색) — 수익률 % 는 표시 X.
       시청자 입장에선 "지금 얼마가 됐는지" 절대 금액이 더 직관적. */
    const { ret } = computeRet(idx, v);
    const nameEl  = node.querySelector('.icon-name');
    const retEl   = node.querySelector('.icon-ret');
    const dispName = _seriesDisplayName(s);
    nameEl.textContent = dispName;
    // sports 모드면 골 카운트, 그 외엔 금액 포맷
    const moneyStr = _allSeriesCumulative() ? _formatGoals(v) : _amountFmtShort(v);
    retEl.textContent  = moneyStr;
    retEl.className    = 'icon-ret amount ' + (ret > 0 ? 'up' : ret < 0 ? 'down' : 'flat');

    /* 자리수 기반 자동 폰트 축소 — 큰 금액이 다른 라벨/차트와 겹치지 않도록.
       모바일에선 가용폭 좁아 더 공격적으로 줄임. CSS clamp() 위에 inline 으로 덮어씀. */
    const visibleLen = moneyStr.length;   // "24.9억", "1,524만" 등 길이 기준
    const isNarrow   = window.innerWidth < 768;
    let fontPx;
    if (visibleLen <= 5)       fontPx = isNarrow ? 13 : 14;
    else if (visibleLen <= 7)  fontPx = isNarrow ? 12 : 13;
    else if (visibleLen <= 9)  fontPx = isNarrow ? 11 : 12;
    else                       fontPx = isNarrow ? 10 : 11;
    retEl.style.fontSize = `${fontPx}px`;

    // 이름 라벨도 시리즈명이 길면 살짝 줄임
    // (한글 "코스피"=3자 vs 영문 "Samsung Electronics"=19자 — 둘 다 안전하게 처리)
    const nameLen = dispName.length;
    let nameFontPx;
    if (nameLen > 14)      nameFontPx = isNarrow ? 8.5 : 9;
    else if (nameLen > 10) nameFontPx = isNarrow ? 9.5 : 10;
    else if (nameLen > 8)  nameFontPx = 10;
    else                   nameFontPx = isNarrow ? 10.5 : 11;
    nameEl.style.fontSize = `${nameFontPx}px`;

    // 도착 bounce (시리즈마다 한 번)
    if (finished && !_bouncePlayed.has(idx)) {
      _bouncePlayed.add(idx);
      node.classList.remove('bounce');
      // reflow 강제 → 애니메이션 재시작
      void node.offsetWidth;
      node.classList.add('bounce');
    }

    /* 추월 펄스 — 최근 OVERTAKE_PULSE_MS 이내 추월했으면 살짝 bounce + glow 강화.
       텍스트 팝업 없음 (사용자가 차분히 "어 역전됐네" 느끼는 톤). */
    const overtakeTs = _overtakePulse.get(idx);
    if (overtakeTs !== undefined) {
      const elapsed = performance.now() - overtakeTs;
      if (elapsed < OVERTAKE_PULSE_MS) {
        if (!node.classList.contains('overtake-pulse')) {
          node.classList.add('overtake-pulse');
        }
      } else {
        node.classList.remove('overtake-pulse');
        _overtakePulse.delete(idx);
      }
    }

    /* "WIN" 인라인 마크 — finished 동안 리더에게만, 시리즈 색상 그대로 (currentColor).
       0.5s opacity 페이드인. 노란색 강제 없음. */
    const winEl = node.querySelector('.icon-win');
    if (finished && idx === leaderIdx) {
      winEl.hidden = false;
    } else {
      winEl.hidden = true;
    }
  });

  // 사라진 시리즈 노드 정리
  for (const [mapKey, node] of _iconNodes) {
    const idx = Number(mapKey.replace('__idx', ''));
    if (idx >= displaySeries.length) {
      node.remove();
      _iconNodes.delete(mapKey);
    }
  }

  /* ⭐ 2차 패스 — 라벨 bounding box 측정 후 우측 안전 한계 초과 시 좌측 이동.
     - offsetWidth 는 아이콘 + gap + 이름 + 금액 + WIN 전체 너비.
     - 자릿수 길거나 WIN 보일 때 자동으로 더 왼쪽으로.
     - 라인 자체는 그대로 — 아이콘/라벨 묶음만 이동. */
  for (const [mapKey, node] of _iconNodes) {
    if (!node.isConnected) continue;
    const idx = Number(mapKey.replace('__idx', ''));
    if (idx >= displaySeries.length) continue;
    const leftPx = parseFloat(node.style.left) || 0;
    const w      = node.offsetWidth;
    if (!isFinite(w) || w <= 0) continue;
    const rightEdge = leftPx + w;
    if (rightEdge > maxLabelRightPx) {
      node.style.left = `${Math.max(0, maxLabelRightPx - w)}px`;
    }
  }

  /* ── 원금 끝점 라벨 ──
     투자 모드 + 애니메이션 종료시에만 표시. 보조 정보 — 시리즈 끝점보다 훨씬 약한 톤.
     - 위치: 원금 점선의 마지막 값 (displayPrincipal 끝값) 의 픽셀 좌표
     - Shorts safe clamp: 시리즈 끝점 라벨과 동일하게 우측 한계 적용
     - 원금 정보를 직관적으로 인지 가능, 시선은 끌지 않음 */
  const principalEl = document.getElementById('principalEndLabel');
  if (principalEl) {
    const isInvestment = getCurrentMode() === 'investment';
    const hasPrincipal = !!(displayPrincipal && displayPrincipal.length);
    const showPe = isInvestment && finished && hasPrincipal;

    if (!showPe) {
      principalEl.hidden = true;
    } else {
      const liveTs   = timeAt(progress);
      const lastVal  = valueAt(displayPrincipal, progress);
      let pp = null;
      try { pp = chart.convertToPixel({ gridIndex: 0 }, [liveTs, lastVal]); }
      catch { /* convertToPixel 실패 시 숨김 */ }

      if (pp && isFinite(pp[0]) && isFinite(pp[1])) {
        principalEl.querySelector('.pe-value').textContent = _amountFmtShort(lastVal);
        // 라벨 이름도 lang-aware ("원금" / "PRINCIPAL")
        const nameEl = principalEl.querySelector('.pe-name');
        if (nameEl) nameEl.textContent = (I18N[_currentLang()] || I18N.ko).principal;
        // 원금 끝점의 우측에 약간 오프셋 두고 배치
        principalEl.style.left = `${pp[0] + 6}px`;
        principalEl.style.top  = `${pp[1] - 8}px`;
        principalEl.hidden = false;

        // Shorts safe — 우측 끝이 한계 초과 시 좌측 이동
        const w  = principalEl.offsetWidth;
        const lx = parseFloat(principalEl.style.left) || 0;
        if (isFinite(w) && w > 0 && lx + w > maxLabelRightPx) {
          principalEl.style.left = `${Math.max(0, maxLabelRightPx - w)}px`;
        }
      } else {
        principalEl.hidden = true;
      }
    }
  }
}

function renderChart(currentValues, leaderIdx, finished) {
  /* sports 모드 + 실데이터 없음 → 차트 자체를 빈 상태로 (라인/축/범례 0).
     CSS 의 .empty-sports 가 추가로 opacity 0 으로 캔버스 숨김. */
  if (_allSeriesCumulative() && !_hasSportsData()) {
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid:   { top: 0, left: 0, right: 0, bottom: 0 },
      xAxis:  { show: false, type: 'value', min: 0, max: 1 },
      yAxis:  { show: false, type: 'value', min: 0, max: 1 },
      series: []
    }, true);
    return;
  }

  const principalNow = displayPrincipal
    ? valueAt(displayPrincipal, progress)
    : null;

  const target = computeCameraTargets(currentValues, principalNow);
  if (yMinSmooth === null) {
    yMinSmooth = target.min;
    yMaxSmooth = target.max;
  } else {
    const ease = 0.10;
    yMinSmooth += (target.min - yMinSmooth) * ease;
    yMaxSmooth += (target.max - yMaxSmooth) * ease;
  }

  // 축 표시 여부에 따라 grid 여백 동적 조정
  // X축 라벨 회전 38° → 하단 여유 더 확보 (32 → 56)
  const gridLeft   = VIEW.showY ? 52 : 14;
  // gridBottom 축소 (56 → 44): 회전 라벨이 더 위에 위치, 차트 데이터 영역도 약간 확장
  const gridBottom = VIEW.showX ? 44 : 8;
  const gridRight  = VIEW.showEndLabel ? 86 : 16;
  const gridTop    = 16;

  /* X축 = 시작일~종료일 전체 범위 고정.
     재생 중에는 라인 데이터(values)만 progress 까지 slice 되어 늘어나고,
     축 자체는 늘었다 줄었다 하지 않는다. (사용자 요청 — fullData 기준 X축) */
  const xMinT = displayDateTimes[0] ?? 0;
  const xMaxT = displayDateTimes[displayDateTimes.length - 1] ?? 1;

  /* ----- 메인 시리즈 (색상 라인 + 면적 채우기) -----
     끝점 마커/라벨은 HTML 오버레이(renderEndpointIcons) 로 그리므로
     ECharts 의 endDot 심볼 & endLabel 은 비활성화. */
  const mainSeries = displaySeries.map((s, idx) => {
    const isLeader = idx === leaderIdx;
    const points   = buildLine(s.values, displayDateTimes, progress);

    return {
      type: 'line',
      name: s.name,
      smooth: 0.35,
      showSymbol: false,
      symbol: 'none',
      data: points,
      lineStyle: {
        width: (isLeader ? 4 : 3.2) * (finished ? 1.12 : 1),
        color: s.color,
        shadowColor: s.color,
        shadowBlur: (isLeader || finished) ? 5 : 0,
        cap: 'round',
        join: 'round'
      },
      // 라인 아래 면적: 더 자연스러운 페이드 (위 32% → 70% 지점 페이드 → 0)
      areaStyle: {
        origin: 'start',
        opacity: 1,
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0,    color: rgbaFromHex(s.color, finished ? 0.42 : 0.32) },
            { offset: 0.55, color: rgbaFromHex(s.color, 0.10) },
            { offset: 1,    color: rgbaFromHex(s.color, 0.0)  }
          ]
        }
      },
      emphasis: { disabled: true },
      animation: false,
      z: isLeader ? 3 : 2
    };
  });

  /* ----- 누적 투자금 점선 — 보조 레이어 -----
     역할: 투자 모드에서 비교 종목 라인과 "현재 누적 투입금" 의 시각적 격차를 보여주는 보조선.
     원칙: 주인공은 비교 종목(S&P500/코스피/...) — 점선은 절대 시선 끌면 안 됨.
       - getCurrentMode() === 'investment' 일 때만 생성 (sports/ranking/cumulative 무관 — 범용)
       - opacity 0.20 (이전 0.45 에서 ~55% 감소)
       - width 1.0 (이전 1.5 — 더 얇게)
       - z:1 (메인 시리즈 z:2~3 보다 항상 뒤)
       - silent:true (hover 이벤트 비활성)
       - showSymbol:false (끝점 마커/글로우 없음)
     이름은 "누적 투자금" 으로 명시 — 화면에 라벨 노출 X, DevTools 검사 시에만 확인 가능. */
  const principalSeries = (displayPrincipal && getCurrentMode() === 'investment') ? [{
    type: 'line',
    name: '누적 투자금',
    data: buildLine(displayPrincipal, displayDateTimes, progress),
    smooth: false,
    showSymbol: false,
    lineStyle: {
      width: 1.0,
      color: 'rgba(255, 255, 255, 0.20)',
      type: 'dashed'
    },
    silent: true,
    animation: false,
    z: 1
  }] : [];

  const option = {
    backgroundColor: 'transparent',
    animation: false,
    grid: { top: gridTop, left: gridLeft, right: gridRight, bottom: gridBottom, containLabel: false },

    xAxis: {
      type: 'time',
      min: xMinT,
      max: xMaxT,
      show: VIEW.showX,
      axisLine:  { show: true, lineStyle: { color: 'rgba(255,255,255,0.18)' } },
      axisTick:  { show: false },
      splitLine: { show: VIEW.showGrid, lineStyle: { color: 'rgba(255,255,255,0.05)' } },
      /* Bold. 레퍼런스: "2016-05-06" 형태로 회전된 라벨.
         margin 축소: 실기기 Shorts 하단 UI 영역과 시각적 여유 확보 (라벨 위로 이동) */
      axisLabel: {
        color: 'rgba(255,255,255,0.7)',
        fontSize: 10,
        margin: 4,
        hideOverlap: true,
        rotate: 38,
        formatter: (val) => {
          const d = new Date(val);
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          return `${y}-${m}`;
        }
      }
    },
    yAxis: {
      type: 'value',
      min: yMinSmooth,
      max: yMaxSmooth,
      show: VIEW.showY,
      axisLine:  { show: false },
      axisTick:  { show: false },
      splitLine: {
        show: true,
        lineStyle: { color: 'rgba(255,255,255,0.05)', type: 'dashed' }
      },
      axisLabel: {
        color: 'rgba(255,255,255,0.78)',
        fontSize: 11,
        fontWeight: 600,
        margin: 6,
        formatter: (val) => _allSeriesCumulative() ? _formatGoals(val) : _amountFmtShort(val)
      }
    },

    series: [...principalSeries, ...mainSeries]
  };

  // notMerge=true 로 축/그리드 옵션이 항상 새로 적용되게 함
  chart.setOption(option, true);
}

/* =========================================================
   하단 결과 카드 — 2개일 땐 좌/VS/우 레이아웃, 3개+ 는 랭킹
   ========================================================= */
/*
   원금 시계열 조회 — 신뢰할 만한 정보가 있을 때만 숫자 반환, 없으면 null.
     1) 웹 시뮬레이션 ON  → simulate() 가 생성한 _principalSeries
     2) Python meta(# monthly_invest) → linearly synthesized displayPrincipal
     3) 그 외 → null (수익률 카드의 "투자 X" 라인은 숨겨짐)
   ※ 과거에는 values[0] 을 원금 폴백으로 썼지만, Python DCA 데이터의 경우
     values[0] 은 1개월치 평가금일 뿐 누적 원금이 아니라 수익률이 폭증하는
     문제가 있어 제거함. 원금 정보가 없으면 차라리 "성장률" 로 표시.
*/
function getPrincipalAt(seriesIdx) {
  const s = displaySeries[seriesIdx];
  if (s && s._principalSeries) return valueAt(s._principalSeries, progress);
  if (displayPrincipal)         return valueAt(displayPrincipal, progress);
  return null;
}

/*
   수익률 계산기 — (평가금 - 누적원금) / 누적원금 * 100
   - 원금 정보가 있을 때만 계산. 없으면 0% (수익/원금 라인은 카드에서 숨김).
   - clamp: -99% ~ +9999% (이 이상은 데이터/단위 오류일 확률이 높음).
   - profit (수익 절대값) 도 함께 반환해 카드/라벨에서 바로 사용.
*/
function computeRet(seriesIdx, value) {
  const principal = getPrincipalAt(seriesIdx);
  let ret = 0;
  let profit = null;

  if (principal != null && principal > 0) {
    profit = value - principal;
    ret    = (profit / principal) * 100;
  }

  if (!Number.isFinite(ret)) ret = 0;
  if (ret >  9999) ret =  9999;
  if (ret <   -99) ret =   -99;

  return { ret, principal, profit };
}

function renderResults(currentValues, finished) {
  if (!resultsEl) return;

  const items = displaySeries.map((s, i) => {
    const value = currentValues[i];
    const { ret, principal, profit } = computeRet(i, value);
    return { name: s.name, color: s.color, value, principal, ret, profit };
  });

  // 1위 강조 (재생 완료 시)
  const winnerIdx = items.reduce(
    (max, it, i, arr) => it.value > arr[max].value ? i : max, 0
  );

  // 총 투자원금 — 모든 시리즈 공통이므로 카드 아래에 1회만 표시
  const sharedPrincipal = items[0]?.principal ?? 0;
  const totalHTML = sharedPrincipal > 0 ? `
    <div class="total-principal">
      <span class="lbl">총 투자원금</span>
      <span class="amt">${formatMoney(sharedPrincipal, RACE.unit)}</span>
    </div>
  ` : '';

  if (items.length === 2) {
    resultsEl.className = 'results layout-vs';
    frameEl.classList.add('two-series');
    resultsEl.innerHTML = `
      ${cardHTML(items[0], 'side-left',  finished && winnerIdx === 0)}
      <div class="vs-label">VS</div>
      ${cardHTML(items[1], 'side-right', finished && winnerIdx === 1)}
      ${totalHTML}
    `;
  } else {
    resultsEl.className = 'results layout-rank';
    frameEl.classList.remove('two-series');
    const ranked = items
      .map((it, i) => ({ ...it, _idx: i }))
      .sort((a, b) => b.value - a.value);
    resultsEl.innerHTML = ranked.map((it, rank) => {
      const dirCls = (it.profit ?? 0) > 0 ? ' up'
                   : (it.profit ?? 0) < 0 ? ' down' : '';
      return `
        <div class="result-card ${finished && it._idx === winnerIdx ? 'winner' : ''}" style="--c:${it.color}">
          <span class="rank-num">${rank + 1}</span>
          <span class="name">${it.name}</span>
          <span class="amount">${formatMoney(it.value, RACE.unit)}</span>
          <span class="ret${dirCls}">${fmtPct(it.ret)}</span>
        </div>
      `;
    }).join('') + totalHTML;
  }
}

/*
   카드 — 쇼츠용 초간결 3줄:
     [이름]          시리즈 색
     [평가금]        시리즈 색, 매우 큼
     [수익률 ±%]     초록(+)/빨강(-), 큼
   원금 / 수익 금액은 카드에서 제거되고 카드 아래 "총 투자원금" 으로 1회만 표시.
*/
function cardHTML(it, sideClass, isWinner) {
  const valueStr = formatMoney(it.value, RACE.unit);
  const dirCls   = (it.profit ?? 0) > 0 ? ' up'
                 : (it.profit ?? 0) < 0 ? ' down'
                 : '';

  return `
    <div class="result-card ${sideClass} ${isWinner ? 'winner' : ''}" style="--c:${it.color}">
      <div class="name">${it.name}</div>
      <div class="amount">${valueStr}</div>
      <div class="ret${dirCls}">${fmtPct(it.ret)}</div>
    </div>
  `;
}

/* 차트 내부 좌측 상단 범례 (반투명 검정 박스) */
function renderChartLegend() {
  if (!chartLegendEl) return;
  const items = [];
  if (displayPrincipal) {
    items.push(`<div class="cl-item"><span class="cl-line dashed"></span>투자금액</div>`);
  }
  const lang   = _currentLang();
  const suffix = displayPrincipal ? (lang === 'en' ? ' Value' : ' 평가액') : '';
  const principalLbl = lang === 'en' ? 'Invested' : '투자금액';
  if (displayPrincipal && items.length === 1) {
    // legacy: 첫 항목이 한글 하드코딩이라 lang 별로 재작성
    items[0] = `<div class="cl-item"><span class="cl-line dashed"></span>${principalLbl}</div>`;
  }
  displaySeries.forEach(s => {
    items.push(`
      <div class="cl-item">
        <span class="cl-line" style="background:${s.color}"></span>
        ${_escHtml(_seriesDisplayName(s))}${suffix}
      </div>
    `);
  });
  chartLegendEl.innerHTML = items.join('');
}

/*
   화면 부제 — Bold. 레퍼런스 스타일:
     "S&P 500 VS 비트코인" 같은 비교 대상 표기.
   우선순위:
     1) 사용자가 부제 입력란에 직접 적은 RACE.subtitle
     2) 시리즈 이름이 2개 이상이면 "A VS B" 자동 (대문자 VS)
     3) 시뮬레이션 ON 이면 투자 조건 한 줄
     4) 빈 문자열 (CSS 가 자동 숨김)
*/
function getDisplaySubtitle() {
  if (RACE.subtitle && RACE.subtitle.trim()) return RACE.subtitle.trim();

  const names = RACE.series.map(s => _seriesDisplayName(s)).filter(Boolean);
  if (names.length >= 2) return names.join(' VS ');

  if (INVESTMENT.enabled) {
    const startD = parseDate(INVESTMENT.startDate) || parseDate(displayDates[0]);
    const endD   = parseDate(INVESTMENT.endDate)   || parseDate(displayDates[displayDates.length - 1]);
    const amt    = formatMoney(INVESTMENT.amount, RACE.unit);
    const period = fmtPeriodKr(startD, endD);
    if (INVESTMENT.mode === 'lump') {
      return `${amt}원 일시투자 (${period})`;
    }
    return `${freqKr(INVESTMENT.mode)} ${amt}원씩 ${period} 투자`;
  }
  return '';
}

// 옛 자동 생성 분기 (호환용 — getDisplaySubtitle 가 이미 모든 케이스를 처리)
function _legacyAutoSubtitle() {
  if (INVESTMENT.enabled) {
    const startKr = fmtDateKr(INVESTMENT.startDate || displayDates[0] || '');
    const amt     = fmtMoneyStr(INVESTMENT.amount, RACE.unit);
    if (!startKr) return '';
    if (INVESTMENT.mode === 'lump') return `${startKr}에 ${amt} 일시투자 기준`;
    return `${startKr}부터 ${modeLabel(INVESTMENT.mode)} ${amt} 기준`;
  }
  return '';
}

/* HTML 인젝션 안전 — innerHTML 에 넣기 전에 텍스트 이스케이프 */
function _escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSubtitle() {
  if (!subtitleEl) return;

  /* 사용자가 직접 부제를 적었으면 그 텍스트 그대로 표시.
     자동 생성 (시리즈 2개+) 이면 각 시리즈 이름을 시리즈 색으로 컬러링, "VS" 는 흰색. */
  const userSubtitle = (RACE.subtitle && RACE.subtitle.trim()) || '';
  const names  = RACE.series.map(s => _seriesDisplayName(s)).filter(Boolean);
  const colors = RACE.series.map(s => s.color);

  if (!userSubtitle && names.length >= 2) {
    const parts = [];
    for (let i = 0; i < names.length; i++) {
      parts.push(`<span class="sub-series" style="color:${_escHtml(colors[i])}">${_escHtml(names[i])}</span>`);
      if (i < names.length - 1) parts.push('<span class="sub-vs">VS</span>');
    }
    subtitleEl.innerHTML = parts.join(' ');
    return;
  }

  // 사용자 직접 입력 / 시리즈 1개 이하 → 일반 텍스트 (HTML 주입 방지)
  subtitleEl.textContent = getDisplaySubtitle();
}

/*
   데이터 범위 검증 — 새 정책 (2026-06-01):
     "공통 비교 구간(intersection) 이 1개 이상 존재하면" → 경고 금지.
     그래프와 끝점이 정상적으로 그려지는 상황에서는 경고를 띄우지 않는다.
     공통 구간이 전혀 없는 경우(=비교 자체 불가) 에만 경고를 만든다.

   sidebar(csv-info) 는 항상 CSV 기간을 표시하지만, '⚠️ warn' 강조도
   동일한 규칙을 따른다. (intersection 이 있으면 ✓ 일치로 표시)
*/
function getRangeWarning() {
  // 시뮬레이션 OFF 면 X축이 CSV 범위와 일치하므로 경고 의미 없음
  if (!INVESTMENT.enabled) return null;

  // 공통 비교 구간이 1개 이상 있으면 → 정상적으로 비교 가능 → 경고 금지
  if (RACE.dates && RACE.dates.length > 0) return null;

  // 공통 구간이 0개 = 비교 불가능한 케이스만 경고
  return {
    type: 'no-common-range',
    csvFirst: '-',
    csvLast:  '-',
    settingStart: INVESTMENT.startDate,
    settingEnd:   INVESTMENT.endDate,
  };
}

/* 사이드바 — CSV 기간 / 일치 상태 항상 표시.
   intersection 이 있으면 ✓ 일치, 없으면 ⚠️ 비교 불가능. */
function renderCsvInfo() {
  const el = document.getElementById('csv-info');
  if (!el) return;
  if (!RACE.dates.length) {
    // 공통 구간이 전혀 없으면 사이드바에는 경고만 표시
    const w = getRangeWarning();
    if (!w) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.add('warn');
    el.innerHTML =
      `⚠️ <strong>공통 비교 구간 없음</strong><br>` +
      `선택한 종목들이 동일 기간에 모두 존재하지 않습니다.<br>` +
      `<code>python generate_data.py</code> 로 재생성하거나 종목 조합을 바꿔주세요.`;
    return;
  }

  const first = RACE.dates[0];
  const last  = RACE.dates[RACE.dates.length - 1];
  const count = RACE.dates.length;

  el.hidden = false;
  el.classList.remove('warn');
  el.innerHTML =
    `✓ <strong>CSV 기간 ${first} ~ ${last}</strong> (${count}개월) — 비교 가능`;
}

/* 차트 위 pill 경고 — 기본값: 숨김(Hidden).
   Shorts 녹화 화면(=프레임 내부) 에 노출되지 않도록 기본 숨김 처리.
   디버그 시 `window.IR_SHOW_RANGE_WARNING = true` 또는
   `document.body.dataset.showRangeWarning = '1'` 으로 옵트인 가능.
   옵트인 했을 때도 getRangeWarning() 이 null 을 반환하면 (=정상 비교 가능) 표시 안 함. */
function updateRangeWarning() {
  const el = document.getElementById('rangeWarning');
  if (!el) return;

  const optedIn =
    (typeof window !== 'undefined' && window.IR_SHOW_RANGE_WARNING === true) ||
    (document.body && document.body.dataset.showRangeWarning === '1');

  if (!optedIn) { el.hidden = true; return; }

  const w = getRangeWarning();
  if (!w) { el.hidden = true; return; }   // intersection 존재 → 그래프 정상 → 경고 금지

  el.hidden = false;
  el.title  = '선택한 종목들의 공통 비교 구간이 없습니다 — 좌측 사이드바 확인';
  el.innerHTML = '<span class="rw-icon">⚠️</span><span>비교 구간 없음</span>';
}

function render() {
  const currentValues = displaySeries.map(s => valueAt(s.values, progress));
  const leaderIdx     = currentValues.indexOf(Math.max(...currentValues));
  const finished      = X_MAX > 0 && progress >= X_MAX - 0.0001;

  detectOvertakes(
    currentValues.map((v, i) => ({ value: v, name: displaySeries[i].name }))
  );

  frameEl.classList.toggle('finished', finished);

  // 제목/날짜/부제는 INVESTMENT 설정 따라 자동 동기화 (사용자 직접 입력 시 그 값 유지)
  renderTitle();
  renderDate();
  renderSubtitle();
  renderProgress();
  renderChart(currentValues, leaderIdx, finished);
  renderChartLegend();
  renderEndpointIcons(currentValues, leaderIdx, finished);
  renderResults(currentValues, finished);

  // CSV 기간 검증 — 매 프레임 호출되지만 DOM 업데이트는 idempotent
  renderCsvInfo();
  updateRangeWarning();
}

/* =========================================================
   11. 애니메이션 루프
   ========================================================= */
function tick(time) {
  if (playing) {
    if (lastTime > 0) {
      const dt = (time - lastTime) / 1000;
      // 데이터 길이와 무관하게 DURATION_SECONDS 안에 완주
      const stepsPerSec = DURATION_SECONDS > 0 ? (X_MAX / DURATION_SECONDS) : 0;
      progress += dt * stepsPerSec * speedMul;
      if (progress >= X_MAX) {
        progress   = X_MAX;
        playing    = false;
        finishedAt = time;
      }
    }
    lastTime = time;
  }

  render();

  const inGlow = finishedAt !== null && (time - finishedAt) < FINISH_GLOW_DURATION;
  if (playing || inGlow) {
    requestAnimationFrame(tick);
  } else {
    finishedAt = null;
  }
}

/* =========================================================
   12. 재생 컨트롤
   ========================================================= */
function play() {
  if (X_MAX === 0) return;
  if (progress >= X_MAX) {
    progress   = 0;
    yMinSmooth = null;
    yMaxSmooth = null;
    xMaxSmooth = null;
    prevDiffs  = {};
    finishedAt = null;
    frameEl.classList.remove('finished');
  }
  if (playing) return;
  playing  = true;
  lastTime = 0;
  requestAnimationFrame(tick);
}

function pause() {
  playing  = false;
  lastTime = 0;
}

function reset() {
  playing    = false;
  lastTime   = 0;
  progress   = 0;
  yMinSmooth = null;
  yMaxSmooth = null;
  prevDiffs  = {};
  finishedAt = null;
  clearBanner();
  frameEl.classList.remove('finished');
  xMaxSmooth = null;
  render();
}

function cycleSpeedMul() {
  speedMul = speedMul === 1 ? 2 : speedMul === 2 ? 4 : 1;
  if (speedBtn) speedBtn.textContent = `⚡ x${speedMul}`;
}

// 구버전 frame-bottom 컨트롤 (있을 때만 바인딩)
if (playBtn)  playBtn .addEventListener('click', play);
if (pauseBtn) pauseBtn.addEventListener('click', pause);
if (resetBtn) resetBtn.addEventListener('click', reset);
if (speedBtn) speedBtn.addEventListener('click', cycleSpeedMul);

// 모바일 sticky 하단 CTA — 인라인 메인 CTA 와 동일 동작 (라벨/검증/재생 로직 공유)
const mobileCtaBtn = document.getElementById('btn-mobile-cta');
if (mobileCtaBtn && sbRestartBtn) {
  mobileCtaBtn.addEventListener('click', () => sbRestartBtn.click());
}

// 새 사이드바 3단계 — 영상 실행 버튼
if (sbRestartBtn) sbRestartBtn.addEventListener('click', () => {
  // 사전 검증 — 누락 종목 있으면 재생 차단. 메시지는 mode 별로 다름
  const missing = getMissingSeries();
  if (missing.length) {
    const mode = getCurrentMode();
    if (mode === 'sports') {
      // 스포츠 — 중앙 안내 카드 (alert 대체)
      showDataPrepModal();
    } else {
      alert(
        '데이터 없음:\n  · ' + missing.join('\n  · ') + '\n\n' +
        '📦 [데이터] 버튼을 눌러 다운로드한 뒤 다시 시도하세요.\n' +
        '(0으로 그리거나 샘플 데이터를 만들지 않습니다.)'
      );
    }
    return;
  }
  reset();
  setTimeout(play, 80);
});
if (sbPlayBtn)  sbPlayBtn .addEventListener('click', play);
if (sbPauseBtn) sbPauseBtn.addEventListener('click', pause);

// 새 사이드바 2단계 — 실제 데이터 생성 안내
/* 🔄 최신 데이터 확인 — manifest 의 모든 종목을 api/download (append-only) 로 갱신.
   ⚠️ 이 기능은 로컬 dev (server.py) 환경에서만 작동.
       GH Pages 정적 배포에선 api 가 없어 자연히 readonly 모드 — 안내만 표시. */
async function refreshAllData() {
  await detectServer();
  if (!dbServerOK) {
    alert(
      '📦 현재 정적(읽기 전용) 모드입니다.\n\n' +
      '데이터 갱신은 로컬 개발 환경에서만 가능합니다:\n' +
      '  1) 터미널에서  python3 server.py  실행\n' +
      '  2) http://localhost:5500 으로 접속\n' +
      '  3) 다시 [최신 데이터 확인] 클릭\n\n' +
      'GH Pages 배포 환경에선 db/*.csv 가 미리 커밋되어야 합니다.'
    );
    return;
  }

  const tickers = Object.values(MANIFEST.tickers || {});
  if (!tickers.length) {
    alert('등록된 종목이 없습니다. 📦 데이터 페이지에서 종목을 먼저 추가하세요.');
    return;
  }

  const btn = generateDataBtn;
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '확인 중...'; }

  const results = [];
  for (const t of tickers) {
    try {
      const r = await fetch('api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t.name, symbol: t.symbol, ticker: t.ticker })
      });
      const result = await r.json();
      results.push({ ...t, ...result });
    } catch (e) {
      results.push({ ...t, ok: false, message: e.message });
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = origText; }

  // manifest + 시리즈 데이터 다시 로드
  await loadManifest();
  await loadSeriesData();
  _refreshSeriesColors();
  refreshDisplaySeries();
  renderSeriesRows();
  render();

  // 결과 요약
  const totalAdded = results.reduce((s, r) => s + (r.added || 0), 0);
  const lines = results.map(r => {
    if (!r.ok) return `❌ ${r.name}: ${r.message || '실패'}`;
    if (r.added === 0) return `✓ ${r.name}: 이미 최신 (${r.count}개월)`;
    return `+ ${r.name}: ${r.added}개월 추가 → 총 ${r.count}개월 (${r.first} ~ ${r.last})`;
  });
  alert(
    `📦 최신 데이터 확인 완료\n\n${lines.join('\n')}\n\n` +
    (totalAdded > 0 ? `총 ${totalAdded}개월 새로 추가됨` : '모든 종목이 최신 상태입니다.')
  );
}

if (generateDataBtn) generateDataBtn.addEventListener('click', refreshAllData);

/* ✨ Welcome card — 처음 방문자 안내 (localStorage 로 1회만 표시) */
const WELCOME_KEY = 'race_welcome_dismissed_v2';
(function setupWelcome() {
  const card = document.getElementById('welcomeCard');
  const closeBtn = document.getElementById('welcomeClose');
  if (!card) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(WELCOME_KEY) === '1'; } catch (e) {}
  if (!dismissed) card.hidden = false;
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      card.hidden = true;
      try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
    });
  }
})();

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
  e.preventDefault();
  playing ? pause() : play();
});

/* =========================================================
   13. 사이드바: 시리즈 행 렌더
   ========================================================= */
/* 시리즈 변경 시 부제 자동 갱신 트리거.
   ⚠️ 주의: RACE.subtitle 에는 절대 자동 생성 값을 저장하지 않음.
     - RACE.subtitle 가 비어있으면 renderSubtitle() 이 RACE.series 로부터
       그때그때 "A VS B" 컬러 스팬을 만들어 표시함.
     - 만약 여기서 RACE.subtitle = "A VS B" 로 저장하면 renderSubtitle 이
       "사용자가 직접 입력한 텍스트" 로 오인 → 단색 textContent 경로 → 컬러 분리 안 됨.
   사용자가 부제 입력칸에 직접 적은 경우만 RACE.subtitle 에 저장됨 (input 이벤트). */
function syncTitleFromSeries() {
  if (typeof renderSubtitle === 'function') renderSubtitle();
}

function _iconPreviewHTML(ico, color, symbol, name) {
  if (ico && ico.type === 'image' && ico.value) {
    return `<img src="${ico.value}" alt="" />`;
  }
  if (ico && ico.type === 'emoji' && ico.value) {
    return `<span>${ico.value}</span>`;
  }
  // auto: manifest 의 logo 가 있으면 작은 원형 로고로, 없으면 텍스트 약어
  const logo = _resolveLogo(symbol);
  if (logo) return `<img src="${logo}" alt="" />`;
  const label = _resolveAutoLabel(symbol, name);
  return `<span class="row-auto-label" style="background:${color}">${label}</span>`;
}

function renderSeriesRows() {
  // manifest 의 ticker 들을 category 그룹으로 옵션 구성
  const grouped = _groupByCategory(MANIFEST.tickers || {});

  seriesListEl.innerHTML = RACE.series.map((s, i) => {
    const entry = s.symbol && MANIFEST.tickers[s.symbol];
    const hasData = entry && entry.status === 'ok' && entry.count > 0;
    let tag;
    if (!entry) {
      tag = '<span class="series-warn" title="종목을 선택해주세요">⚠</span>';
    } else if (!hasData) {
      tag = '<span class="series-warn" title="데이터 없음 — 📦 데이터 페이지에서 다운로드/업로드 필요">⚠</span>';
    } else {
      tag = '<span class="series-ok" title="데이터 정상">●</span>';
    }
    const opts = grouped.map(([cat, items]) => {
      const meta  = _catMeta(cat);
      const inner = items.map(t => {
        const empty = (t.status !== 'ok' || !t.count) ? ' (데이터 없음)' : '';
        return `<option value="${t.symbol}" ${t.symbol === s.symbol ? 'selected' : ''}>${t.name} (${t.symbol})${empty}</option>`;
      }).join('');
      return `<optgroup label="${meta.badge} ${meta.label}">${inner}</optgroup>`;
    }).join('');
    const iconHtml = _iconPreviewHTML(s.icon, s.color, s.symbol, s.name);
    return `
      <div class="series-row" data-i="${i}">
        <input type="color" class="js-color" value="${s.color}" title="라인 색" />
        <select class="js-symbol" title="비교 종목">
          <option value="">— 종목 선택 —</option>
          ${opts}
        </select>
        <button type="button" class="js-icon-btn" title="끝점 아이콘 변경">${iconHtml}</button>
        ${tag}
        <button type="button" class="btn-remove js-remove" title="삭제">×</button>
      </div>
    `;
  }).join('');

  // ----- 이벤트 바인딩 -----
  seriesListEl.querySelectorAll('.series-row').forEach(row => {
    const i = Number(row.dataset.i);

    row.querySelector('.js-color').addEventListener('input', (e) => {
      RACE.series[i].color = e.target.value;
      if (INVESTMENT.enabled && displaySeries[i]) displaySeries[i].color = e.target.value;
      render();
    });

    row.querySelector('.js-symbol').addEventListener('change', async (e) => {
      const sym = e.target.value;
      RACE.series[i].symbol = sym || null;
      const entry = sym ? MANIFEST.tickers[sym] : null;
      // 🚀 드롭다운이 곧 이름의 source-of-truth — 항상 동기화
      if (entry) {
        RACE.series[i].name = entry.name;
      } else {
        RACE.series[i].name = '';
      }
      // 새 종목 CSV 로드 + 공통 타임라인 재정렬
      await loadSeriesData();
      _refreshSeriesColors();   // 새 symbol 의 브랜드 컬러 자동 적용
      // 제목 자동 갱신 (예: 나스닥 vs 테슬라)
      syncTitleFromSeries();
      yMinSmooth = null; yMaxSmooth = null;
      refreshDisplaySeries();
      renderSeriesRows();
      render();
    });

    row.querySelector('.js-remove').addEventListener('click', () => {
      if (RACE.series.length <= 1) return;
      RACE.series.splice(i, 1);
      loadSeriesData().then(() => {
        _refreshSeriesColors();
        syncTitleFromSeries();
        yMinSmooth = null; yMaxSmooth = null;
        refreshDisplaySeries();
        renderSeriesRows();
        render();
      });
    });

    row.querySelector('.js-icon-btn').addEventListener('click', () => {
      openIconModal(i);
    });
  });
}

function addSeries() {
  if (RACE.series.length >= MAX_SERIES) return;
  const i = RACE.series.length;
  // 새 시리즈는 manifest 에서 아직 안 쓴 첫 ticker 자동 선택
  const used = new Set(RACE.series.map(s => s.symbol).filter(Boolean));
  const next = Object.values(MANIFEST.tickers || {}).find(t => !used.has(t.symbol));
  RACE.series.push({
    name:   next ? next.name : '',
    symbol: next ? next.symbol : null,
    color:  DEFAULT_COLORS[i % DEFAULT_COLORS.length],
    icon:   { type: 'auto', value: null },
    values: []
  });
  loadSeriesData().then(() => {
    _refreshSeriesColors();
    syncTitleFromSeries();
    refreshDisplaySeries();
    renderSeriesRows();
    render();
  });
}
addSeriesBtn.addEventListener('click', addSeries);

/* =========================================================
   인기 비교 주제 프리셋 — 한 클릭으로 종목/기간/투자금 적용
   ========================================================= */
const PRESETS = [
  { icon: '🇺🇸🇰🇷', label: 'S&P500 vs 코스피',  series: ['sp500', 'kospi'],  amount: 300000, start: '2010-01' },
  { icon: '🇺🇸💻',  label: 'S&P500 vs 나스닥',  series: ['sp500', 'nasdaq'], amount: 300000, start: '2010-01' },
  { icon: '🚗⚡',   label: '테슬라 vs S&P500',  series: ['tsla',  'sp500'],  amount: 300000, start: '2015-01' },
  { icon: '🔥🚀',   label: '엔비디아 vs S&P500', series: ['nvda',  'sp500'],  amount: 1000000, start: '2016-05',
    title: '10년 전\n엔비디아에\n투자했다면?' },
  { icon: '₿📈',   label: 'BTC vs S&P500',    series: ['btc',   'sp500'],  amount: 1000000, start: '2016-05',
    title: '10년 전\n비트코인에\n투자했다면?' },
  { icon: '₿💻',   label: 'BTC vs 나스닥',    series: ['btc',   'nasdaq'], amount: 1000000, start: '2016-05' },
  { icon: '🇰🇷💻',  label: '코스피 vs 나스닥',  series: ['kospi', 'nasdaq'], amount: 300000, start: '2010-01' },
  { icon: '🔥📈',   label: '포켓몬카드 vs S&P', series: ['pokemon_charizard', 'sp500'], amount: 300000, start: '2017-01' },
  { icon: '₿🥇',    label: '비트코인 vs 금',    series: ['bitcoin', 'gold'], amount: 300000, start: '2017-01' },
  /* ⚽ 스포츠 — DCA 무관, 누적 골 레이스. applyPreset 이 sports mode 감지 시 자동으로
     INVESTMENT 비활성 + 단위 '골' 로 전환 (이후 sports preset 추가도 같은 패턴) */
  { icon: '⚽🐐',   label: '호날두 vs 메시',    series: ['ronaldo', 'messi'], amount: 0, start: '2002-08', mode: 'goals' }
];

function _presetIsReady(p) {
  return p.series.every(sym => MANIFEST.tickers && MANIFEST.tickers[sym] && MANIFEST.tickers[sym].status === 'ok' && MANIFEST.tickers[sym].count > 0);
}

/* 프리셋의 종합 상태 — 모든 series 의 최저 상태 = 프리셋 상태.
   active(완) → preparing(준비중) → planned(예정) */
function _presetStatus(p) {
  let worst = 'active';
  for (const sym of p.series) {
    const e = MANIFEST.tickers && MANIFEST.tickers[sym];
    const k = getEntryStatus(e).kind;
    if (k === 'planned') worst = 'planned';
    else if (k === 'preparing' && worst !== 'planned') worst = 'preparing';
  }
  return worst;
}
const PRESET_STATUS_LABEL = {
  active:    null,           // active 면 뱃지 안 표시
  preparing: '🟡 준비중',
  planned:   '⚪ 예정'
};
const PRESET_STATUS_TIP = {
  preparing: '실제 경기/시장 데이터 수집 후 자동 활성화됩니다',
  planned:   '예정된 비교 주제 — 아직 작업 시작 전입니다'
};

function renderPresets() {
  const wrap = document.querySelector('#presetsRow .presets-scroll');
  if (!wrap) return;
  wrap.innerHTML = PRESETS.map((p, i) => {
    const ready = _presetIsReady(p);
    const st    = _presetStatus(p);
    const tagLabel = PRESET_STATUS_LABEL[st];
    const tagTip   = PRESET_STATUS_TIP[st] || '';
    return `
      <button type="button" class="preset-card${ready ? '' : ' is-disabled'}"
              data-i="${i}"
              ${ready ? '' : `aria-disabled="true" title="${tagTip || 'DB 데이터 없음'}"`}>
        <span class="preset-icon">${p.icon}</span>
        <span class="preset-label">${p.label}</span>
        ${tagLabel ? `<span class="preset-tag st-${st}">${tagLabel}</span>` : ''}
      </button>
    `;
  }).join('');

  wrap.querySelectorAll('.preset-card').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('is-disabled')) {
        const i = Number(btn.dataset.i);
        const p = PRESETS[i];
        if (p && p.mode === 'goals') {
          showDataPrepModal();    // 중앙 안내 카드
        } else {
          alert('이 주제는 아직 DB 에 데이터가 없습니다.\n📦 데이터 페이지에서 추가해주세요.');
        }
        return;
      }
      const i = Number(btn.dataset.i);
      applyPreset(PRESETS[i]);
    });
  });
}

function applyPreset(p) {
  // 시리즈 교체 — manifest 에서 정확한 이름 가져옴
  RACE.series = p.series.map((sym, idx) => {
    const entry = MANIFEST.tickers[sym] || {};
    return {
      name:   entry.name || sym,
      symbol: sym,
      color:  DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      icon:   { type: 'auto', value: null },
      values: []
    };
  });

  /* sports mode (goals) 는 DCA 비활성 + 단위 '골'.
     일반 stocks/cards 는 평소대로 DCA on + 단위 '원'. */
  if (p.mode === 'goals') {
    INVESTMENT.enabled   = false;
    INVESTMENT.amount    = 0;
    INVESTMENT.startDate = p.start;
    INVESTMENT.endDate   = _currentYearMonth();
    RACE.unit            = '골';
  } else {
    INVESTMENT.enabled   = true;
    INVESTMENT.amount    = p.amount;
    INVESTMENT.startDate = p.start;
    INVESTMENT.endDate   = _currentYearMonth();
    RACE.unit            = '원';
  }
  // 사이드바 인풋 동기화
  if (simAmountInput)  simAmountInput.value  = INVESTMENT.amount;
  if (simStartInput)   simStartInput.value   = INVESTMENT.startDate;
  if (simEndInput)     simEndInput.value     = INVESTMENT.endDate;
  if (simEnabledInput) simEnabledInput.checked = INVESTMENT.enabled;
  if (unitInput)       unitInput.value       = RACE.unit;

  /* preset 이 title 오버라이드를 명시했으면 RACE.title 에 적용. 없으면 빈 값으로
     되돌려 자동 제목 (매월 X원씩 / N년 / 모았다면?) 이 다시 작동. 하드코딩 없음 —
     preset 데이터로만 제어. */
  RACE.title = p.title || '';
  if (titleInput) {
    titleInput.value = RACE.title || '';
    titleInput.placeholder = `자동: ${getDisplayTitle().replace(/\n/g, ' / ')}`;
  }

  // 데이터 재로드 후 렌더
  loadSeriesData().then(() => {
    _refreshSeriesColors();   // 프리셋 종목들의 브랜드 컬러 즉시 적용 (NVDA → 초록 등)
    syncTitleFromSeries();
    yMinSmooth = null; yMaxSmooth = null;
    refreshDisplaySeries();
    renderSeriesRows();
    render();
  });
}

/* =========================================================
   14. 사이드바: 기본 입력 바인딩 (라이브)
   ========================================================= */
function bindLiveInputs() {
  titleInput.addEventListener('input', () => {
    RACE.title = titleInput.value;
    // 비워두면 다시 자동 제목으로 — placeholder 도 그에 맞춰 갱신
    if (!RACE.title) {
      titleInput.placeholder = `자동: ${getDisplayTitle().replace(/\n/g, ' / ')}`;
    }
    renderTitle();
  });

  subtitleInput.addEventListener('input', () => {
    RACE.subtitle = subtitleInput.value;
    renderSubtitle();
  });

  unitInput.addEventListener('input', () => {
    RACE.unit = unitInput.value;
    render();
  });

  // ----- 투자 시뮬레이션 -----
  function onInvestChange() {
    refreshDisplaySeries();
    yMinSmooth = null; yMaxSmooth = null;
    // 자동 제목 placeholder 갱신 (사용자가 직접 입력 안 했을 때만 의미 있음)
    if (titleInput && !RACE.title) {
      titleInput.placeholder = `자동: ${getDisplayTitle().replace(/\n/g, ' / ')}`;
    }
    render();
  }

  simEnabledInput.addEventListener('change', () => {
    INVESTMENT.enabled = simEnabledInput.checked;
    onInvestChange();
  });
  simModeInput.addEventListener('change', () => {
    INVESTMENT.mode = simModeInput.value;
    onInvestChange();
  });
  simAmountInput.addEventListener('input', () => {
    INVESTMENT.amount = Math.max(0, Number(simAmountInput.value) || 0);
    onInvestChange();
  });
  simStartInput.addEventListener('input', () => {
    INVESTMENT.startDate = simStartInput.value.trim();
    onInvestChange();
  });
  simEndInput.addEventListener('input', () => {
    INVESTMENT.endDate = simEndInput.value.trim();
    onInvestChange();
  });

  periodInput.addEventListener('change', () => {
    RACE.periodUnit = periodInput.value;
  });

  speedInput.addEventListener('change', () => {
    DURATION_SECONDS = Number(speedInput.value) || 12;
  });

  showXInput.addEventListener('change', () => {
    VIEW.showX = showXInput.checked;
    render();
  });

  showYInput.addEventListener('change', () => {
    VIEW.showY = showYInput.checked;
    render();
  });

  showGridInput.addEventListener('change', () => {
    VIEW.showGrid = showGridInput.checked;
    render();
  });

  showEndLabelInput.addEventListener('change', () => {
    VIEW.showEndLabel = showEndLabelInput.checked;
    render();
  });

  showOvertakeInput.addEventListener('change', () => {
    VIEW.showOvertake = showOvertakeInput.checked;
    if (!VIEW.showOvertake) clearBanner();
  });

  /* 📱 Shorts Safe Mode 토글 — frame 에 .show-safe 클래스 추가/제거 */
  const shortsSafeInput = document.getElementById('inp-show-shorts-safe');
  if (shortsSafeInput) shortsSafeInput.addEventListener('change', () => {
    frameEl.classList.toggle('show-safe', shortsSafeInput.checked);
  });
}

/* =========================================================
   15. CSV 적용 / 동기화 / data.csv 자동 로드
   ========================================================= */
/*
   CSV 알림 패널 (사이드바) — 시리즈 매핑 결과를 시각적으로 안내.
   text 가 빈 문자열이면 숨김.
*/
function showCsvNotice(text, kind /* 'info' | 'warn' */ = 'info') {
  const el = document.getElementById('csv-notice');
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('warn');
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.classList.toggle('warn', kind === 'warn');
}

/*
   applyCSVToRace(silent, opts)
   ───────────────────────────────────────────
   mode 두 가지:

     'data-only' (기본, 안전)
       - 현재 RACE.series 배열은 그대로 유지 (이름/색/순서 보존)
       - CSV 의 같은 이름 컬럼만 찾아 values 를 교체
       - 현재 시리즈 중 CSV 에 없는 항목 → 마지막 값으로 길이 패딩 + 경고
       - CSV 에 있는데 현재 미선택 항목 → 안내만 (자동 추가하지 않음)
       - RACE.dates 는 항상 CSV 의 것으로 교체

     'full-replace' (명시적, 위험)
       - CSV 의 헤더대로 RACE.series 를 새로 구성
       - 색상은 위치별로 기존 것 유지, 없으면 기본 팔레트
       - "CSV 기준 전체 불러오기" 버튼에서만 사용
*/
function applyCSVToRace(silent = false, opts = {}) {
  let mode = opts.mode || 'data-only';
  const parsed = parseCSV(csvInput.value);
  if (!parsed) {
    if (!silent) {
      alert('CSV 형식이 올바르지 않습니다.\n예:\ndate,삼성전자,애플\n2020-01,100,100\n2020-02,115,108');
    }
    return false;
  }

  // 안전 가드: 현재 시리즈가 없으면 data-only 가 의미 없으므로 full-replace 로 폴백
  if (mode === 'data-only' && RACE.series.length === 0) mode = 'full-replace';

  // 날짜는 항상 CSV 기준으로 교체
  RACE.dates = parsed.dates;
  const newLen = parsed.dates.length;

  if (mode === 'full-replace') {
    const existing = RACE.series;
    RACE.series = parsed.series.slice(0, MAX_SERIES).map((s, i) => ({
      name:   s.name,
      color:  existing[i]?.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
      values: s.values
    }));
    showCsvNotice('', 'info');
  } else {
    // ----- data-only: 시리즈 UI 는 절대 건드리지 않음 -----
    const csvLookup    = Object.fromEntries(parsed.series.map(s => [s.name, s.values]));
    const csvNames     = parsed.series.map(s => s.name);
    const currentNames = RACE.series.map(s => s.name);
    const missing = currentNames.filter(n => !csvLookup[n]);
    const extra   = csvNames.filter(n => !currentNames.includes(n));

    RACE.series = RACE.series.map(s => {
      const newValues = csvLookup[s.name];
      if (newValues) return { ...s, values: newValues };
      // CSV 에 없는 시리즈 → 마지막 값으로 길이 보정 (그래프 깨지지 않게)
      const out = s.values.slice(0, newLen);
      while (out.length < newLen) out.push(out[out.length - 1] ?? 0);
      return { ...s, values: out };
    });

    // 사용자에게 매핑 결과 안내
    if (missing.length || extra.length) {
      const lines = [];
      if (missing.length) {
        lines.push(`⚠️ CSV 에 없는 시리즈 (기존 값 유지): ${missing.join(', ')}`);
      }
      if (extra.length) {
        lines.push(`💡 CSV 에 있지만 현재 미선택: ${extra.join(', ')}`);
        lines.push(`→ 추가하려면 "🔄 CSV 기준 전체 불러오기" 버튼을 사용하세요.`);
      }
      showCsvNotice(lines.join('\n'), missing.length > 0 ? 'warn' : 'info');
    } else {
      showCsvNotice(`✓ ${currentNames.length}개 시리즈 데이터 업데이트 완료`, 'info');
    }
  }

  // ----- CSV 첫 줄 주석(메타) 처리 ----------------------------------
  // # subtitle : 화면 부제 (정보용)
  // # unit     : 값 단위 (만원/원/USD 등 — 선택)
  // # monthly_invest : 사이드바 amount 초기 힌트 (있을 때만, 선택)
  // ※ CSV 값은 항상 "가격" 으로 해석된다. monthly_invest 메타는 더 이상
  //   "이미 DCA 계산된 데이터" 라는 신호로 쓰이지 않음. DCA 계산은
  //   refreshDisplaySeries 가 단 한 번 수행한다 (이중 계산 방지).
  const meta = parsed.meta || {};
  if (meta.subtitle) {
    RACE.subtitle = meta.subtitle;
    if (subtitleInput) subtitleInput.value = meta.subtitle;
  }
  if (meta.unit) {
    RACE.unit = meta.unit;
    if (unitInput) unitInput.value = meta.unit;
  }
  if (meta.monthly_invest) {
    const v = Number(meta.monthly_invest);
    if (Number.isFinite(v) && v > 0) {
      INVESTMENT.amount = v;
      if (simAmountInput) simAmountInput.value = v;
    }
  }
  // investPerPeriod 는 더 이상 사용하지 않지만 호환을 위해 0 으로 유지
  RACE.investPerPeriod = 0;

  refreshDisplaySeries();
  renderSeriesRows();

  // ----- 검증 로그 (콘솔) -----
  if (RACE.dates.length) {
    const f = RACE.dates[0];
    const l = RACE.dates[RACE.dates.length - 1];
    console.log(`[CSV] 적용 완료 — 기간 ${f} ~ ${l}, 총 ${RACE.dates.length}개월`);
    const w = getRangeWarning();
    if (w) {
      console.warn(
        `[CSV ⚠️] 설정 ${INVESTMENT.startDate} ~ ${INVESTMENT.endDate} 와 데이터 범위 불일치 (${f} ~ ${l}).\n` +
        `   → data.csv 를 다시 생성하거나 시작/종료일을 조정하세요.`
      );
    }
  }

  return true;
}

csvLoadBtn.addEventListener('click', () => {
  // textarea CSV 적용 — 안전한 data-only. 시리즈 재구성하려면 별도 버튼 사용.
  if (applyCSVToRace(false, { mode: 'data-only' })) reset();
});

if (csvSyncBtn) csvSyncBtn.addEventListener('click', () => {
  csvInput.value = serializeCSV(RACE);
});

/*
   파일 시스템의 data.csv 를 가져와 적용.
   opts.mode 로 동작 모드 지정.
*/
async function tryAutoLoadCSV(opts = {}) {
  try {
    const res = await fetch('./data.csv', { cache: 'no-cache' });
    if (!res.ok) return false;
    const text = await res.text();
    if (!text || text.trim().length < 10) return false;

    csvInput.value = text.trim();
    if (!applyCSVToRace(false, opts)) return false;

    // Python 산출 CSV 는 이미 "평가금" → 웹툴의 시뮬레이션 모드는 끔
    INVESTMENT.enabled      = false;
    simEnabledInput.checked = false;

    // 제목 자동 생성은 full-replace 모드에서만 (data-only 는 사용자 설정 보존)
    if (opts.mode === 'full-replace') {
      const names = RACE.series.map(s => s.name);
      if (names.length >= 2) {
        RACE.title       = names.join(' vs ');
        titleInput.value = RACE.title;
      }
    }

    refreshDisplaySeries();
    console.log(`✓ data.csv 로드 (mode=${opts.mode || 'data-only'}, dates=${RACE.dates.length}, series=${RACE.series.length})`);
    return true;
  } catch (e) {
    return false;
  }
}

/* 📁 data.csv 다시 불러오기 — 파일 텍스트만 textarea 에 로드.
   자동 적용/시뮬레이션/시리즈 추가/값 누적 모두 금지.
   사용자가 "CSV 적용" 버튼을 명시적으로 눌러야 RACE 반영 + DCA 1회 실행. */
csvReloadBtn.addEventListener('click', async () => {
  try {
    // 새 데이터 구조 — manifest + per-ticker CSV 다시 읽기
    await loadManifest();
    await loadSeriesData();
    _refreshSeriesColors();
    renderSeriesRows();
    refreshDisplaySeries();
    reset();

    const tickerCount = Object.keys(MANIFEST.tickers || {}).length;
    const missing = getMissingSeries();
    if (missing.length) {
      showCsvNotice(
        `⚠️ 데이터 없는 종목: ${missing.join(', ')}\n` +
        `📦 데이터 페이지에서 다운로드해주세요.`,
        'warn'
      );
    } else {
      const first = RACE.dates[0] || '-';
      const last  = RACE.dates[RACE.dates.length - 1] || '-';
      showCsvNotice(
        `✓ ${tickerCount}개 종목 (${first} ~ ${last}, ${RACE.dates.length}개월) 로드 완료`,
        'info'
      );
    }
    return;
  } catch (e) {
    alert(
      'data.csv 를 찾을 수 없습니다.\n\n' +
      '먼저 터미널에서 Python 스크립트를 실행해주세요:\n' +
      '    python generate_data.py\n\n' +
      '(http:// 가 아닌 file:// 로 열면 보안 정책상 읽을 수 없습니다.\n' +
      ' VSCode Live Server 등으로 띄워주세요.)'
    );
  }
});

/* "CSV 기준 전체 불러오기" — 명시적 full-replace.
   data.csv 헤더에 맞춰 시리즈를 다시 만든다 (색상은 위치별 보존 시도). */
const csvReloadFullBtn = document.getElementById('btn-csv-reload-full');
if (csvReloadFullBtn) {
  csvReloadFullBtn.addEventListener('click', async () => {
    const ok = confirm(
      '현재 시리즈 구성을 모두 버리고\n' +
      'CSV(또는 data.csv) 헤더 기준으로 시리즈를 다시 만듭니다.\n\n' +
      '이 동작은 사이드바의 시리즈 목록을 덮어씁니다. 계속할까요?'
    );
    if (!ok) return;

    // textarea 에 내용이 이미 있으면 그걸 그대로 full-replace. 비어 있으면 파일에서 fetch.
    if (csvInput.value.trim().length > 10) {
      if (applyCSVToRace(false, { mode: 'full-replace' })) reset();
    } else {
      const loaded = await tryAutoLoadCSV({ mode: 'full-replace' });
      if (loaded) reset();
      else alert('data.csv 를 찾을 수 없고 텍스트영역도 비어 있어 재구성할 수 없습니다.');
    }
  });
}

if (applyBtn) applyBtn.addEventListener('click', () => {
  reset();
  setTimeout(play, 80);
});

/*
   기본값 복원 — RACE / VIEW / INVESTMENT 를 모듈 로드 시점의 스냅샷으로
   되돌리고 미리보기를 새로 그린다. 이전 data.csv 의 잔존 영향을 한 번에 제거.
   (파일 system 의 data.csv 자체는 건드리지 않음.)
*/
function restoreDefaults() {
  // 재생 중지
  playing  = false;
  lastTime = 0;
  progress = 0;

  // 객체 채로 갈아끼우지 않고 키 단위로 덮어쓰기 → 외부 참조 무효화 방지
  Object.keys(RACE).forEach(k => delete RACE[k]);
  Object.assign(RACE, JSON.parse(JSON.stringify(DEFAULTS.RACE)));

  Object.assign(VIEW, DEFAULTS.VIEW);
  Object.assign(INVESTMENT, DEFAULTS.INVESTMENT);

  // 파생/카메라 상태 초기화
  yMinSmooth       = null;
  yMaxSmooth       = null;
  xMaxSmooth       = null;
  finishedAt       = null;
  displayPrincipal = null;
  prevDiffs        = {};
  clearBanner();
  frameEl.classList.remove('finished');
  frameEl.classList.remove('two-series');
  showCsvNotice('', 'info');

  // 폼 / 시리즈 행 / 차트 / 결과 모두 새로 그림
  populateForm();
  renderSeriesRows();
  refreshDisplaySeries();
  renderTitle();
  render();
}

const restoreBtn = document.getElementById('btn-restore-defaults');
if (restoreBtn) {
  restoreBtn.addEventListener('click', () => {
    const ok = confirm(
      '현재 데이터/설정을 모두 초기화하고 기본 데모(S&P500 vs 코스피)로 돌아갈까요?\n\n' +
      '※ 디스크의 data.csv 파일은 그대로 유지됩니다.\n' +
      '   data.csv 를 다시 쓰려면 "📁 data.csv 다시 불러오기" 버튼을 사용하세요.'
    );
    if (ok) restoreDefaults();
  });
}

/* =========================================================
   16. 초기화: 폼 값 채우기 + 첫 렌더
   ========================================================= */
function populateForm() {
  // 빈 RACE.title 은 placeholder 로 안내 (자동 생성중임을 표시)
  titleInput.value = RACE.title || '';
  if (titleInput && !RACE.title) {
    titleInput.placeholder = `자동: ${getDisplayTitle().replace(/\n/g, ' / ')}`;
  }
  subtitleInput.value  = RACE.subtitle || '';
  unitInput.value      = RACE.unit;
  periodInput.value    = RACE.periodUnit;
  showXInput.checked   = VIEW.showX;
  showYInput.checked   = VIEW.showY;
  showGridInput.checked = VIEW.showGrid;
  showEndLabelInput.checked = VIEW.showEndLabel;
  showOvertakeInput.checked = VIEW.showOvertake;
  csvInput.value       = serializeCSV(RACE);
  DURATION_SECONDS     = Number(speedInput.value) || 12;

  // 투자 시뮬레이션
  simEnabledInput.checked = INVESTMENT.enabled;
  simModeInput.value      = INVESTMENT.mode;
  simAmountInput.value    = INVESTMENT.amount;
  simStartInput.value     = INVESTMENT.startDate;
  simEndInput.value       = INVESTMENT.endDate;
}

/* ═══════════════════════════════════════════════════════════════
   📦 DB 모달 — 종목 데이터 관리
   ═══════════════════════════════════════════════════════════════ */
const dbModal = document.getElementById('dbModal');
const dbOpenBtn = document.getElementById('btn-open-db');
const dbCloseBtn = document.getElementById('db-close-btn');
const dbAddBtn = document.getElementById('db-add-btn');
const dbCountEl = document.getElementById('db-count');
const dbUpdatedEl = document.getElementById('db-updated');
const dbServerStatusEl = document.getElementById('db-server-status');
const dbServerWarnEl = document.getElementById('db-server-warn');
const dbTbody = document.getElementById('db-tbody');

/* DB 쓰기 API 가용 여부.
   - 로컬 dev (server.py 실행) : true 가 되어 [다운로드/업로드/삭제] 활성화
   - GH Pages 정적 호스팅       : 404 / network error → false → readonly 모드
   기본값 false: detectServer() 가 호출되어 OK 확인되기 전까지는 안전하게 비활성. */
let dbServerOK = false;

async function detectServer() {
  // 간단한 health check — OPTIONS 로 API 존재 확인 (또는 POST 빈 body)
  try {
    const r = await fetch('api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    // 400 (필수 인자 없음) 도 서버가 떠 있다는 신호
    dbServerOK = (r.status === 400 || r.status === 200);
  } catch (e) {
    dbServerOK = false;
  }
}

/* 카테고리 표시 메타 — 키: manifest 의 category 값
   (label = 그룹 헤더, badge = 작은 한 글자 뱃지) */
const CATEGORY_META = {
  stock:     { label: '주식',     badge: '📈' },
  etf:       { label: 'ETF',      badge: '📊' },
  crypto:    { label: '암호화폐', badge: '🪙' },
  commodity: { label: '원자재',   badge: '🥇' },
  card:      { label: '카드',     badge: '🃏' },
  sports:    { label: '스포츠',   badge: '⚽' },
  watch:     { label: '시계',     badge: '⌚' },
  art:       { label: '예술품',   badge: '🎨' },
  other:     { label: '기타',     badge: '📦' }
};
const CATEGORY_ORDER = ['stock', 'etf', 'crypto', 'commodity', 'card', 'sports', 'watch', 'art', 'other'];

function _catMeta(cat) {
  return CATEGORY_META[cat] || CATEGORY_META.other;
}

/* manifest 의 ticker 들을 category 별로 그루핑 — UI 두 곳(DB 테이블, 시리즈 드롭다운) 이 공유 */
function _groupByCategory(tickers) {
  const groups = new Map();
  for (const t of Object.values(tickers || {})) {
    const cat = t.category || 'stock';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(t);
  }
  // CATEGORY_ORDER 순으로, 그 외는 뒤에
  const ordered = [];
  for (const cat of CATEGORY_ORDER) {
    if (groups.has(cat)) ordered.push([cat, groups.get(cat)]);
    groups.delete(cat);
  }
  for (const [cat, items] of groups) ordered.push([cat, items]);
  return ordered;
}

function renderDBTable() {
  const tickers = MANIFEST.tickers || {};
  const list = Object.values(tickers);

  if (dbCountEl)   dbCountEl.textContent = list.length;
  if (dbUpdatedEl) dbUpdatedEl.textContent = MANIFEST.updated_at
    ? new Date(MANIFEST.updated_at).toLocaleString('ko-KR')
    : '-';

  if (dbServerStatusEl) {
    dbServerStatusEl.textContent = dbServerOK ? '✓ 실행 중' : '✗ 미실행';
    dbServerStatusEl.classList.toggle('off', !dbServerOK);
  }
  if (dbServerWarnEl) dbServerWarnEl.hidden = dbServerOK;
  if (dbAddBtn) {
    dbAddBtn.disabled = !dbServerOK;
    dbAddBtn.title = dbServerOK ? '' : 'server.py 가 실행 중이어야 합니다';
  }

  if (!list.length) {
    dbTbody.innerHTML = `
      <tr><td colspan="7" class="db-empty">
        저장된 종목이 없습니다.<br>
        아래 [새 종목 다운로드] 또는 터미널에서 <code>python3 generate_data.py</code>
      </td></tr>
    `;
    return;
  }

  // 카테고리 별로 섹션 헤더 + 행
  const grouped = _groupByCategory(tickers);
  const rows = [];
  for (const [cat, items] of grouped) {
    const meta = _catMeta(cat);
    // 카테고리 내부 정렬 — active 우선 / preparing 다음 / planned 마지막
    items.sort((a, b) => _statusRank(a) - _statusRank(b));
    rows.push(`
      <tr class="db-cat-row"><td colspan="7">
        <span class="db-cat-badge">${meta.badge}</span>
        <span class="db-cat-name">${meta.label}</span>
        <span class="db-cat-count">${items.length}</span>
      </td></tr>
    `);
    for (const t of items) {
      const isManual = (t.source === 'manual');
      const st       = getEntryStatus(t);
      const noData   = st.kind !== 'active';
      const statusBadge = `<span class="status-badge st-${st.kind}"><span class="sb-dot"></span>${st.label}</span>`;
      const tickerCell = t.ticker
        ? `<code>${t.ticker}</code>`
        : '<span class="t-muted">—</span>';
      const rangeCell = (t.first && t.last)
        ? `${t.first} ~ ${t.last}`
        : '<span class="t-muted">—</span>';

      /* 액션 버튼 — 주식(yfinance)은 ↻ 재다운로드, 수동/카드는 ↻ 비활성화 + 위 업로드 폼 사용 */
      const refreshBtn = isManual
        ? `<button class="db-row-btn" disabled title="아래 [CSV 업로드] 폼을 사용하세요">↻</button>`
        : `<button class="db-row-btn" data-action="refresh"
                  data-name="${t.name}" data-symbol="${t.symbol}" data-ticker="${t.ticker}"
                  ${dbServerOK ? '' : 'disabled'} title="yfinance 재조회">↻</button>`;

      rows.push(`
        <tr class="${noData ? 'db-row-empty' : ''}">
          <td class="t-cat">${_catMeta(cat).badge}</td>
          <td class="t-name">${t.name}</td>
          <td class="t-ticker">${tickerCell}</td>
          <td class="t-range">${rangeCell}</td>
          <td class="t-count">${t.count || 0}</td>
          <td class="t-status">${statusBadge}</td>
          <td class="t-actions">
            ${refreshBtn}
            <button class="db-row-btn danger" data-action="delete"
                    data-symbol="${t.symbol}"
                    ${dbServerOK ? '' : 'disabled'}>×</button>
          </td>
        </tr>
      `);
    }
  }
  dbTbody.innerHTML = rows.join('');

  // 액션 바인딩
  dbTbody.querySelectorAll('.db-row-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.action;
      if (action === 'refresh') {
        await downloadViaAPI(btn.dataset.name, btn.dataset.symbol, btn.dataset.ticker);
      } else if (action === 'delete') {
        if (!confirm(`${btn.dataset.symbol} 을(를) 삭제하시겠습니까?`)) return;
        await deleteViaAPI(btn.dataset.symbol);
      }
    });
  });
}

async function downloadViaAPI(name, symbol, ticker) {
  if (!dbServerOK) {
    alert(
      '📦 정적(읽기 전용) 모드입니다.\n\n' +
      '데이터 추가/업로드는 로컬 dev 환경 (python3 server.py) 에서만 가능합니다.\n' +
      'GH Pages 배포는 db/*.csv 가 미리 커밋되어 있어야 합니다.'
    );
    return;
  }
  const btn = dbAddBtn;
  if (btn) { btn.disabled = true; btn.textContent = '다운로드 중...'; }
  try {
    const r = await fetch('api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, symbol: symbol.toLowerCase(), ticker })
    });
    const result = await r.json();
    if (result.ok) {
      // manifest 다시 로드
      await loadManifest();
      renderDBTable();
      alert(
        `✓ ${name} 다운로드 완료\n` +
        `   ${result.count}개월  ${result.first} ~ ${result.last}\n` +
        `   가격 ${result.first_price.toLocaleString()} → ${result.last_price.toLocaleString()}`
      );
    } else {
      alert('다운로드 실패: ' + (result.message || '알 수 없는 오류'));
    }
  } catch (e) {
    alert('네트워크 오류: ' + e.message);
  } finally {
    if (btn) { btn.disabled = !dbServerOK; btn.textContent = '다운로드'; }
  }
}

async function deleteViaAPI(symbol) {
  try {
    const r = await fetch('api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    const result = await r.json();
    if (result.ok) {
      await loadManifest();
      renderDBTable();
    } else {
      alert('삭제 실패: ' + (result.message || '?'));
    }
  } catch (e) {
    alert('네트워크 오류: ' + e.message);
  }
}

if (dbOpenBtn) dbOpenBtn.addEventListener('click', async () => {
  await detectServer();
  await loadManifest();
  renderDBTable();
  dbModal.showModal();
});
if (dbCloseBtn) dbCloseBtn.addEventListener('click', () => {
  dbModal.close();
});
if (dbAddBtn) dbAddBtn.addEventListener('click', async () => {
  const name   = document.getElementById('db-add-name').value.trim();
  const symbol = document.getElementById('db-add-symbol').value.trim().toLowerCase();
  const ticker = document.getElementById('db-add-ticker').value.trim();
  if (!name || !symbol || !ticker) {
    alert('이름, 심볼, 티커 모두 입력해주세요.');
    return;
  }
  await downloadViaAPI(name, symbol, ticker);
  document.getElementById('db-add-name').value = '';
  document.getElementById('db-add-symbol').value = '';
  document.getElementById('db-add-ticker').value = '';
});

/* ── 카드 / 콜렉터블 CSV 업로드 ── */
const dbUpNameEl     = document.getElementById('db-up-name');
const dbUpSymbolEl   = document.getElementById('db-up-symbol');
const dbUpCategoryEl = document.getElementById('db-up-category');
const dbUpCsvEl      = document.getElementById('db-up-csv');
const dbUpFileEl     = document.getElementById('db-up-file');
const dbUpBtn        = document.getElementById('db-up-btn');

if (dbUpFileEl) dbUpFileEl.addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = () => {
    dbUpCsvEl.value = reader.result || '';
    // 파일명에서 심볼 자동 추정 (예: pokemon_charizard.csv → pokemon_charizard)
    if (!dbUpSymbolEl.value && f.name) {
      dbUpSymbolEl.value = f.name.replace(/\.csv$/i, '').toLowerCase();
    }
  };
  reader.readAsText(f, 'utf-8');
});

async function uploadCsvViaAPI(name, symbol, category, csv) {
  if (!dbServerOK) {
    alert(
      '📦 정적(읽기 전용) 모드입니다.\n\n' +
      '데이터 추가/업로드는 로컬 dev 환경 (python3 server.py) 에서만 가능합니다.\n' +
      'GH Pages 배포는 db/*.csv 가 미리 커밋되어 있어야 합니다.'
    );
    return;
  }
  if (dbUpBtn) { dbUpBtn.disabled = true; dbUpBtn.textContent = '업로드 중...'; }
  try {
    const r = await fetch('api/upload_csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, symbol, category, csv })
    });
    const j = await r.json();
    if (!j.ok) {
      alert('업로드 실패: ' + (j.message || '?'));
      return;
    }
    alert(
      `✓ ${name} (${symbol}) ${j.count}개월 저장 완료\n` +
      `   기간 ${j.first} ~ ${j.last}, 이번 추가 +${j.added}`
    );
    await loadManifest();
    renderDBTable();
  } catch (e) {
    alert('네트워크 오류: ' + e.message);
  } finally {
    if (dbUpBtn) { dbUpBtn.disabled = false; dbUpBtn.textContent = '업로드'; }
  }
}

if (dbUpBtn) dbUpBtn.addEventListener('click', async () => {
  const name     = (dbUpNameEl.value || '').trim();
  const symbol   = (dbUpSymbolEl.value || '').trim().toLowerCase();
  const category = (dbUpCategoryEl.value || 'card').trim();
  const csv      = dbUpCsvEl.value || '';
  if (!name || !symbol || !csv.trim()) {
    alert('이름, 심볼, CSV 모두 입력해주세요.');
    return;
  }
  await uploadCsvViaAPI(name, symbol, category, csv);
  dbUpNameEl.value = '';
  dbUpSymbolEl.value = '';
  dbUpCsvEl.value = '';
});

// 모달 닫힐 때 메인 화면도 갱신 (새로 받은 종목이 있을 수 있음)
if (dbModal) dbModal.addEventListener('close', async () => {
  await loadSeriesData();
  _refreshSeriesColors();
  refreshDisplaySeries();
  renderSeriesRows();
  render();
});

/* ═══════════════════════════════════════════════════════════════
   🎨 아이콘 선택 모달
   ═══════════════════════════════════════════════════════════════ */
const iconModal       = document.getElementById('iconModal');
const iconModalClose  = document.getElementById('icon-modal-close');
const iconTabs        = document.querySelectorAll('.icon-tab');
const iconPanes       = document.querySelectorAll('.icon-tab-pane');
const iconPickAuto    = document.getElementById('icon-pick-auto');
const iconEmojiGrid   = document.getElementById('icon-emoji-grid');
const iconFileInput   = document.getElementById('icon-file-input');
const iconUploadZone   = document.getElementById('iconUploadZone');
const iconUploadResult = document.getElementById('iconUploadResult');
const iconPreviewImg   = document.getElementById('icon-preview-img');
const iconUploadChange = document.getElementById('iconUploadChange');
const iconUploadRemove = document.getElementById('iconUploadRemove');
const shapePickerEl    = document.getElementById('shapePicker');
let _iconEditIdx = -1;
let _selectedShape = 'circle';   // 모달 내 임시 상태 — 적용 시 icon.shape 로 저장

/* 업로드 zone / 결과 패널 상태 전환 — 한 곳에서만 토글 */
function _setUploadState(dataUrl) {
  const hasImg = !!dataUrl;
  if (iconUploadZone)   iconUploadZone.hidden   = hasImg;
  if (iconUploadResult) iconUploadResult.hidden = !hasImg;
  if (hasImg && iconPreviewImg) iconPreviewImg.src = dataUrl;
}

/* shape picker — 현재 선택을 aria-pressed 로 표시 */
function _setShape(shape) {
  _selectedShape = shape;
  if (!shapePickerEl) return;
  shapePickerEl.querySelectorAll('.shape-opt').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.shape === shape));
  });
}

function openIconModal(seriesIdx) {
  if (!iconModal) return;
  _iconEditIdx = seriesIdx;
  // 현재 시리즈 icon 상태에 맞춰 탭 / 모양 / 업로드 상태 동기화
  const cur = RACE.series[seriesIdx]?.icon || { type: 'auto', value: null, shape: 'circle' };
  _switchIconTab(cur.type === 'image' ? 'image' : cur.type === 'emoji' ? 'emoji' : 'auto');
  _setShape(cur.shape || 'circle');
  _setUploadState(cur.type === 'image' && cur.value ? cur.value : null);
  iconModal.showModal();
}

function _switchIconTab(name) {
  iconTabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  iconPanes.forEach(p => { p.hidden = p.dataset.pane !== name; });
}

function _applyIcon(type, value) {
  if (_iconEditIdx < 0 || !RACE.series[_iconEditIdx]) return;
  // shape 는 auto 일 때만 의미 있지만, 사용자가 다른 type 로 갔다가 돌아올 때 유지하려고 항상 저장
  RACE.series[_iconEditIdx].icon = { type, value, shape: _selectedShape };
  refreshDisplaySeries();
  renderSeriesRows();
  render();
  iconModal.close();
}

if (iconModalClose) iconModalClose.addEventListener('click', () => iconModal.close());
iconTabs.forEach(t => t.addEventListener('click', () => _switchIconTab(t.dataset.tab)));

if (shapePickerEl) shapePickerEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.shape-opt');
  if (!btn) return;
  _setShape(btn.dataset.shape);
});

if (iconPickAuto) iconPickAuto.addEventListener('click', () => _applyIcon('auto', null));

if (iconEmojiGrid) iconEmojiGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('.icon-emoji');
  if (!btn) return;
  _applyIcon('emoji', btn.textContent.trim());
});

/* 파일 처리 공통 로직 — 탭 선택 / 드래그앤드롭 둘 다에서 호출 */
async function _handleIconFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('이미지 파일만 업로드할 수 있습니다 (PNG / JPG / WebP).');
    return;
  }
  // 큰 파일은 다운스케일이 들어가므로 toast 로 진행 표시
  const needsOptimize = file.size > 800 * 1024;   // 0.8MB 초과 시 안내
  if (needsOptimize) _showProgress('자동 최적화 중...');

  try {
    const dataUrl = await cropImageToCircle(file, 160);
    _setUploadState(dataUrl);
    _applyIcon('image', dataUrl);
  } catch (err) {
    alert('이미지 처리 실패: ' + (err?.message || err));
  } finally {
    if (needsOptimize) _hideProgress();
  }
}

if (iconFileInput) iconFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  await _handleIconFile(file);
  e.target.value = '';                  // 같은 파일 재선택 허용
});

/* "변경" → 파일 선택 다시 열기 / "삭제" → auto 로 되돌리고 zone 다시 보이기 */
if (iconUploadChange) iconUploadChange.addEventListener('click', () => iconFileInput?.click());
if (iconUploadRemove) iconUploadRemove.addEventListener('click', () => {
  _setUploadState(null);
  _applyIcon('auto', null);
});

/* Drag & Drop (PC) — coarse pointer (모바일/터치) 에선 자연스럽게 무시됨.
   dragover 에서 preventDefault 안하면 drop 이 안 일어남. */
if (iconUploadZone) {
  ['dragenter', 'dragover'].forEach(ev => {
    iconUploadZone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      iconUploadZone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'dragend'].forEach(ev => {
    iconUploadZone.addEventListener(ev, () => {
      iconUploadZone.classList.remove('is-dragover');
    });
  });
  iconUploadZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    iconUploadZone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) await _handleIconFile(file);
  });
}

/* =========================================================
   콘텐츠 도구 패널 — 추천 제목 / 해시태그 / 영상 저장
   ========================================================= */
const contentToolsEl       = document.getElementById('contentTools');
const contentToolsToggleEl = document.getElementById('contentToolsToggle');
const ctTitlePreviewEl     = document.getElementById('ct-title-preview');
const ctSubtitlePreviewEl  = document.getElementById('ct-subtitle-preview');
const ctHashtagsEl         = document.getElementById('ct-hashtags');
const saveVideoBtn         = document.getElementById('btn-save-video');
const saveVideoHintEl      = document.getElementById('saveVideoHint');

// 패널 토글 (애니메이션 없는 단순 collapse)
if (contentToolsToggleEl && contentToolsEl) {
  contentToolsToggleEl.addEventListener('click', () => {
    const collapsed = contentToolsEl.classList.toggle('collapsed');
    contentToolsToggleEl.setAttribute('aria-expanded', String(!collapsed));
    if (!collapsed) updateContentTools();   // 펼칠 때 최신 값 반영
  });
}

// 복사 버튼 (data-copy-target → id)
document.querySelectorAll('.ct-copy').forEach(btn => {
  btn.addEventListener('click', async () => {
    const id = btn.dataset.copyTarget;
    const el = document.getElementById(id);
    if (!el) return;
    const text = (el.textContent || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const dict = I18N[_currentLang()] || I18N.ko;
      const orig = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = dict.copyDone || '복사됨';
      setTimeout(() => {
        btn.classList.remove('copied');
        // 토글 사이 lang 가 바뀌었을 수도 있으니 dict.copyBtn 우선
        const d2 = I18N[_currentLang()] || I18N.ko;
        btn.textContent = d2.copyBtn || orig;
      }, 1400);
    } catch (e) {
      alert('복사 실패: ' + (e.message || '?'));
    }
  });
});

/* ═════════════════════════════════════════════════════════════════
   🌐 다국어 (i18n) — 영상 컨텐츠 표시 영역만 번역.
       사이드바 (운영자 인터페이스) 는 한국어 유지.
   ═════════════════════════════════════════════════════════════════
   영향 범위:
     - 프레임 타이틀 / 부제 / WIN 텍스트 / 빈 상태 안내
     - Y축 / 끝점 라벨 / 원금 라벨 (통화)
     - 콘텐츠 도구 패널 (추천 제목 / 부제 / 해시태그 / 영상저장 라벨)
     - CTA 버튼 "▶ 투자 결과 보기" / "▶ Watch Investment Race"
   영향 없음:
     - 사이드바 step 헤더 / 필드 라벨 / 프리셋 카드 / DB 모달 / 웰컴 카드
*/
const I18N = {
  ko: {
    /* 후크 카피 생성기 (3줄 그루핑) */
    titleMonthlyInvest: (amt, period) => `매월 ${amt}씩\n${period}\n모았다면?`,
    titleMonthlyShort:  (amt, period) => `매월 ${amt}씩\n${period} 모았다면?`,
    titleLumpInvest:    (amt, period) => `${period} 전\n${amt}을\n넣었다면?`,
    titleSports:        (a, b)        => `${a} vs ${b}\n누적 골\n레이스`,
    titleFallback:      '투자 비교',

    /* 콘텐츠 도구 — 풀 텍스트 */
    contentSubtitleInvest: (year, amt) => `${year}년부터 매월 ${amt} 투자 기준`,
    contentSubtitleSports: '누적 골 레이스',

    /* 라벨 / 단어 */
    vs:           'VS',
    win:          'WIN',
    principal:    '원금',
    goals:        (n) => `${n.toLocaleString()}골`,

    /* 버튼 / UI */
    ctaInvestment:'▶ 투자 결과 보기',
    ctaSports:    '▶ 골 레이스 시작',
    ctaRanking:   '▶ 레이스 시작',
    saveBtn:      '🎬 그래프 녹화',
    saveBusy:     '영상 생성중...',
    copyBtn:      '복사',
    copyDone:     '복사됨',

    /* 콘텐츠 도구 카드 라벨 */
    labelTools:    '콘텐츠 도구',
    labelTitle:    '추천 제목',
    labelSubtitle: '부제목',
    labelHashtag:  '해시태그',
    labelSave:     '영상 저장',

    /* 빈 상태 (sports preparing) */
    emptyTitle:  '데이터 준비중',
    emptyDesc:   '실제 경기 데이터를\n수집 중입니다',
    emptyStatus: '준비중...',

    /* 해시태그 기본 (모드별) */
    baseTags: {
      investment: ['#투자', '#재테크', '#적립식투자', '#장기투자'],
      sports:     ['#스포츠', '#기록', '#레전드'],
      ranking:    ['#랭킹', '#비교'],
    },
  },

  en: {
    titleMonthlyInvest: (amt, period) => `If You Invested\n${amt} Every Month\nFor ${period}`,
    titleMonthlyShort:  (amt, period) => `If You Invested\n${amt} for ${period}`,
    titleLumpInvest:    (amt, period) => `If You Invested\n${amt}\n${period} Ago`,
    titleSports:        (a, b)        => `${a} vs ${b}\nCumulative Goals\nRace`,
    titleFallback:      'Investment Race',

    contentSubtitleInvest: (year, amt) => `${amt} monthly DCA from ${year}`,
    contentSubtitleSports: 'Cumulative Goals Race',

    vs:           'VS',
    win:          'WIN',
    principal:    'PRINCIPAL',
    goals:        (n) => `${n.toLocaleString()} goals`,

    ctaInvestment:'▶ Watch Investment Race',
    ctaSports:    '▶ Start Goal Race',
    ctaRanking:   '▶ Start Race',
    saveBtn:      '🎬 Record Video',
    saveBusy:     'Generating...',
    copyBtn:      'Copy',
    copyDone:     'Copied',

    labelTools:    'Content Tools',
    labelTitle:    'Recommended Title',
    labelSubtitle: 'Subtitle',
    labelHashtag:  'Hashtags',
    labelSave:     'Save Video',

    emptyTitle:  'Data Preparing',
    emptyDesc:   'Collecting real\nmatch data',
    emptyStatus: 'PREPARING...',

    baseTags: {
      investment: ['#Investing', '#StockMarket', '#DCA', '#LongTermInvesting'],
      sports:     ['#Sports', '#Stats', '#Legend'],
      ranking:    ['#Ranking', '#Compare'],
    },
  },
};

const LANG_STORAGE_KEY = 'ir_lang';

function _currentLang() {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return (v === 'en') ? 'en' : 'ko';
  } catch { return 'ko'; }
}

function _setLang(lang) {
  if (lang !== 'ko' && lang !== 'en') return;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch {}
}

function _t(key) {
  const dict = I18N[_currentLang()] || I18N.ko;
  return dict[key];
}

/* applyLanguageToUI — Shorts 출력물(프레임/콘텐츠 도구)만 lang 반영.
   사이드바는 한국어 고정 (운영자용 UI).
   호출 시점: init() 1회 + 토글 클릭마다 + (필요 시) updateContentTools 내부에서 자동.
   하는 일:
     1) [data-i18n] 노드 텍스트 갱신 (function 값은 호출하지 않음 — 정적 라벨만)
     2) 토글 버튼 aria-selected 상태 갱신
     3) applyModeToUI() 재호출 → CTA / 모드 텍스트 lang 반영
     4) renderTitle() + render() + updateContentTools() 호출 → 제목/Y축/끝점/콘텐츠도구 갱신 */
function applyLanguageToUI() {
  const lang = _currentLang();
  const dict = I18N[lang] || I18N.ko;

  document.documentElement.lang = (lang === 'en') ? 'en' : 'ko';
  document.body.dataset.lang = lang;

  // 1) data-i18n 노드 — 정적 라벨만. function 값(title generator 등)은 건너뜀.
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (!key) return;
    const v = dict[key];
    if (typeof v !== 'string') return;
    if (el.dataset.i18nHtml === '1') el.innerHTML = v.replace(/\n/g, '<br>');
    else                              el.textContent = v;
  });

  // 2) 토글 버튼 active 상태
  document.querySelectorAll('.lang-toggle .lt-btn').forEach(btn => {
    const on = (btn.dataset.lang === lang);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  // 3) 모드 의존 텍스트 (CTA) 갱신
  try { applyModeToUI(); } catch {}

  // 4) 프레임/콘텐츠도구 재렌더 — 제목/Y축/끝점/태그 lang 반영
  try { renderTitle(); } catch {}
  try { render(); } catch {}
  try { updateContentTools(); } catch {}
}

/* 언어 토글 클릭 핸들러 — 위임 방식. DOM 준비 전 호출돼도 안전. */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.lang-toggle .lt-btn');
  if (!btn) return;
  const next = btn.dataset.lang;
  if (next !== 'ko' && next !== 'en') return;
  if (next === _currentLang()) return;
  _setLang(next);
  applyLanguageToUI();
});

/* 통화 포맷 — 한국어: formatMoney (만원/억 변환).
   영어: KRW 값을 1000 으로 나눠 USD 근사 (사용자 정책: 100만원 ≈ $1,000 / 1억 ≈ $100K).
   - amountFmtShort : Y축 / 끝점 라벨용 짧은 abbr ($1K / $100K / $1.2M)
   - amountFmtFull  : 제목/부제 같은 풀 텍스트용 ($1,000 / $100,000 / $1.2M) */
function _amountFmtShort(v) {
  if (_currentLang() === 'en') {
    const n = Math.round(v / 1000);
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (abs >= 1_000_000)     return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (abs >= 1_000)         return '$' + (n / 1_000).toFixed(1).replace(/\.?0+$/, '') + 'K';
    return '$' + n;
  }
  return formatMoney(v, RACE.unit);
}
function _amountFmtFull(v) {
  if (_currentLang() === 'en') {
    const n = Math.round(v / 1000);
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (abs >= 1_000_000)     return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    return '$' + n.toLocaleString();
  }
  return formatMoney(v, RACE.unit);
}

/* 기간 문자열 — lang 별:
   ko : "16년 4개월" / "10년"   (기존 fmtPeriodKr 기반)
   en : "16y 4m"   / "10 Years" */
function _fmtPeriodLang(startD, endD) {
  if (!startD || !endD) return '';
  const months = (endD.getFullYear() - startD.getFullYear()) * 12
               + (endD.getMonth() - startD.getMonth());
  if (_currentLang() === 'en') {
    if (months >= 12) {
      const y = Math.floor(months / 12);
      const m = months % 12;
      if (m === 0) return `${y} ${y === 1 ? 'Year' : 'Years'}`;
      return `${y}y ${m}m`;
    }
    return `${Math.max(1, months)}m`;
  }
  return fmtPeriodKr(startD, endD).replace(/간$/, '');
}

/* ─── 시리즈별 해시태그 사전 ───
   신규 종목 추가 시 여기 한 줄만 추가하면 자동 반영 — 함수 수정 불필요.
   각 시리즈마다 핵심 단어 1~3개 권장 (최종 8개 cap). */
const SERIES_TAGS = {
  // 지수
  sp500:             ['#SP500',   '#미국주식', '#ETF투자'],
  nasdaq:            ['#나스닥',   '#NASDAQ',   '#미국주식'],
  kospi:             ['#코스피',   '#국내주식', '#KOSPI'],

  // 미국 주식
  tsla:              ['#테슬라',   '#TSLA',     '#미국주식'],
  nvda:              ['#엔비디아', '#NVDA',     '#AI주식', '#미국주식'],
  aapl:              ['#애플',     '#AAPL',     '#미국주식'],
  msft:              ['#마이크로소프트', '#MSFT', '#미국주식'],
  amzn:              ['#아마존',   '#AMZN',     '#미국주식'],
  googl:             ['#구글',     '#알파벳',   '#GOOGL'],
  meta:              ['#메타',     '#META',     '#페이스북'],
  avgo:              ['#브로드컴', '#AVGO',     '#반도체'],
  brk_b:             ['#버크셔',   '#BRK',      '#가치투자'],
  jpm:               ['#JP모건',   '#JPM',      '#금융주'],
  nflx:              ['#넷플릭스', '#NFLX'],
  pltr:              ['#팔란티어', '#PLTR',     '#AI주식'],
  amd:               ['#AMD',     '#반도체',    '#미국주식'],
  orcl:              ['#오라클',   '#ORCL',     '#클라우드'],
  cost:              ['#코스트코', '#COST',     '#소비재'],
  wmt:               ['#월마트',   '#WMT',      '#소비재'],
  ko:                ['#코카콜라', '#KO',       '#배당주'],
  mcd:               ['#맥도날드', '#MCD',      '#소비재'],
  visa:              ['#비자',     '#VISA',     '#결제'],
  mastercard:        ['#마스터카드','#MA',      '#결제'],

  // 한국 주식
  samsung:           ['#삼성전자', '#삼성',     '#국내주식'],
  skhynix:           ['#SK하이닉스', '#반도체', '#국내주식'],
  lges:              ['#LG에너지솔루션', '#2차전지', '#국내주식'],
  sbiologics:        ['#삼성바이오로직스', '#바이오'],
  hyundai:           ['#현대차',   '#자동차',   '#국내주식'],
  kia:               ['#기아',     '#자동차',   '#국내주식'],
  celltrion:         ['#셀트리온', '#바이오'],
  kbfin:             ['#KB금융',   '#금융주'],
  naver:             ['#네이버',   '#NAVER',    '#국내주식'],
  hanwhaaero:        ['#한화에어로스페이스', '#방산'],
  kakao:             ['#카카오',   '#kakao',    '#국내주식'],
  doosanener:        ['#두산에너빌리티', '#원전'],
  hdhi:              ['#HD현대중공업', '#조선'],
  posco:             ['#POSCO',   '#철강'],
  krafton:           ['#크래프톤', '#게임주'],

  // ETF
  qqq:               ['#QQQ',     '#나스닥ETF', '#미국ETF'],
  voo:               ['#VOO',     '#SP500ETF', '#미국ETF'],
  vti:               ['#VTI',     '#미국전체ETF', '#장기투자'],
  schd:              ['#SCHD',    '#배당ETF',  '#미국ETF'],
  soxx:              ['#SOXX',    '#반도체ETF'],
  smh:               ['#SMH',     '#반도체ETF'],
  soxl:              ['#SOXL',    '#반도체3배', '#레버리지'],
  tqqq:              ['#TQQQ',    '#나스닥3배', '#레버리지'],
  upro:              ['#UPRO',    '#SP500_3배', '#레버리지'],
  jepi:              ['#JEPI',    '#월배당ETF'],
  jepq:              ['#JEPQ',    '#월배당ETF'],

  // 암호화폐
  bitcoin:           ['#비트코인', '#BTC',      '#암호화폐'],
  btc:               ['#비트코인', '#BTC',      '#암호화폐'],
  eth:               ['#이더리움', '#ETH',      '#암호화폐'],
  sol:               ['#솔라나',   '#SOL',      '#암호화폐'],
  xrp:               ['#리플',     '#XRP',      '#암호화폐'],
  doge:              ['#도지코인', '#DOGE',     '#밈코인'],
  bnb:               ['#BNB',     '#바이낸스',  '#암호화폐'],
  ada:               ['#에이다',   '#ADA',      '#암호화폐'],
  link:              ['#체인링크', '#LINK',     '#암호화폐'],
  sui:               ['#수이',     '#SUI',      '#암호화폐'],
  avax:              ['#아발란체', '#AVAX',     '#암호화폐'],

  // 원자재
  gold:              ['#금투자',   '#골드',     '#안전자산'],
  silver:            ['#은',       '#실버',     '#안전자산'],
  copper:            ['#구리',     '#원자재'],
  oil:               ['#원유',     '#오일',     '#원자재'],
  gas:               ['#천연가스', '#가스',     '#원자재'],

  // 카드 / 스포츠
  pokemon_charizard: ['#포켓몬카드', '#리자몽', '#PSA10'],
  ronaldo:           ['#호날두',   '#CR7',      '#축구'],
  messi:             ['#메시',     '#MESSI',    '#축구'],
};

/* 영어 해시태그 사전 — EN 모드에서 사용. SERIES_TAGS 와 같은 키 구조. */
const SERIES_TAGS_EN = {
  sp500:   ['#SP500', '#USStocks', '#ETFInvesting'],
  nasdaq:  ['#NASDAQ', '#USStocks', '#TechStocks'],
  kospi:   ['#KOSPI', '#KoreaStocks'],
  tsla:    ['#Tesla', '#TSLA', '#USStocks'],
  nvda:    ['#NVIDIA', '#NVDA', '#AIStocks', '#USStocks'],
  aapl:    ['#Apple', '#AAPL', '#USStocks'],
  msft:    ['#Microsoft', '#MSFT', '#USStocks'],
  amzn:    ['#Amazon', '#AMZN', '#USStocks'],
  googl:   ['#Google', '#Alphabet', '#GOOGL'],
  meta:    ['#Meta', '#META', '#Facebook'],
  avgo:    ['#Broadcom', '#AVGO', '#Semiconductors'],
  brk_b:   ['#Berkshire', '#BRK', '#ValueInvesting'],
  jpm:     ['#JPMorgan', '#JPM', '#FinancialStocks'],
  nflx:    ['#Netflix', '#NFLX'],
  pltr:    ['#Palantir', '#PLTR', '#AIStocks'],
  amd:     ['#AMD', '#Semiconductors', '#USStocks'],
  orcl:    ['#Oracle', '#ORCL', '#Cloud'],
  cost:    ['#Costco', '#COST'],
  wmt:     ['#Walmart', '#WMT'],
  ko:      ['#CocaCola', '#KO', '#Dividend'],
  mcd:     ['#McDonalds', '#MCD'],
  visa:    ['#Visa', '#VISA', '#Payments'],
  mastercard: ['#Mastercard', '#MA', '#Payments'],
  samsung: ['#Samsung', '#SamsungElectronics', '#KoreaStocks'],
  skhynix: ['#SKHynix', '#Semiconductors'],
  naver:   ['#NAVER', '#KoreaStocks'],
  kakao:   ['#Kakao', '#KoreaStocks'],
  qqq:     ['#QQQ', '#NasdaqETF', '#USEtf'],
  voo:     ['#VOO', '#SP500ETF', '#USEtf'],
  vti:     ['#VTI', '#TotalMarket', '#LongTermInvesting'],
  schd:    ['#SCHD', '#DividendETF', '#USEtf'],
  soxx:    ['#SOXX', '#SemiconductorETF'],
  smh:     ['#SMH', '#SemiconductorETF'],
  soxl:    ['#SOXL', '#Leveraged', '#3xLong'],
  tqqq:    ['#TQQQ', '#NasdaqLeveraged', '#3xLong'],
  upro:    ['#UPRO', '#SP500Leveraged'],
  jepi:    ['#JEPI', '#MonthlyIncome'],
  jepq:    ['#JEPQ', '#MonthlyIncome'],
  bitcoin: ['#Bitcoin', '#BTC', '#Crypto'],
  btc:     ['#Bitcoin', '#BTC', '#Crypto'],
  eth:     ['#Ethereum', '#ETH', '#Crypto'],
  sol:     ['#Solana', '#SOL', '#Crypto'],
  xrp:     ['#Ripple', '#XRP', '#Crypto'],
  doge:    ['#Dogecoin', '#DOGE', '#MemeCoin'],
  bnb:     ['#BNB', '#Binance', '#Crypto'],
  ada:     ['#Cardano', '#ADA', '#Crypto'],
  link:    ['#Chainlink', '#LINK', '#Crypto'],
  sui:     ['#SUI', '#Crypto'],
  avax:    ['#Avalanche', '#AVAX', '#Crypto'],
  gold:    ['#Gold', '#SafeHaven'],
  silver:  ['#Silver', '#SafeHaven'],
  copper:  ['#Copper', '#Commodities'],
  oil:     ['#Oil', '#Crude', '#Commodities'],
  gas:     ['#NaturalGas', '#Commodities'],
  pokemon_charizard: ['#PokemonCards', '#Charizard', '#PSA10'],
  ronaldo: ['#Ronaldo', '#CR7', '#Football'],
  messi:   ['#Messi', '#MESSI', '#Football'],
};

/* 모드별 기본 태그 — 시리즈 무관한 공통 키워드. _buildHashtags 가 lang 별로 선택. */
const BASE_TAGS_BY_MODE = {
  investment: ['#투자', '#재테크', '#적립식투자', '#장기투자'],
  sports:     ['#스포츠', '#기록', '#레전드'],
  ranking:    ['#랭킹', '#비교'],
};

const HASHTAGS_MAX = 8;

function _buildHashtags() {
  const mode = getCurrentMode();
  const lang = _currentLang();
  const tags = [];
  const seen = new Set();
  const push = (t) => {
    const norm = t.startsWith('#') ? t : `#${t}`;
    if (!seen.has(norm)) { seen.add(norm); tags.push(norm); }
  };

  // 1) 모드 기본 태그 — lang 별 (I18N.<lang>.baseTags)
  const baseDict = (I18N[lang] || I18N.ko).baseTags;
  const base = baseDict[mode] || baseDict.investment;
  base.slice(0, 2).forEach(push);

  // 2) 시리즈별 사전 태그 — lang 별 (SERIES_TAGS_EN 우선, 없으면 한국어 fallback)
  const seriesDict = lang === 'en' ? SERIES_TAGS_EN : SERIES_TAGS;
  for (const s of RACE.series) {
    const presets = seriesDict[s.symbol] || (lang === 'en' && SERIES_TAGS[s.symbol]);
    if (presets) {
      presets.forEach(push);
    } else if (s.name) {
      // 사전에 없으면 시리즈명을 안전 변환해 태그로
      const safe = s.name.replace(/\s+/g, '').replace(/[^\w가-힣]/g, '');
      if (safe) push('#' + safe);
    }
  }

  // 3) 남은 기본 태그로 채움 (8개 cap 까지)
  base.slice(2).forEach(push);

  return tags.slice(0, HASHTAGS_MAX).join(' ');
}

/* ─── 콘텐츠 도구 — 추천 제목 / 부제목 ─── */

// 시리즈 2개 이상이면 "A VS B" 라인 생성 (대문자 VS)
function _vsLine() {
  const names = RACE.series.map(s => s.name).filter(Boolean);
  return names.length >= 2 ? names.join(' VS ') : '';
}

/* 콘텐츠 도구의 추천 제목 — 후크 카피 + 빈 줄 + VS 라인 (유튜브 업로드용 풀버전).
   getDisplayTitle() 은 화면 프레임용 (간결) — 콘텐츠 도구에선 풀 텍스트. */
function getContentTitle() {
  const hook  = getDisplayTitle();
  const vs    = _vsLine();
  if (vs)   return `${hook}\n\n${vs}`;
  return hook;
}

/* 콘텐츠 도구의 부제목 — 모드별 자동, lang-aware.
   ko 투자: "2016년부터 매월 100만원 투자 기준"
   en 투자: "$1,000 monthly DCA from 2016"
   sports: I18N 의 contentSubtitleSports */
function getContentSubtitle() {
  const mode = getCurrentMode();
  const dict = I18N[_currentLang()] || I18N.ko;
  if (mode === 'sports') {
    return dict.contentSubtitleSports;
  }
  if (INVESTMENT.enabled && INVESTMENT.amount > 0) {
    const startD = parseDate(INVESTMENT.startDate);
    const amt    = _amountFmtFull(INVESTMENT.amount);
    const year   = startD ? startD.getFullYear() : '';
    return year ? dict.contentSubtitleInvest(year, amt) : '';
  }
  return '';
}

function updateContentTools() {
  if (ctTitlePreviewEl)    ctTitlePreviewEl.textContent    = getContentTitle();
  if (ctSubtitlePreviewEl) ctSubtitlePreviewEl.textContent = getContentSubtitle();
  if (ctHashtagsEl)        ctHashtagsEl.textContent        = _buildHashtags();
}

/* ─── 영상 저장 (MediaRecorder) ───
   - 캔버스(차트)만 캡처. HTML 오버레이(아이콘/제목) 는 별도 라이브러리 필요해 제외.
   - iOS Safari 는 captureStream 미지원 → 화면 녹화 안내로 폴백.
   - 카운트다운 3-2-1 후 reset + play, X_MAX 기준 자동 stop. */
function _canRecordCanvas() {
  // 필요한 API 가 모두 있어야 가능
  const c = chartDom && chartDom.querySelector ? chartDom.querySelector('canvas') : null;
  return !!(
    c &&
    typeof c.captureStream === 'function' &&
    typeof window.MediaRecorder !== 'undefined'
  );
}

function _isIOSSafari() {
  const ua = navigator.userAgent;
  // iPad 가 iPadOS 13+ 에서 데스크탑 모드 UA 를 쓰는 케이스까지 커버:
  // Mac UA + 터치 지원 = iPad 로 간주. (navigator.platform 은 deprecated 이라 사용 안함)
  const isIOS    = /iPad|iPhone|iPod/.test(ua) ||
                   (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|Chrome/.test(ua);
  return isIOS && isSafari;
}

/* ─── 진행률 토스트 (영상 변환 / 로딩 표시) ─── */
function _ensureProgressToast() {
  let el = document.getElementById('videoProgressToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'videoProgressToast';
    el.className = 'video-toast';
    el.innerHTML = `<span class="vt-spinner"></span><span class="vt-label"></span>`;
    document.body.appendChild(el);
  }
  return el;
}
function _showProgress(label) {
  const el = _ensureProgressToast();
  el.querySelector('.vt-label').textContent = label;
  el.classList.add('show');
}
function _hideProgress() {
  const el = document.getElementById('videoProgressToast');
  if (el) el.classList.remove('show');
}

/* ─── ffmpeg.wasm 지연 로드 (단일 스레드 core — GH Pages COOP/COEP 불필요) ─── */
let _ffmpegInstance = null;
let _ffmpegLoaded   = false;    // 로드 완료 플래그 — 사용자/UI 가 확인
let _ffmpegLoading  = false;    // 진행중 플래그 (중복 시작 방지)
let _ffmpegError    = null;     // 실패 사유 — UI 에 노출

/* 상태 변경 시 UI 동기화 */
function _setFFmpegStatus(state, message) {
  const chip = document.getElementById('ffmpegStatus');
  if (!chip) return;
  chip.dataset.state = state;
  const label = chip.querySelector('.ffs-label');
  if (label) label.textContent = message;
}

/* 페이지 idle 상태에 ffmpeg 백그라운드 프리로드 → 첫 저장 클릭 시 즉시 변환. */
function _preloadFFmpegInIdle() {
  if (_ffmpegLoaded || _ffmpegLoading) return;

  const start = () => {
    // _getFFmpeg 안에서 이미 console.error + status 업데이트 처리됨 — 여기선 무시
    _getFFmpeg().catch(() => {});
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(start, { timeout: 5000 });
  } else {
    setTimeout(start, 3000);
  }
}

function _loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) {
      console.log('[ffmpeg]   ↳ 이미 로드됨:', src);
      return resolve();
    }
    console.log('[ffmpeg] script 로드 시작:', src);
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload  = () => {
      console.log('[ffmpeg]   ↳ 로드 성공:', src);
      resolve();
    };
    tag.onerror = (e) => {
      console.error('[ffmpeg]   ↳ 로드 실패:', src, e);
      reject(new Error('스크립트 로드 실패: ' + src));
    };
    document.head.appendChild(tag);
  });
}

async function _getFFmpeg() {
  if (_ffmpegInstance) return _ffmpegInstance;
  if (_ffmpegLoading) {
    // 이미 로드 진행중 — 완료까지 폴링
    while (_ffmpegLoading) await new Promise(r => setTimeout(r, 200));
    if (_ffmpegInstance) return _ffmpegInstance;
    throw new Error(_ffmpegError || 'FFmpeg 로드 실패');
  }

  _ffmpegLoading = true;
  _ffmpegError   = null;
  _setFFmpegStatus('loading', '영상 엔진 로딩중...');
  console.group('[ffmpeg] 초기화 시작');
  console.log('UA:', navigator.userAgent);
  console.log('MediaRecorder vp9:', typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'));
  console.log('crossOriginIsolated:', !!window.crossOriginIsolated);
  console.log('SharedArrayBuffer:', typeof SharedArrayBuffer !== 'undefined');

  try {
    // 1) UMD 스크립트 로드
    await _loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/umd/ffmpeg.js');
    await _loadScript('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js');

    console.log('window.FFmpegWASM:', window.FFmpegWASM);
    console.log('window.FFmpegUtil:', window.FFmpegUtil);

    if (!window.FFmpegWASM || !window.FFmpegWASM.FFmpeg) {
      throw new Error('FFmpegWASM 전역이 비어 있음 (UMD 로드 실패 또는 CDN 응답 이상)');
    }
    if (!window.FFmpegUtil || !window.FFmpegUtil.toBlobURL) {
      throw new Error('FFmpegUtil 전역이 비어 있음');
    }

    const { FFmpeg } = window.FFmpegWASM;
    const { toBlobURL } = window.FFmpegUtil;
    const ff = new FFmpeg();

    ff.on('progress', ({ progress }) => {
      if (progress > 0 && progress <= 1) {
        _showProgress(`영상 변환중... ${Math.round(progress * 100)}%`);
      }
    });
    // ffmpeg 내부 verbose 로그는 일부러 구독하지 않음. 필요해지면 ff.on('log', (e)=>console.log(e.message))

    /* 핵심 수정: 워커가 외부 CDN 을 직접 fetch 하면 일부 환경에서 CORS / MIME
       오류로 init 실패. toBlobURL 로 미리 받아 blob URL 로 전달하면 안전. */
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    console.log('[ffmpeg] core 다운로드 시작 (toBlobURL):', baseURL);
    _setFFmpegStatus('loading', '엔진 다운로드 중...');

    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`,   'text/javascript');
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');
    console.log('[ffmpeg]   ↳ coreURL (blob):', coreURL);
    console.log('[ffmpeg]   ↳ wasmURL (blob):', wasmURL);

    _setFFmpegStatus('loading', '엔진 초기화중...');
    await ff.load({ coreURL, wasmURL });

    _ffmpegInstance = ff;
    _ffmpegLoaded   = true;
    _setFFmpegStatus('ready', 'MP4 준비완료');
    console.log('[ffmpeg] ✓ 초기화 완료');
    console.groupEnd();
    return ff;
  } catch (err) {
    _ffmpegError = err.message || String(err);
    _ffmpegLoaded = false;
    _setFFmpegStatus('error', '엔진 로딩 실패 (탭하면 다시 시도)');
    console.error('[ffmpeg] ✗ 초기화 실패:', err);
    console.groupEnd();
    throw err;
  } finally {
    _ffmpegLoading = false;
  }
}

/* webm Blob → mp4 Blob (H.264, yuv420p — Mac Finder / iOS / 카톡 호환) */
async function _convertWebmToMp4(webmBlob) {
  const ff = await _getFFmpeg();
  const { fetchFile } = window.FFmpegUtil;
  _showProgress('영상 변환중...');
  await ff.writeFile('in.webm', await fetchFile(webmBlob));
  // -pix_fmt yuv420p : QuickTime/Safari 재생용. -movflags +faststart : 점진적 재생 가능
  await ff.exec([
    '-i', 'in.webm',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    'out.mp4'
  ]);
  const data = await ff.readFile('out.mp4');
  const buf  = data.buffer || data;
  return new Blob([buf], { type: 'video/mp4' });
}

function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 500);
}

/* 파일명: investment-race-YYYY-MM-DD.mp4 */
function _videoFilename(ext) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `investment-race-${ymd}.${ext}`;
}

async function saveVideo() {
  /* ── 진단 콘솔 (요청 사항) ─────────────────────────────── */
  console.group('[saveVideo] 시작 — 환경 진단');
  console.log('UA:', navigator.userAgent);
  console.log('MediaRecorder vp9:',
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9'));
  console.log('_ffmpegLoaded   :', _ffmpegLoaded);
  console.log('_ffmpegLoading  :', _ffmpegLoading);
  console.log('_ffmpegInstance :', !!_ffmpegInstance);
  console.log('_ffmpegError    :', _ffmpegError);
  console.log('window.FFmpegWASM:', window.FFmpegWASM);
  console.log('window.FFmpegUtil:', window.FFmpegUtil);
  console.groupEnd();

  if (!_canRecordCanvas() || _isIOSSafari()) {
    if (saveVideoHintEl) {
      saveVideoHintEl.className = 'ct-hint warn';
      saveVideoHintEl.textContent =
        '이 브라우저는 자동 녹화를 지원하지 않습니다. iOS 는 [제어센터 → 화면 녹화] 로 직접 녹화해주세요.';
    }
    alert(
      '🎬 이 환경에선 자동 녹화 미지원\n\n' +
      'iPhone Safari: 제어센터 > 화면 녹화 사용\n' +
      'PC Chrome / Firefox: 자동 녹화 지원'
    );
    return;
  }

  /* ⛔ FFmpeg 미로딩 시 webm 폴백 대신 대기/재시도 — 원인을 보이게.
     - 로딩중이면 안내 후 종료 (사용자가 잠시 후 다시 클릭)
     - 미시작이면 즉시 시작
     - 이전 실패면 재시도 */
  if (!_ffmpegLoaded) {
    if (_ffmpegLoading) {
      alert('🟡 영상 엔진이 아직 준비중입니다.\n잠시 후 다시 눌러주세요.');
      return;
    }
    _showProgress('영상 엔진 로딩중...');
    try {
      await _getFFmpeg();
      _hideProgress();
    } catch (err) {
      _hideProgress();
      console.error('[saveVideo] ffmpeg 로드 실패 — 저장 중단:', err);
      alert(
        '❌ 영상 엔진(ffmpeg.wasm) 로딩 실패\n\n' +
        '오류: ' + (err?.message || err) + '\n\n' +
        '브라우저 콘솔의 [ffmpeg] 로그를 확인해주세요.\n' +
        '(네트워크 차단 / CDN 응답 이상이 가장 흔한 원인)'
      );
      return;
    }
  }

  const canvas = chartDom.querySelector('canvas');
  if (!canvas) { alert('차트 캔버스가 아직 준비되지 않았습니다.'); return; }
  if (X_MAX === 0) { alert('데이터가 비어 있습니다.'); return; }

  /* 중복클릭 방지 — 버튼 비활성 + 인라인 스피너 + 라벨 변경.
     녹화 중 사용자가 연타하면 MediaRecorder 가 여러개 생성돼 메모리 폭주 가능. */
  const origBtnHtml = saveVideoBtn ? saveVideoBtn.innerHTML : '';
  if (saveVideoBtn) {
    saveVideoBtn.disabled = true;
    const busyLabel = (I18N[_currentLang()] || I18N.ko).saveBusy || '영상 생성중...';
    saveVideoBtn.innerHTML = '<span class="vt-spinner"></span><span>' + busyLabel + '</span>';
  }

  try {
    // 1) 카운트다운 3-2-1
    const overlay = document.createElement('div');
    overlay.className = 'video-countdown';
    overlay.textContent = '3';
    document.body.appendChild(overlay);
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    for (const n of ['3', '2', '1']) {
      overlay.textContent = n;
      await wait(700);
    }
    overlay.remove();

    // 2) MediaRecorder 로 webm 녹화
    const stream = canvas.captureStream(30);
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    const recordingDone = new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    recorder.start();
    reset();
    setTimeout(play, 50);

    // 3) finished 감지 후 stop (도착 글로우 1초 캡처 포함)
    await new Promise((resolveTick) => {
      const POLL = 200;
      const startAt = performance.now();
      const maxWait = (DURATION_SECONDS + 4) * 1000;
      const tickStop = () => {
        if (finishedAt !== null) {
          setTimeout(() => {
            try { recorder.stop(); } catch {}
            resolveTick();
          }, 1000);
          return;
        }
        if (performance.now() - startAt > maxWait) {
          try { recorder.stop(); } catch {}
          resolveTick();
          return;
        }
        setTimeout(tickStop, POLL);
      };
      setTimeout(tickStop, POLL);
    });

    const webmBlob = await recordingDone;

    // 4) ffmpeg.wasm 로 mp4 변환 — 여기까지 왔다는 건 _ffmpegLoaded === true
    //    그래도 exec/writeFile 단계에서 실패할 수 있으므로 catch 에 실제 오류 노출.
    let outBlob, outExt;
    try {
      outBlob = await _convertWebmToMp4(webmBlob);
      outExt  = 'mp4';
    } catch (convErr) {
      console.error('[saveVideo] mp4 변환 단계 오류:', convErr);
      const useFallback = confirm(
        '❌ mp4 변환 실패\n\n' +
        '오류: ' + (convErr?.message || convErr) + '\n\n' +
        '대신 webm 으로 저장할까요? (취소 = 저장 안함)\n' +
        '* webm 도 CapCut/iMovie 가져오기 가능'
      );
      if (!useFallback) return;
      outBlob = webmBlob;
      outExt  = 'webm';
    }

    _triggerDownload(outBlob, _videoFilename(outExt));
  } catch (err) {
    console.error('saveVideo 오류:', err);
    alert('영상 저장 중 오류: ' + (err?.message || err));
  } finally {
    _hideProgress();
    if (saveVideoBtn) {
      saveVideoBtn.disabled = false;
      saveVideoBtn.innerHTML = origBtnHtml;
    }
  }
}

if (saveVideoBtn) saveVideoBtn.addEventListener('click', saveVideo);

/* 상태 칩 클릭 — error 상태일 때만 ffmpeg 재시도 */
const ffmpegStatusEl = document.getElementById('ffmpegStatus');
if (ffmpegStatusEl) ffmpegStatusEl.addEventListener('click', () => {
  if (ffmpegStatusEl.dataset.state !== 'error') return;
  _ffmpegInstance = null;
  _ffmpegLoaded   = false;
  _ffmpegError    = null;
  _getFFmpeg().catch(() => {});   // 상태/콘솔은 _getFFmpeg 내부에서 갱신
});

/* 콘텐츠 도구 자동 새로고침 — render() 호출 시 패널이 열려있으면 갱신 */
const _origRender_forCT = render;
window.render = render = function() {
  _origRender_forCT.apply(this, arguments);
  if (contentToolsEl && !contentToolsEl.classList.contains('collapsed')) {
    updateContentTools();
  }
};

async function init() {
  populateForm();
  bindLiveInputs();

  /* 새 아키텍처: manifest + per-ticker CSV 자동 로드.
     db/ 폴더에 csv 가 있으면 (정적 호스팅이든 server.py 든) 즉시 적용. */
  await loadManifest();
  await loadSeriesData();
  _refreshSeriesColors();  // 브랜드 컬러 자동 적용 (SERIES_META + 로고 추출)
  syncTitleFromSeries();   // 초기 제목도 series 이름 기반 자동 설정
  renderSeriesRows();
  renderPresets();         // 인기 비교 주제 카드

  // 콘솔 진단
  const tickerCount = Object.keys(MANIFEST.tickers || {}).length;
  if (tickerCount > 0) {
    console.log(
      `%c📦 manifest 로드`,
      'color:#FFD54F;font-weight:700',
      `— ${tickerCount}개 종목 사용 가능`
    );
  } else {
    console.warn(
      '📦 manifest 비어 있음 — db/manifest.json 이 있는지 확인. (GH Pages 면 저장소에 db/ 가 커밋되었는지)'
    );
  }
  const missing = getMissingSeries();
  if (missing.length) {
    console.warn(`⚠️ 다음 종목 데이터 없음: ${missing.join(', ')} — DB 페이지에서 다운로드하세요.`);
  }

  refreshDisplaySeries();
  renderTitle();
  render();

  // 영문 모드 라벨/태그/CTA/Y축 1회 동기화 (localStorage 에 ir_lang='en' 이면 즉시 영문화)
  applyLanguageToUI();

  /* 페이지가 idle 상태가 되면 ffmpeg.wasm 백그라운드 프리로드.
     영상 저장 첫 클릭 시 "다운로드/변환" 대기 줄이는 효과.
     PC + 지원 환경에서만 — iOS Safari 면 어차피 미사용. */
  if (!_isIOSSafari() && _canRecordCanvas()) {
    _preloadFFmpegInIdle();
  }
}

init();

/* ── 데이터 준비중 모달 닫기 핸들러 ── */
['dataPrepClose', 'dataPrepOk'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', () => {
    const dlg = document.getElementById('dataPrepModal');
    if (dlg && typeof dlg.close === 'function') dlg.close();
  });
});
