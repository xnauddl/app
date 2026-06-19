import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// playwright 를 로컬 → 전역 순서로 찾는다
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright/index.js')); }
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const url = 'file://' + path.join(__dirname, 'index.html');

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(url);
// 깨끗한 상태에서 시작
await page.evaluate(() => localStorage.clear());
await page.reload();

// 고정 시점으로 달력을 6월에 맞춤(오늘 날짜와 무관하게 테스트)
// 달력 제목 확인
const title = await page.textContent('#cal-title');
check('달력 기본 화면 렌더', !!title && title.includes('년'), title);

// 달력 그리드에 날짜 셀 존재
const cellCount = await page.locator('.cal-cell[data-date]').count();
check('달력에 날짜 셀 생성', cellCount >= 28, `${cellCount}개 셀`);

// ---- 특정 날짜(2026-06-03) 셀을 직접 열기 위해 평가로 모달 오픈 ----
async function openDay(iso) {
  await page.evaluate((d) => window.openDayModal(d), iso);
  await page.waitForSelector('#day-modal:not([hidden])');
}

// 1) 몸무게 입력 테스트
await openDay('2026-06-03');
await page.fill('#day-weight', '58.4');
await page.dispatchEvent('#day-weight', 'change');
const w = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).weights['2026-06-03']);
check('몸무게 저장', w === 58.4, `저장값=${w}`);

// 2) 식사 체크 + 메모
await page.click('.meal-box[data-dmeal="breakfast"] .slider');
await page.fill('[data-dtext="lunch"]', '김치찌개');
const meals = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).meals['2026-06-03']);
check('아침 체크 저장', meals.breakfast.eaten === true);
check('점심 메모 입력 시 자동 체크', meals.lunch.eaten === true && meals.lunch.text === '김치찌개');

// 3) 부부관계 토글
await page.click('#day-rel-toggle');
let rel = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).relations['2026-06-03']);
check('부부관계 기록 ON', rel === true);
await page.click('#day-rel-toggle');
rel = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).relations['2026-06-03']);
check('부부관계 기록 OFF(토글)', rel === undefined);
await page.click('#day-rel-toggle'); // 다시 ON으로 두고 표시 확인

// 모달 닫기
await page.click('#day-modal-close');

// 달력 셀에 몸무게/식사점/하트 표시되는지
const cellHtml = await page.locator('.cal-cell[data-date="2026-06-03"]').innerHTML();
check('달력 셀에 몸무게 표시', cellHtml.includes('58.4'));
check('달력 셀에 식사 점 표시', cellHtml.includes('cal-meals') && cellHtml.includes('md on'));
check('달력 셀에 부부관계 하트 표시', cellHtml.includes('cal-heart'));

// 4) 월경 시작일 기록 → 주기 예측 검증
// 6/1 을 월경 시작일로 기록, 주기 28 → 다음예정 6/29, 배란 6/15, 가임 6/10~6/18
await openDay('2026-06-01');
await page.click('#day-period-toggle');
await page.click('#day-modal-close');

const predictText = await page.textContent('#cycle-predict');
check('다음 월경 예정일 = 6월 29일', predictText.includes('6월 29일'), );
check('배란일 = 6월 15일', predictText.includes('6월 15일'));
check('가임기 = 6월 10일 ~ 6월 18일', predictText.includes('6월 10일') && predictText.includes('6월 18일'));

// 배란일 셀이 ovulation 클래스인지
const ovClass = await page.getAttribute('.cal-cell[data-date="2026-06-15"]', 'class');
check('6/15 셀이 배란일(ovulation) 표시', ovClass.includes('ovulation'), ovClass);
const periodClass = await page.getAttribute('.cal-cell[data-date="2026-06-01"]', 'class');
check('6/1 셀이 월경(period) 표시', periodClass.includes('period'), periodClass);
const fertileClass = await page.getAttribute('.cal-cell[data-date="2026-06-11"]', 'class');
check('6/11 셀이 가임기(fertile) 표시', fertileClass.includes('fertile'), fertileClass);

// 5) 추이 탭: 차트/통계 렌더
await page.click('.tab[data-tab="trends"]');
await page.waitForSelector('#tab-trends.active');
const statsText = await page.textContent('#weight-stats');
check('추이 탭 통계 표시', statsText.includes('58.4'), statsText.replace(/\s+/g,' ').trim());
const chartHtml = await page.locator('#weight-chart').innerHTML();
check('몸무게 차트 렌더(polyline)', chartHtml.includes('polyline') || chartHtml.includes('circle'));
const mealsListText = await page.textContent('#meals-list');
check('식사 기록 목록 표시', mealsListText.includes('김치찌개'));

// 6) 평균 주기 자동 계산: 6/29 도 시작일로 추가하면 평균 28 유지
await page.click('.tab[data-tab="calendar"]');
await openDay('2026-06-29');
await page.click('#day-period-toggle');
await page.click('#day-modal-close');
const cyc = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).settings.cycleLength);
check('월경 2회 기록 후 평균 주기 자동 계산(28)', cyc === 28, `cycleLength=${cyc}`);

// 7) 새로고침 후 데이터 영속성
await page.reload();
const persisted = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('health-diary-v1'));
  return { w: d.weights['2026-06-03'], periods: d.periods.length };
});
check('새로고침 후 데이터 유지', persisted.w === 58.4 && persisted.periods === 2, JSON.stringify(persisted));

// 스크린샷
await page.screenshot({ path: path.join(__dirname, 'test-calendar.png'), fullPage: true });
await page.evaluate(() => window.openDayModal('2026-06-03'));
await page.waitForSelector('#day-modal:not([hidden])');
await page.screenshot({ path: path.join(__dirname, 'test-day-modal.png'), fullPage: true });

check('콘솔/페이지 에러 없음', errors.length === 0, errors.join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 결과: ${results.length - failed.length}/${results.length} 통과 ===`);
process.exit(failed.length ? 1 : 0);
