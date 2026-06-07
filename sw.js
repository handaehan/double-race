/* =============================================================
   sw.js — Service Worker (스텁: 향후 PWA 오프라인 캐싱용)
   =============================================================

   📌 현재 상태: 활성화되어 있지 않습니다.
      - 이 파일이 존재하지만 index.html / script.js 어디서도 register 하지 않음.
      - 즉 평소엔 평범한 정적 사이트로 동작 (SW 없음).

   📌 활성화 방법 (향후 시점, 준비되면):
      index.html 끝쪽 또는 script.js init 직후에 다음 추가 →
        if ('serviceWorker' in navigator && location.protocol === 'https:') {
          navigator.serviceWorker.register('./sw.js').catch(console.warn);
        }

   📌 활성화 시 효과:
      - db/manifest.json + db/*.csv 가 클라이언트에 캐시됨
      - 두 번째 방문부터 오프라인에서도 그래프 그릴 수 있음
      - 아이폰 홈화면 추가 후 비행기 모드에서도 동작

   📌 캐싱 정책 초안 (참고용):
      - 정적 셸 (index.html, style.css, script.js, manifest.webmanifest, icons/*)
        → cache-first
      - 데이터 (db/*.csv, db/manifest.json)
        → stale-while-revalidate (오래된 캐시도 일단 보여주고 백그라운드 업데이트)
      - 외부 (jsdelivr.net 폰트/echarts)
        → cache-first (장기 보존)

   👉 본격 구현 전엔 이 파일을 그대로 두면 됨. fetch 핸들러 없으므로
      register 해도 아무 일 안 일어남 (no-op).
   ============================================================= */

const CACHE_VERSION = 'investment-race-v0';

self.addEventListener('install', (event) => {
  // 즉시 활성화 (구버전 SW 가 있어도 대기하지 않음)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // 모든 열린 탭 즉시 제어 (캐싱 정책 활성화 시 의미 있음)
  event.waitUntil(self.clients.claim());
});

/* fetch 핸들러는 일부러 비워둠 — 캐싱 정책 확정 후 추가 예정.
   여기 핸들러가 없으면 SW 가 등록돼 있어도 기본 네트워크 동작 그대로 진행. */
// self.addEventListener('fetch', (event) => { ... });
