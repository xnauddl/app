import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// playwright 를 로컬 → 전역 순서로 찾는다
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright/index.js')); }
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

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

// 4-1) 종료일 선택으로 기간 설정: 6/7을 종료일로 누르면 6/1 월경이 7일이 됨
const before7 = await page.getAttribute('.cal-cell[data-date="2026-06-07"]', 'class');
check('종료일 지정 전 6/7은 월경 아님', !before7.includes('period'), before7);
await openDay('2026-06-07'); // 6/1 시작 월경의 14일 윈도우 내
await page.waitForSelector('#day-period-end:not([hidden])');
await page.click('#day-period-end');
await page.click('#day-modal-close');
const plenStored = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).periodLengths['2026-06-01']);
check('종료일 6/7 선택 시 기간 7일 저장', plenStored === 7, `periodLengths[6/1]=${plenStored}`);
const after7 = await page.getAttribute('.cal-cell[data-date="2026-06-07"]', 'class');
check('종료일 지정 후 6/7이 월경일', after7.includes('period'), after7);

// 4-2) 더 이른 날을 종료일로 누르면 기간이 줄어듦: 6/4을 종료일로 → 4일
await openDay('2026-06-04');
await page.waitForSelector('#day-period-end:not([hidden])');
await page.click('#day-period-end');
await page.click('#day-modal-close');
const shortened = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).periodLengths['2026-06-01']);
check('종료일 6/4 선택 시 기간 4일로 단축', shortened === 4, `periodLengths[6/1]=${shortened}`);
const day5cls = await page.getAttribute('.cal-cell[data-date="2026-06-05"]', 'class');
check('기간 4일이면 6/5는 월경 아님', !day5cls.includes('period'), day5cls);
// 종료일로 지정된 날은 활성 표시
await openDay('2026-06-04');
const endActive = await page.getAttribute('#day-period-end', 'class');
check('종료일로 지정된 날은 종료 버튼 활성', endActive.includes('active'), endActive);
await page.click('#day-modal-close');
// 원복(5일): 6/5을 종료일로
await openDay('2026-06-05');
await page.click('#day-period-end');
await page.click('#day-modal-close');

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

// 6-1) 평균 주기를 직접 설정하면 자동 평균이 덮어쓰지 않음 (설정 탭의 입력)
await page.click('.tab[data-tab="settings"]');
await page.waitForSelector('#tab-settings.active');
await page.fill('#cycle-length', '33');
await page.dispatchEvent('#cycle-length', 'change');
const manualFlag = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).settings.cycleManual);
check('주기 직접 설정 시 수동 플래그 ON', manualFlag === true, `cycleManual=${manualFlag}`);
// 월경 토글로 자동 평균 경로를 다시 타도 33 유지되어야 함
await page.click('.tab[data-tab="calendar"]');
await openDay('2026-06-29');
await page.click('#day-period-toggle'); // 해제
await page.click('#day-period-toggle'); // 재기록 → averageCycle 경로 실행
await page.click('#day-modal-close');
const keptCycle = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).settings.cycleLength);
check('수동 설정값(33)이 자동 평균으로 덮어쓰이지 않음', keptCycle === 33, `cycleLength=${keptCycle}`);

// 7) 새로고침 후 데이터 영속성
await page.reload();
const persisted = await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('health-diary-v1'));
  return { w: d.weights['2026-06-03'], periods: d.periods.length };
});
check('새로고침 후 데이터 유지', persisted.w === 58.4 && persisted.periods === 2, JSON.stringify(persisted));

// 8) 백업 · 복원 (설정 탭)
await page.click('.tab[data-tab="settings"]');
await page.waitForSelector('#tab-settings.active');
const summaryText = await page.textContent('#backup-summary');
check('백업 요약 칩 표시', summaryText.includes('몸무게') && summaryText.includes('부부관계'), summaryText.replace(/\s+/g, ' ').trim());

// 내보내기(다운로드) 캡처 후 내용 검증
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.click('#export-btn'),
]);
const dlPath = await download.path();
const exported = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
check('백업 파일 형식(app/version/data)', exported.app === 'health-diary' && exported.version === 1 && !!exported.data);
check('백업에 몸무게 데이터 포함', exported.data.weights['2026-06-03'] === 58.4);

// 다이얼로그(확인창) 자동 수락
page.on('dialog', (d) => d.accept());

// 유효한 백업으로 복원 → 기존 데이터 대체
const restoreFile = path.join(os.tmpdir(), 'restore-valid.json');
fs.writeFileSync(restoreFile, JSON.stringify({
  app: 'health-diary', version: 1, data: {
    weights: { '2030-01-01': 62 },
    meals: {}, periods: ['2030-01-01'], relations: { '2030-01-02': true },
    settings: { cycleLength: 30, periodLength: 4 },
  },
}));
await page.setInputFiles('#import-file', restoreFile);
await page.waitForFunction(() => {
  const d = JSON.parse(localStorage.getItem('health-diary-v1'));
  return d.weights['2030-01-01'] === 62 && d.weights['2026-06-03'] === undefined;
}, null, { timeout: 5000 }).then(() => check('유효 백업 복원(데이터 대체)', true))
  .catch(() => check('유효 백업 복원(데이터 대체)', false));
const restoredCycle = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).settings.cycleLength);
check('복원 시 설정값 반영(주기 30)', restoredCycle === 30, `cycleLength=${restoredCycle}`);
const restoreStatus = await page.textContent('#backup-status');
check('복원 완료 메시지', restoreStatus.includes('복원'));

// 잘못된 파일 복원 거부
const badFile = path.join(os.tmpdir(), 'restore-bad.json');
fs.writeFileSync(badFile, JSON.stringify({ foo: 1, bar: 2 }));
await page.setInputFiles('#import-file', badFile);
await page.waitForFunction(
  () => document.getElementById('backup-status').textContent.includes('복원 실패'),
  null, { timeout: 5000 }
).then(() => check('잘못된 파일 복원 거부', true)).catch(() => check('잘못된 파일 복원 거부', false));
// 거부 후 데이터 보존 확인
const stillThere = await page.evaluate(() => JSON.parse(localStorage.getItem('health-diary-v1')).weights['2030-01-01']);
check('복원 거부 시 기존 데이터 보존', stillThere === 62);

// 스크린샷
await page.screenshot({ path: path.join(__dirname, 'test-calendar.png'), fullPage: true });
await page.evaluate(() => window.openDayModal('2026-06-03'));
await page.waitForSelector('#day-modal:not([hidden])');
await page.screenshot({ path: path.join(__dirname, 'test-day-modal.png'), fullPage: true });

// 스크린샷 전에 모달 닫기
await page.evaluate(() => { const m = document.getElementById('day-modal'); if (m && !m.hidden) m.hidden = true; });

// 9) 알림 토글 (달력 탭에 있음)
await page.click('.tab[data-tab="calendar"]');
await page.waitForSelector('#tab-calendar.active');
const notifyHint = page.locator('#notify-hint');

// evaluate로 토글 직접 변경 및 이벤트 발생
await page.evaluate(() => {
  const toggle = document.getElementById('notify-toggle');
  toggle.checked = true;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
let hintText = await notifyHint.textContent();
check('알림 활성화 시도 후 UI 업데이트', hintText.includes('알림') || hintText.includes('거부'));

// 토글 해제
await page.evaluate(() => {
  const toggle = document.getElementById('notify-toggle');
  toggle.checked = false;
  toggle.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(300);
hintText = await notifyHint.textContent();
check('알림 비활성화 후 안내문 복구', hintText.includes('활성화하면'));

check('콘솔/페이지 에러 없음', errors.length === 0, errors.join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== 결과: ${results.length - failed.length}/${results.length} 통과 ===`);
process.exit(failed.length ? 1 : 0);
