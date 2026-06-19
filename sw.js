const CACHE_NAME = 'health-diary-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
];

// 설치: 필수 리소스 캐싱
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch((err) => {
        // 일부 리소스 실패는 무시 (아이콘 등은 data URI)
        console.log('캐시 추가 실패:', err);
      });
    })
  );
  self.skipWaiting();
});

// 활성화: 이전 캐시 정리
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.map((name) => {
          if (name !== CACHE_NAME) return caches.delete(name);
        })
      );
    })
  );
  self.clients.claim();
});

// 요청 처리: 캐시 우선, 실패 시 네트워크
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // 같은 도메인의 GET 요청만 처리
  if (url.origin !== location.origin || request.method !== 'GET') {
    return;
  }

  e.respondWith(
    caches.match(request).then((response) => {
      if (response) return response;
      return fetch(request)
        .then((res) => {
          // 성공한 응답만 캐싱
          if (!res || res.status !== 200 || res.type === 'error') {
            return res;
          }
          const cloned = res.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, cloned);
          });
          return res;
        })
        .catch(() => {
          // 오프라인 + 캐시 없음: 간단한 오프라인 페이지 반환
          return caches.match('./index.html').then((res) => res || new Response('오프라인 상태입니다.'));
        });
    })
  );
});
