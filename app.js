/* ============================================================
   건강 다이어리 — 달력 중심 (몸무게 · 식사 · 월경)
   데이터는 localStorage 에만 저장됩니다 (서버 전송 없음).
   ============================================================ */

/* ---------- 저장소 ---------- */
const DB_KEY = "health-diary-v1";

const defaultData = () => ({
  weights: {},               // { "YYYY-MM-DD": number }
  meals: {},                 // { "YYYY-MM-DD": { breakfast:{eaten,text}, lunch:{...}, dinner:{...} } }
  periods: [],               // [ "YYYY-MM-DD", ... ] 월경 시작일 목록
  periodLengths: {},         // { 시작일ISO: 일수 } 월경별 실제 기간(달마다 다름)
  relations: {},             // { "YYYY-MM-DD": true } 부부관계 있은 날
  settings: { cycleLength: 28, periodLength: 5, cycleManual: false },
});

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultData();
    return Object.assign(defaultData(), JSON.parse(raw));
  } catch (e) {
    console.warn("저장된 데이터를 읽지 못했습니다.", e);
    return defaultData();
  }
}
function saveDB() { localStorage.setItem(DB_KEY, JSON.stringify(db)); }

let db = loadDB();

/* ---------- 날짜 유틸 ---------- */
function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fromISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
function todayISO() { return toISO(new Date()); }
function fmtKDate(iso) {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
}

const MEAL_KEYS = ["breakfast", "lunch", "dinner"];
const MEAL_LABEL = { breakfast: "아침", lunch: "점심", dinner: "저녁" };
const MEAL_EMOJI = { breakfast: "🌅", lunch: "☀️", dinner: "🌙" };

/* ---------- 탭 전환 ---------- */
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "trends") renderTrends();
    if (btn.dataset.tab === "settings") { renderSettings(); updateStorageStatus(); }
  });
});

/* ============================================================
   알림 설정
   ============================================================ */
const NOTIFY_KEY = "health-diary-notify-enabled";
const NOTIFY_SHOWN_KEY = "health-diary-notify-shown-"; // ISO date appended

function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission !== "denied") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") renderPredict(); // UI 갱신
    });
  }
  return Notification.permission === "granted";
}

function getNextPeriodDate() {
  if (db.periods.length === 0) return null;
  const cycle = db.settings.cycleLength;
  const lastStart = fromISO([...db.periods].sort().pop());
  return addDays(lastStart, cycle);
}

function checkAndShowNotification() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!localStorage.getItem(NOTIFY_KEY)) return;

  const nextPeriod = getNextPeriodDate();
  if (!nextPeriod) return;

  const nextISO = toISO(nextPeriod);
  const today = todayISO();

  // 예정일 당일 또는 미리 설정한 날짜(기본 D-1)에 알림
  const notifyDaysAhead = 1;
  const notifyDate = toISO(addDays(nextPeriod, -notifyDaysAhead));

  // 이미 오늘 알림을 표시했는지 확인
  const shownKey = NOTIFY_SHOWN_KEY + today;
  if (localStorage.getItem(shownKey)) return;

  if (today === notifyDate || today === nextISO) {
    const msg = today === nextISO ? "다음 월경 예정일입니다!" : `다음 월경 예정일까지 ${notifyDaysAhead}일 남았어요.`;
    new Notification("건강 다이어리", {
      body: msg,
      icon: "icon-192.png",
      tag: "period-reminder",
    });
    localStorage.setItem(shownKey, "1");
  }
}

const notifyToggle = document.getElementById("notify-toggle");
const notifyHint = document.getElementById("notify-hint");

notifyToggle.checked = !!localStorage.getItem(NOTIFY_KEY);

notifyToggle.addEventListener("change", () => {
  if (notifyToggle.checked) {
    const ok = requestNotificationPermission();
    if (!ok) {
      notifyToggle.checked = false;
      notifyHint.textContent = "브라우저에서 알림 권한을 거부했습니다. 브라우저 설정에서 허락해 주세요.";
      notifyHint.style.color = "var(--period)";
      return;
    }
    localStorage.setItem(NOTIFY_KEY, "1");
    notifyHint.textContent = "✓ 알림이 활성화되었습니다.";
    notifyHint.style.color = "var(--ink)";
    checkAndShowNotification();
  } else {
    localStorage.removeItem(NOTIFY_KEY);
    notifyHint.textContent = "활성화하면 다음 월경 예정일에 브라우저 알림을 받아요.";
    notifyHint.style.color = "var(--muted)";
  }
});

// 페이지 로드 시 알림 확인
window.addEventListener("focus", checkAndShowNotification);
checkAndShowNotification();

/* ============================================================
   월경 주기 계산
   ============================================================ */
function getMeals(date) {
  if (!db.meals[date]) {
    db.meals[date] = {
      breakfast: { eaten: false, text: "" },
      lunch: { eaten: false, text: "" },
      dinner: { eaten: false, text: "" },
    };
  }
  return db.meals[date];
}

function averageCycle() {
  const starts = [...db.periods].sort();
  if (starts.length < 2) return null;
  let sum = 0, count = 0;
  for (let i = 1; i < starts.length; i++) {
    const gap = daysBetween(fromISO(starts[i - 1]), fromISO(starts[i]));
    if (gap >= 18 && gap <= 45) { sum += gap; count++; }
  }
  return count ? Math.round(sum / count) : null;
}

// 특정 월경(시작일)의 실제 기간. 따로 기록이 없으면 기본 설정값으로.
function periodLengthFor(startISO) {
  const v = db.periodLengths ? db.periodLengths[startISO] : undefined;
  return Number.isFinite(v) && v >= 1 && v <= 14 ? v : db.settings.periodLength;
}

// 기록된 월경 기간들의 평균(미래 예측에 사용). 기록 없으면 기본값.
function averagePeriodLength() {
  const vals = db.periods
    .map((s) => db.periodLengths && db.periodLengths[s])
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 14);
  if (vals.length === 0) return db.settings.periodLength;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// 이 날의 종료일을 지정할 수 있는 '기록된 월경'의 시작일(없으면 null).
// 시작일 당일~14일 이내의 가장 가까운 시작일을 찾는다(현재 기간보다 길게 늘리는 것도 허용).
function periodOwnerFor(iso) {
  let best = null;
  for (const s of db.periods) {
    if (s <= iso) {
      const gap = daysBetween(fromISO(s), fromISO(iso)); // 0~
      if (gap >= 0 && gap <= 13 && (!best || s > best)) best = s;
    }
  }
  return best;
}

/*
  핵심 계산:
  - 기록된 월경 시작일 + 미래 예측 시작일들을 만든다.
  - 각 주기마다 "다음 월경 예정일 - 14일" = 배란일
  - 가임기 = 배란일 -5일 ~ 배란일 +3일
  반환: 날짜(ISO) -> 분류 맵
*/
function buildCycleMap() {
  const cycle = db.settings.cycleLength;
  const recorded = [...db.periods].sort();
  const recordedSet = new Set(recorded);
  const avgPlen = averagePeriodLength();

  const starts = recorded.slice();
  if (recorded.length > 0) {
    let last = fromISO(recorded[recorded.length - 1]);
    for (let i = 0; i < 18; i++) {
      last = addDays(last, cycle);
      starts.push(toISO(last));
    }
  }
  starts.sort();

  const map = {}; // iso -> "period" | "predicted" | "fertile" | "ovulation"
  const set = (iso, type) => { map[iso] = type; };

  starts.forEach((s) => {
    const isRecorded = recordedSet.has(s);
    // 기록된 월경은 그 달의 실제 기간, 예측은 평균 기간 사용
    const plen = isRecorded ? periodLengthFor(s) : avgPlen;
    for (let d = 0; d < plen; d++) {
      const iso = toISO(addDays(fromISO(s), d));
      if (map[iso] === "period") continue;
      set(iso, isRecorded ? "period" : "predicted");
    }
  });

  for (let i = 0; i < starts.length - 1; i++) {
    const nextStart = fromISO(starts[i + 1]);
    const ovulation = addDays(nextStart, -14);      // 배란일: 다음 월경 예정일 - 14일
    for (let d = -5; d <= 3; d++) {                  // 가임기: 배란일 -5 ~ +3
      const iso = toISO(addDays(ovulation, d));
      if (map[iso] === "period" || map[iso] === "predicted") continue;
      set(iso, "fertile");
    }
    const ovIso = toISO(ovulation);
    if (map[ovIso] !== "period" && map[ovIso] !== "predicted") set(ovIso, "ovulation");
  }

  return map;
}

/* ============================================================
   달력 (홈)
   ============================================================ */
const cycleLengthInput = document.getElementById("cycle-length");
const periodLengthInput = document.getElementById("period-length");
let calView = new Date(); calView.setDate(1);

cycleLengthInput.value = db.settings.cycleLength;
periodLengthInput.value = db.settings.periodLength;

cycleLengthInput.addEventListener("change", () => {
  db.settings.cycleLength = clampInt(cycleLengthInput.value, 20, 40, 28);
  db.settings.cycleManual = true; // 직접 설정 시 기록 평균 자동 덮어쓰기 중단
  cycleLengthInput.value = db.settings.cycleLength;
  saveDB(); renderCalendarView();
});
periodLengthInput.addEventListener("change", () => {
  db.settings.periodLength = clampInt(periodLengthInput.value, 2, 10, 5);
  periodLengthInput.value = db.settings.periodLength;
  saveDB(); renderCalendarView();
});
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
}

document.getElementById("cal-prev").addEventListener("click", () => { calView.setMonth(calView.getMonth() - 1); renderCalendar(); });
document.getElementById("cal-next").addEventListener("click", () => { calView.setMonth(calView.getMonth() + 1); renderCalendar(); });

const CYCLE_MARK = { period: "🩸", predicted: "🩸", ovulation: "✦", fertile: "•" };

function mealsDotsHtml(iso) {
  const m = db.meals[iso];
  const has = m && MEAL_KEYS.some((k) => m[k].eaten || m[k].text.trim());
  if (!has) return "";
  const dots = MEAL_KEYS.map((k) => `<i class="md ${m[k].eaten ? "on" : ""}"></i>`).join("");
  return `<span class="cal-meals">${dots}</span>`;
}

function renderCalendar() {
  const grid = document.getElementById("cal-grid");
  const title = document.getElementById("cal-title");
  const year = calView.getFullYear(), month = calView.getMonth();
  title.textContent = `${year}년 ${month + 1}월`;

  const map = buildCycleMap();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = todayISO();

  const STATE_LABEL = { period: "월경", predicted: "예상 월경", fertile: "가임기", ovulation: "배란일" };

  let html = "";
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty-cell"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toISO(new Date(year, month, day));
    const type = map[iso] || "";
    const isToday = iso === today;
    const mark = CYCLE_MARK[type] || "";
    const heart = db.relations[iso] ? `<span class="cal-heart">❤</span>` : "";
    const w = db.weights[iso];
    const weightHtml = w != null ? `<span class="cal-w">${w}</span>` : "";

    // 스크린리더용 설명: 날짜·요일·주기상태·기록 요약
    const wd = "일월화수목금토"[new Date(year, month, day).getDay()] + "요일";
    const labelParts = [`${month + 1}월 ${day}일`, wd];
    if (STATE_LABEL[type]) labelParts.push(STATE_LABEL[type]);
    if (db.relations[iso]) labelParts.push("부부관계 기록");
    if (w != null) labelParts.push(`몸무게 ${w}kg`);
    if (isToday) labelParts.push("오늘");
    const aria = labelParts.join(", ");

    const bottom = `${weightHtml}${mealsDotsHtml(iso)}`;
    html += `<div class="cal-cell ${type} ${isToday ? "today" : ""}" data-date="${iso}" role="button" tabindex="0" aria-label="${aria}">
      <span class="cal-top"><span class="cal-day">${day}</span><span class="cal-mark">${mark}${heart}</span></span>
      ${bottom ? `<span class="cal-bottom">${bottom}</span>` : ""}
    </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".cal-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => openDayModal(cell.dataset.date));
    cell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDayModal(cell.dataset.date);
      }
    });
  });
}

function renderPredict() {
  const box = document.getElementById("cycle-predict");
  const hint = document.getElementById("cycle-calc-hint");
  const avg = averageCycle();
  if (!avg) {
    hint.textContent = "월경 시작일을 2회 이상 기록하면 평균 주기를 자동 계산해요.";
  } else if (db.settings.cycleManual) {
    hint.textContent = `기록 평균은 약 ${avg}일이에요. (지금은 직접 설정한 ${db.settings.cycleLength}일 사용 중)`;
  } else {
    hint.textContent = `기록을 바탕으로 평균 주기를 약 ${avg}일로 자동 설정했어요.`;
  }

  if (db.periods.length === 0) {
    box.innerHTML = `<p class="empty">달력에서 날짜를 눌러 월경 시작일을 기록해 보세요.</p>`;
    return;
  }

  const cycle = db.settings.cycleLength;
  const lastStart = fromISO([...db.periods].sort().pop());
  const nextPeriod = addDays(lastStart, cycle);
  const ovulation = addDays(nextPeriod, -14);
  const fertileStart = addDays(ovulation, -5);
  const fertileEnd = addDays(ovulation, 3);
  const dToNext = daysBetween(new Date(fromISO(todayISO())), nextPeriod);

  box.innerHTML = `
    <div class="predict-item"><span>다음 월경 예정일</span><b>${fmtKDate(toISO(nextPeriod))}${dToNext >= 0 ? ` · D-${dToNext}` : ""}</b></div>
    <div class="predict-item"><span>배란일 (예정일 −14일)</span><b>${fmtKDate(toISO(ovulation))}</b></div>
    <div class="predict-item"><span>가임기</span><b>${fmtKDate(toISO(fertileStart))} ~ ${fmtKDate(toISO(fertileEnd))}</b></div>
    <div class="predict-item"><span>최근 기록</span><b>${fmtKDate(toISO(lastStart))}</b></div>`;
}

function renderCalendarView() {
  renderCalendar();
  renderPredict();
  // 월경 기록 변경 시 알림 상태 업데이트
  notifyToggle.checked = !!localStorage.getItem(NOTIFY_KEY);
  checkAndShowNotification();
}

/* ============================================================
   날짜 상세 모달 (몸무게 · 식사 · 월경)
   ============================================================ */
const dayModal = document.getElementById("day-modal");
const dayWeight = document.getElementById("day-weight");
const dayPeriodToggle = document.getElementById("day-period-toggle");
const dayPeriodEnd = document.getElementById("day-period-end");
const dayPeriodRange = document.getElementById("day-period-range");
const dayCycleInfo = document.getElementById("day-cycle-info");
const dayRelToggle = document.getElementById("day-rel-toggle");
const dayRelInfo = document.getElementById("day-rel-info");
let selectedDate = null;
let editingPeriodStart = null; // 기간 입력란이 수정 중인 월경의 시작일
let lastFocusedBeforeModal = null; // 모달 닫을 때 포커스 복원용

function openDayModal(iso) {
  selectedDate = iso;
  lastFocusedBeforeModal = document.activeElement; // 닫을 때 돌려줄 포커스 기억
  document.getElementById("day-modal-title").textContent = fmtKDate(iso);

  // 몸무게
  dayWeight.value = db.weights[iso] != null ? db.weights[iso] : "";

  // 식사
  const m = getMeals(iso);
  MEAL_KEYS.forEach((k) => {
    dayModal.querySelector(`[data-dcheck="${k}"]`).checked = m[k].eaten;
    dayModal.querySelector(`[data-dtext="${k}"]`).value = m[k].text;
    dayModal.querySelector(`.meal-box[data-dmeal="${k}"]`).classList.toggle("eaten", m[k].eaten);
  });

  // 월경
  updatePeriodToggle(iso);

  // 부부관계
  updateRelToggle(iso);

  dayModal.hidden = false;
  // 포커스를 모달 안(닫기 버튼)으로 이동 — 스크린리더/키보드 접근성
  document.getElementById("day-modal-close").focus();
}

function closeDayModal() {
  const iso = selectedDate;
  dayModal.hidden = true;
  selectedDate = null;
  // 포커스 복원: 달력이 다시 그려졌을 수 있으니 같은 날짜 칸을 찾아 포커스,
  // 없으면 직전 포커스 요소(여전히 문서에 있을 때)로 되돌림
  let target = iso ? document.querySelector(`.cal-cell[data-date="${iso}"]`) : null;
  if (!target && lastFocusedBeforeModal && document.contains(lastFocusedBeforeModal)) {
    target = lastFocusedBeforeModal;
  }
  if (target && typeof target.focus === "function") target.focus();
  lastFocusedBeforeModal = null;
}
document.getElementById("day-modal-close").addEventListener("click", closeDayModal);
dayModal.addEventListener("click", (e) => { if (e.target === dayModal) closeDayModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !dayModal.hidden) closeDayModal(); });

// 포커스 트랩: 모달이 열린 동안 Tab 이동을 모달 안에 가둠
dayModal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;
  const focusables = dayModal.querySelectorAll(
    'button, input:not([type="hidden"]), select, textarea, [href], [tabindex]:not([tabindex="-1"])'
  );
  const list = Array.from(focusables).filter((el) => !el.disabled && el.offsetParent !== null);
  if (list.length === 0) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
});

/* 몸무게 입력 */
dayWeight.addEventListener("change", () => {
  if (!selectedDate) return;
  const val = parseFloat(dayWeight.value);
  if (dayWeight.value === "" || isNaN(val) || val <= 0) {
    delete db.weights[selectedDate];
    dayWeight.value = "";
  } else {
    db.weights[selectedDate] = Math.round(val * 10) / 10;
    dayWeight.value = db.weights[selectedDate];
  }
  saveDB(); renderCalendar();
});
document.getElementById("day-weight-clear").addEventListener("click", () => {
  if (!selectedDate) return;
  delete db.weights[selectedDate];
  dayWeight.value = "";
  saveDB(); renderCalendar();
});

/* 식사 입력 */
MEAL_KEYS.forEach((k) => {
  const check = dayModal.querySelector(`[data-dcheck="${k}"]`);
  const text = dayModal.querySelector(`[data-dtext="${k}"]`);
  const box = dayModal.querySelector(`.meal-box[data-dmeal="${k}"]`);
  check.addEventListener("change", () => {
    if (!selectedDate) return;
    const m = getMeals(selectedDate);
    m[k].eaten = check.checked;
    box.classList.toggle("eaten", check.checked);
    saveDB(); renderCalendar();
  });
  text.addEventListener("input", () => {
    if (!selectedDate) return;
    const m = getMeals(selectedDate);
    m[k].text = text.value;
    if (text.value.trim() && !m[k].eaten) {
      m[k].eaten = true; check.checked = true; box.classList.add("eaten");
    }
    saveDB(); renderCalendar();
  });
});

/* 월경 시작일 토글 */
function updatePeriodToggle(iso) {
  const isStart = db.periods.includes(iso);
  dayPeriodToggle.classList.toggle("active", isStart);
  dayPeriodToggle.textContent = isStart ? "✓ 월경 시작일로 기록됨 (해제)" : "이 날을 월경 시작일로 기록";

  // 이 날을 종료일로 지정할 수 있는 월경이 있으면 종료일 버튼/안내 표시
  const owner = periodOwnerFor(iso);
  editingPeriodStart = owner;
  if (owner) {
    const len = periodLengthFor(owner);
    const endISO = toISO(addDays(fromISO(owner), len - 1));
    const isEnd = iso === endISO;
    dayPeriodEnd.hidden = false;
    dayPeriodEnd.classList.toggle("active", isEnd);
    dayPeriodEnd.textContent = isEnd ? "✓ 이 날이 월경 종료일 (변경하려면 다른 날 선택)" : "이 날을 월경 종료일로 기록";
    dayPeriodRange.textContent =
      `이번 월경: ${fmtKDate(owner)} ~ ${fmtKDate(endISO)} (${len}일간)` +
      (isStart ? " · 끝나는 날을 달력에서 눌러 종료일로 지정하세요" : "");
  } else {
    dayPeriodEnd.hidden = true;
    dayPeriodRange.textContent = "";
  }

  const map = buildCycleMap();
  const type = map[iso];
  const desc = { period: "월경일", predicted: "예상 월경일", fertile: "가임기", ovulation: "배란일" }[type];
  dayCycleInfo.textContent = desc ? `이 날의 주기 상태: ${desc}` : "";
}

dayPeriodToggle.addEventListener("click", () => {
  if (!selectedDate) return;
  if (!db.periodLengths) db.periodLengths = {};
  const idx = db.periods.indexOf(selectedDate);
  if (idx >= 0) {
    db.periods.splice(idx, 1);
    delete db.periodLengths[selectedDate];
  } else {
    db.periods.push(selectedDate); db.periods.sort();
    // 새 기록은 평균(없으면 기본값) 기간으로 시작 — 이후 모달에서 수정 가능
    db.periodLengths[selectedDate] = averagePeriodLength();
  }

  // 사용자가 직접 설정하지 않았을 때만 기록 평균을 자동 반영
  const avg = averageCycle();
  if (avg && !db.settings.cycleManual) { db.settings.cycleLength = avg; cycleLengthInput.value = avg; }

  saveDB();
  updatePeriodToggle(selectedDate);
  updateRelToggle(selectedDate);
  renderCalendarView();
});

/* 월경 종료일 선택 — 선택한 날을 그 월경의 마지막 날로 지정(기간 자동 계산) */
dayPeriodEnd.addEventListener("click", () => {
  if (!selectedDate || !editingPeriodStart || !db.periods.includes(editingPeriodStart)) return;
  if (!db.periodLengths) db.periodLengths = {};
  const len = clampInt(
    daysBetween(fromISO(editingPeriodStart), fromISO(selectedDate)) + 1,
    1, 14, db.settings.periodLength
  );
  db.periodLengths[editingPeriodStart] = len;
  saveDB();
  updatePeriodToggle(selectedDate);
  renderCalendarView();
});

/* 부부관계 토글 */
function updateRelToggle(iso) {
  const on = !!db.relations[iso];
  dayRelToggle.classList.toggle("active", on);
  dayRelToggle.textContent = on ? "❤️ 부부관계 있음 (해제)" : "부부관계 있음으로 기록";

  // 가임기 / 배란일에 해당하면 안내
  const type = buildCycleMap()[iso];
  if (on && (type === "fertile" || type === "ovulation")) {
    dayRelInfo.textContent = type === "ovulation"
      ? "배란일입니다 — 임신 가능성이 가장 높은 날이에요."
      : "가임기에 해당하는 날이에요.";
  } else {
    dayRelInfo.textContent = "";
  }
}

dayRelToggle.addEventListener("click", () => {
  if (!selectedDate) return;
  if (db.relations[selectedDate]) delete db.relations[selectedDate];
  else db.relations[selectedDate] = true;
  saveDB();
  updateRelToggle(selectedDate);
  renderCalendar();
});

/* ============================================================
   추이 · 기록 탭
   ============================================================ */
function sortedWeights() {
  return Object.entries(db.weights)
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderWeightStats() {
  const data = sortedWeights();
  const box = document.getElementById("weight-stats");
  if (data.length === 0) { box.innerHTML = ""; return; }
  const latest = data[data.length - 1];
  const first = data[0];
  const diff = Math.round((latest.kg - first.kg) * 10) / 10;
  const cls = diff < 0 ? "down" : diff > 0 ? "up" : "";
  const sign = diff > 0 ? "+" : "";
  box.innerHTML = `
    <div><span>현재</span><b>${latest.kg}kg</b></div>
    <div><span>시작 대비</span><b class="${cls}">${sign}${diff}kg</b></div>
    <div><span>기록</span><b>${data.length}일</b></div>`;
}

function renderWeightChart() {
  const svg = document.getElementById("weight-chart");
  const data = sortedWeights();
  const W = 600, H = 260, pad = 36;
  svg.innerHTML = "";
  if (data.length === 0) {
    svg.innerHTML = `<text x="${W/2}" y="${H/2}" text-anchor="middle" fill="#9ca3af" font-size="14">아직 몸무게 기록이 없습니다.</text>`;
    return;
  }
  const kgs = data.map((d) => d.kg);
  let min = Math.min(...kgs), max = Math.max(...kgs);
  if (min === max) { min -= 1; max += 1; } else { const m = (max - min) * 0.15; min -= m; max += m; }
  const n = data.length;
  const x = (i) => pad + (n === 1 ? (W - 2 * pad) / 2 : (i * (W - 2 * pad)) / (n - 1));
  const y = (kg) => H - pad - ((kg - min) / (max - min)) * (H - 2 * pad);

  let grid = "";
  for (let g = 0; g <= 3; g++) {
    const gy = pad + (g * (H - 2 * pad)) / 3;
    const gv = (max - (g * (max - min)) / 3).toFixed(1);
    grid += `<line x1="${pad}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke="#e5e7eb" stroke-width="1"/>`;
    grid += `<text x="${pad - 6}" y="${gy + 4}" text-anchor="end" fill="#9ca3af" font-size="10">${gv}</text>`;
  }

  const linePts = data.map((d, i) => `${x(i)},${y(d.kg)}`).join(" ");
  const areaPts = `${pad},${H - pad} ${linePts} ${x(n - 1)},${H - pad}`;

  let dots = "";
  data.forEach((d, i) => {
    dots += `<circle cx="${x(i)}" cy="${y(d.kg)}" r="3.5" fill="#dc2626"/>`;
    if (n <= 12 || i === 0 || i === n - 1) {
      const dd = fromISO(d.date);
      dots += `<text x="${x(i)}" y="${H - pad + 16}" text-anchor="middle" fill="#9ca3af" font-size="9">${dd.getMonth()+1}/${dd.getDate()}</text>`;
    }
  });

  svg.innerHTML = `
    ${grid}
    <polygon points="${areaPts}" fill="#f5f5f5" opacity="0.7"/>
    <polyline points="${linePts}" fill="none" stroke="#dc2626" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}`;
}

function renderWeightList() {
  const box = document.getElementById("weight-list");
  const data = sortedWeights().reverse();
  if (data.length === 0) { box.innerHTML = `<p class="empty">달력에서 날짜를 눌러 몸무게를 입력해 보세요.</p>`; return; }
  box.innerHTML = data.map((d, idx) => {
    const prev = data[idx + 1];
    let delta = "";
    if (prev) {
      const diff = Math.round((d.kg - prev.kg) * 10) / 10;
      if (diff !== 0) {
        const cls = diff < 0 ? "down" : "up";
        delta = `<span class="${cls}" style="font-size:.8rem;margin-left:8px">${diff > 0 ? "+" : ""}${diff}</span>`;
      }
    }
    return `<div class="list-item">
      <span class="date">${fmtKDate(d.date)}</span>
      <span><span class="val">${d.kg}kg</span>${delta}</span>
    </div>`;
  }).join("");
}

function renderMealsList() {
  const box = document.getElementById("meals-list");
  const dates = Object.keys(db.meals)
    .filter((d) => MEAL_KEYS.some((k) => db.meals[d][k].eaten || db.meals[d][k].text.trim()))
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 14);
  if (dates.length === 0) { box.innerHTML = `<p class="empty">달력에서 날짜를 눌러 식사를 기록해 보세요.</p>`; return; }
  box.innerHTML = dates.map((d) => {
    const m = db.meals[d];
    const tags = MEAL_KEYS.map((k) =>
      `<span class="meal-tag ${m[k].eaten ? "on" : ""}" title="${MEAL_LABEL[k]}">${MEAL_EMOJI[k]}</span>`
    ).join("");
    const details = MEAL_KEYS.filter((k) => m[k].text.trim())
      .map((k) => `${MEAL_LABEL[k]}: ${m[k].text.trim()}`).join(" · ");
    return `<div class="list-item" style="flex-direction:column;align-items:stretch;gap:6px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="date">${fmtKDate(d)}</span>
        <span class="meal-summary">${tags}</span>
      </div>
      ${details ? `<div style="font-size:.85rem;color:#4b5563">${details}</div>` : ""}
    </div>`;
  }).join("");
}

function renderTrends() { renderWeightStats(); renderWeightChart(); renderWeightList(); renderMealsList(); }

/* 설정 탭: 백업 요약 등 */
function renderSettings() { renderBackupSummary(); }

/* ============================================================
   백업 · 복원
   ============================================================ */
const LAST_BACKUP_KEY = "health-diary-last-backup"; // db 와 분리(복원에도 보존)
const backupStatus = document.getElementById("backup-status");

function dataCounts(d) {
  const mealDays = Object.keys(d.meals || {}).filter((k) =>
    MEAL_KEYS.some((m) => d.meals[k][m] && (d.meals[k][m].eaten || (d.meals[k][m].text || "").trim()))
  ).length;
  return {
    weights: Object.keys(d.weights || {}).length,
    meals: mealDays,
    periods: (d.periods || []).length,
    relations: Object.keys(d.relations || {}).length,
  };
}

function renderBackupSummary() {
  const box = document.getElementById("backup-summary");
  const c = dataCounts(db);
  box.innerHTML = `
    <span class="bchip">몸무게 <b>${c.weights}</b>일</span>
    <span class="bchip">식사 <b>${c.meals}</b>일</span>
    <span class="bchip">월경 <b>${c.periods}</b>회</span>
    <span class="bchip">부부관계 <b>${c.relations}</b>일</span>`;
  const last = localStorage.getItem(LAST_BACKUP_KEY);
  if (last) {
    const d = new Date(last);
    backupStatus.className = "hint";
    backupStatus.textContent = `최근 백업: ${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } else {
    backupStatus.className = "hint";
    backupStatus.textContent = "아직 백업한 적이 없습니다.";
  }
}

/* 내보내기 */
document.getElementById("export-btn").addEventListener("click", () => {
  const payload = { app: "health-diary", version: 1, exportedAt: new Date().toISOString(), data: db };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `건강다이어리-백업-${todayISO()}.json`; a.click();
  URL.revokeObjectURL(url);
  localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
  renderBackupSummary();
  backupStatus.className = "hint ok";
  backupStatus.textContent = "백업 파일을 저장했습니다. 안전한 곳에 보관하세요.";
});

/* 복원 */
document.getElementById("import-btn").addEventListener("click", () => document.getElementById("import-file").click());

// 백업 파일을 유효한 db 객체로 정규화. 실패 시 예외.
function normalizeBackup(parsed) {
  if (!parsed || typeof parsed !== "object") throw new Error("형식 오류");
  // 신형: {app, version, data} / 구형: db 객체 그대로
  const raw = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
  const looksLikeData = ["weights", "meals", "periods", "relations", "settings"].some((k) => k in raw);
  if (!looksLikeData) throw new Error("건강 다이어리 백업 파일이 아닙니다");
  const out = defaultData();
  if (raw.weights && typeof raw.weights === "object") out.weights = raw.weights;
  if (raw.meals && typeof raw.meals === "object") out.meals = raw.meals;
  if (Array.isArray(raw.periods)) out.periods = raw.periods.slice().sort();
  if (raw.periodLengths && typeof raw.periodLengths === "object") {
    const pl = {};
    for (const [k, v] of Object.entries(raw.periodLengths)) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 1 && n <= 14) pl[k] = n;
    }
    out.periodLengths = pl;
  }
  if (raw.relations && typeof raw.relations === "object") out.relations = raw.relations;
  if (raw.settings && typeof raw.settings === "object") {
    out.settings.cycleLength = clampInt(raw.settings.cycleLength, 20, 40, 28);
    out.settings.periodLength = clampInt(raw.settings.periodLength, 2, 10, 5);
    out.settings.cycleManual = !!raw.settings.cycleManual;
  }
  return out;
}

// 텍스트(JSON 문자열)로부터 복원. 파일 입력/파일 핸들러/공유에서 공용으로 사용.
function restoreFromText(text) {
  let restored;
  try {
    restored = normalizeBackup(JSON.parse(text));
  } catch (err) {
    backupStatus.className = "hint warn";
    backupStatus.textContent = `복원 실패: ${err.message}`;
    return false;
  }
  const c = dataCounts(restored);
  const ok = confirm(
    `이 백업으로 복원하면 현재 기록을 모두 덮어씁니다.\n\n` +
    `복원할 내용: 몸무게 ${c.weights}일 · 식사 ${c.meals}일 · 월경 ${c.periods}회 · 부부관계 ${c.relations}일\n\n` +
    `계속할까요?`
  );
  if (!ok) {
    backupStatus.className = "hint";
    backupStatus.textContent = "복원을 취소했습니다.";
    return false;
  }
  db = restored;
  saveDB();
  initAll();
  backupStatus.className = "hint ok";
  backupStatus.textContent = "백업에서 복원했습니다.";
  return true;
}

document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = ""; // 같은 파일 다시 선택 가능하도록 초기화
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => restoreFromText(reader.result);
  reader.onerror = () => {
    backupStatus.className = "hint warn";
    backupStatus.textContent = "파일을 읽지 못했습니다.";
  };
  reader.readAsText(file);
});

/* ---------- 파일 핸들러 (백업 .json 파일 열기) ---------- */
// manifest의 file_handlers로 등록된 .json 파일을 앱에서 직접 열 때 처리
if ("launchQueue" in window && typeof LaunchParams !== "undefined" && "files" in LaunchParams.prototype) {
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files || !launchParams.files.length) return;
    try {
      const fileHandle = launchParams.files[0];
      const file = await fileHandle.getFile();
      const text = await file.text();
      // 추이·기록 탭으로 전환 후 복원
      document.querySelector('.tab[data-tab="settings"]').click();
      restoreFromText(text);
    } catch (e) {
      console.log("파일 열기 실패:", e);
    }
  });
}

/* ---------- 공유 대상 (다른 앱에서 백업 파일 공유받기) ---------- */
// manifest의 share_target으로 공유된 백업을 Service Worker가 캐시에 저장 → 앱에서 복원
(async function checkSharedBackup() {
  const params = new URLSearchParams(location.search);
  if (!params.has("shared")) return;
  try {
    const cache = await caches.open("shared-backup");
    const res = await cache.match("shared-data");
    if (res) {
      const text = await res.text();
      await cache.delete("shared-data");
      document.querySelector('.tab[data-tab="settings"]').click();
      restoreFromText(text);
    }
  } catch (e) {
    console.log("공유 데이터 복원 실패:", e);
  }
  // URL에서 ?shared 파라미터 정리
  if (history.replaceState) history.replaceState(null, "", "./");
})();

/* ---------- 초기 렌더 ---------- */
function initAll() {
  cycleLengthInput.value = db.settings.cycleLength;
  periodLengthInput.value = db.settings.periodLength;
  calView = new Date(); calView.setDate(1);
  renderCalendarView();
  renderTrends();
  renderSettings();
}
initAll();

/* ---------- Service Worker 등록 ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch((err) => {
    console.log('Service Worker 등록 실패:', err);
  });
}

/* ---------- 영구 저장소 (데이터 보호) ---------- */
const storageStatusEl = document.getElementById('storage-status');
const persistBtn = document.getElementById('persist-btn');

async function updateStorageStatus() {
  if (!navigator.storage || !navigator.storage.persisted) {
    storageStatusEl.innerHTML = '⚠️ 이 브라우저는 영구 저장소를 지원하지 않습니다.<br>주기적으로 백업 파일을 저장해 주세요.';
    storageStatusEl.className = 'storage-status warn';
    persistBtn.style.display = 'none';
    return;
  }
  const persisted = await navigator.storage.persisted();
  if (persisted) {
    storageStatusEl.innerHTML = '✅ 데이터 영구 보존이 켜져 있습니다.<br>기록이 자동으로 삭제되지 않습니다.';
    storageStatusEl.className = 'storage-status ok';
    persistBtn.style.display = 'none';
  } else {
    storageStatusEl.innerHTML = '🔓 데이터 영구 보존이 꺼져 있습니다.<br>아래 버튼을 눌러 보호를 켜주세요.';
    storageStatusEl.className = 'storage-status warn';
    persistBtn.style.display = 'block';
  }

  // 저장 공간 사용량 표시 (가능한 경우)
  if (navigator.storage.estimate) {
    try {
      const { usage } = await navigator.storage.estimate();
      if (usage != null) {
        const kb = (usage / 1024).toFixed(1);
        storageStatusEl.innerHTML += `<br><span class="storage-usage">사용 중: ${kb} KB</span>`;
      }
    } catch (e) { /* 무시 */ }
  }
}

if (persistBtn) {
  persistBtn.addEventListener('click', async () => {
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      if (granted) {
        await updateStorageStatus();
      } else {
        storageStatusEl.innerHTML = '⚠️ 브라우저가 영구 보존을 거부했습니다.<br>앱을 홈 화면에 설치하면 자동으로 켜질 수 있어요. 그때까지는 백업을 자주 해주세요.';
        storageStatusEl.className = 'storage-status warn';
      }
    }
  });
}

// 페이지 로드 시 자동으로 영구 저장소 요청 시도
(async function initStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const already = await navigator.storage.persisted();
    if (!already) {
      // 자동 요청 (설치된 PWA에서는 보통 자동 승인됨)
      await navigator.storage.persist();
    }
  }
  await updateStorageStatus();
})();
