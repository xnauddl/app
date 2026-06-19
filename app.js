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
  settings: { cycleLength: 28, periodLength: 5 },
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
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "trends") renderTrends();
  });
});

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

/*
  핵심 계산:
  - 기록된 월경 시작일 + 미래 예측 시작일들을 만든다.
  - 각 주기마다 "다음 생리 예정일 - 14일" = 배란일
  - 가임기 = 배란일 -5일 ~ 배란일 +3일
  반환: 날짜(ISO) -> 분류 맵
*/
function buildCycleMap() {
  const cycle = db.settings.cycleLength;
  const plen = db.settings.periodLength;
  const recorded = [...db.periods].sort();

  const starts = recorded.slice();
  if (recorded.length > 0) {
    let last = fromISO(recorded[recorded.length - 1]);
    for (let i = 0; i < 18; i++) {
      last = addDays(last, cycle);
      starts.push(toISO(last));
    }
  }
  starts.sort();

  const recordedSet = new Set(recorded);
  const map = {}; // iso -> "period" | "predicted" | "fertile" | "ovulation"
  const set = (iso, type) => { map[iso] = type; };

  starts.forEach((s) => {
    const isRecorded = recordedSet.has(s);
    for (let d = 0; d < plen; d++) {
      const iso = toISO(addDays(fromISO(s), d));
      if (map[iso] === "period") continue;
      set(iso, isRecorded ? "period" : "predicted");
    }
  });

  for (let i = 0; i < starts.length - 1; i++) {
    const nextStart = fromISO(starts[i + 1]);
    const ovulation = addDays(nextStart, -14);      // 배란일: 다음 생리 예정일 - 14일
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

const CYCLE_MARK = { period: "🩸", predicted: "🩸", ovulation: "✦", fertile: "" };

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

  let html = "";
  for (let i = 0; i < firstDay; i++) html += `<div class="cal-cell empty-cell"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = toISO(new Date(year, month, day));
    const type = map[iso] || "";
    const isToday = iso === today;
    const mark = CYCLE_MARK[type] || "";
    const w = db.weights[iso];
    const weightHtml = w != null ? `<span class="cal-w">${w}</span>` : "";
    html += `<div class="cal-cell ${type} ${isToday ? "today" : ""}" data-date="${iso}">
      <span class="cal-top"><span class="cal-day">${day}</span><span class="cal-mark">${mark}</span></span>
      ${weightHtml}
      ${mealsDotsHtml(iso)}
    </div>`;
  }
  grid.innerHTML = html;

  grid.querySelectorAll(".cal-cell[data-date]").forEach((cell) =>
    cell.addEventListener("click", () => openDayModal(cell.dataset.date))
  );
}

function renderPredict() {
  const box = document.getElementById("cycle-predict");
  const hint = document.getElementById("cycle-calc-hint");
  const avg = averageCycle();
  hint.textContent = avg
    ? `기록을 바탕으로 계산된 평균 주기: 약 ${avg}일 (자동 반영됨)`
    : "월경 시작일을 2회 이상 기록하면 평균 주기를 자동 계산합니다.";

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

function renderCalendarView() { renderCalendar(); renderPredict(); }

/* ============================================================
   날짜 상세 모달 (몸무게 · 식사 · 월경)
   ============================================================ */
const dayModal = document.getElementById("day-modal");
const dayWeight = document.getElementById("day-weight");
const dayPeriodToggle = document.getElementById("day-period-toggle");
const dayCycleInfo = document.getElementById("day-cycle-info");
let selectedDate = null;

function openDayModal(iso) {
  selectedDate = iso;
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

  dayModal.hidden = false;
}

function closeDayModal() { dayModal.hidden = true; selectedDate = null; }
document.getElementById("day-modal-close").addEventListener("click", closeDayModal);
dayModal.addEventListener("click", (e) => { if (e.target === dayModal) closeDayModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !dayModal.hidden) closeDayModal(); });

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

  const map = buildCycleMap();
  const type = map[iso];
  const desc = { period: "월경일", predicted: "예상 월경일", fertile: "가임기", ovulation: "배란일" }[type];
  dayCycleInfo.textContent = desc ? `이 날의 주기 상태: ${desc}` : "";
}

dayPeriodToggle.addEventListener("click", () => {
  if (!selectedDate) return;
  const idx = db.periods.indexOf(selectedDate);
  if (idx >= 0) db.periods.splice(idx, 1);
  else { db.periods.push(selectedDate); db.periods.sort(); }

  const avg = averageCycle();
  if (avg) { db.settings.cycleLength = avg; cycleLengthInput.value = avg; }

  saveDB();
  updatePeriodToggle(selectedDate);
  renderCalendarView();
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
    grid += `<line x1="${pad}" y1="${gy}" x2="${W - pad}" y2="${gy}" stroke="#f1d4e5" stroke-width="1"/>`;
    grid += `<text x="${pad - 6}" y="${gy + 4}" text-anchor="end" fill="#9ca3af" font-size="10">${gv}</text>`;
  }

  const linePts = data.map((d, i) => `${x(i)},${y(d.kg)}`).join(" ");
  const areaPts = `${pad},${H - pad} ${linePts} ${x(n - 1)},${H - pad}`;

  let dots = "";
  data.forEach((d, i) => {
    dots += `<circle cx="${x(i)}" cy="${y(d.kg)}" r="3.5" fill="#ec4899"/>`;
    if (n <= 12 || i === 0 || i === n - 1) {
      const dd = fromISO(d.date);
      dots += `<text x="${x(i)}" y="${H - pad + 16}" text-anchor="middle" fill="#9ca3af" font-size="9">${dd.getMonth()+1}/${dd.getDate()}</text>`;
    }
  });

  svg.innerHTML = `
    ${grid}
    <polygon points="${areaPts}" fill="#fce7f3" opacity="0.7"/>
    <polyline points="${linePts}" fill="none" stroke="#ec4899" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
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

/* ============================================================
   데이터 내보내기 / 가져오기
   ============================================================ */
document.getElementById("export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `health-diary-${todayISO()}.json`; a.click();
  URL.revokeObjectURL(url);
});
document.getElementById("import-btn").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      db = Object.assign(defaultData(), imported);
      saveDB();
      initAll();
      alert("데이터를 가져왔습니다.");
    } catch (err) { alert("올바른 파일이 아닙니다."); }
  };
  reader.readAsText(file);
});

/* ---------- 초기 렌더 ---------- */
function initAll() {
  cycleLengthInput.value = db.settings.cycleLength;
  periodLengthInput.value = db.settings.periodLength;
  calView = new Date(); calView.setDate(1);
  renderCalendarView();
  renderTrends();
}
initAll();
