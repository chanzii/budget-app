import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
  Cell,
} from "recharts";

// 가계부 웹앱 MVP (찬진님 사양)
// - 월 단위 예산관리(이월 없음)
// - 상위 카테고리: 소비/저축/기타 (그래프/요약은 "소비"만)
// - 세부 항목 자유 추가/삭제
// - 홈: 소비 레포트(항목별 집행률 0~100%), 소비 합계/잔액, 즉시 지출 기입칸
// - 하단 탭: 소비내역 / 예산계획 / 월별 데이터 / 설정
// - 수동 입력 위주, 로컬 저장(localStorage)
// - 월 시작일은 설정에서 지정(변경 시 다음 달부터 적용)

// ===== 공통 타입 =====
type TopCategory = "소비" | "저축" | "기타";
type TabId = "home" | "list" | "budget" | "monthly" | "settings";
type Tx = {
  id: string;
  date: string; // YYYY-MM-DD
  top: TopCategory; // 상위 카테고리
  item: string; // 세부 항목
  amount: number; // 지출 양수
  memo?: string;
};

type BudgetItem = {
  id: string;
  top: TopCategory;
  name: string; // 세부 항목명
  plan: number; // 계획 금액
};

type Settings = {
  startDay: number; // 1~31 (기본 1)
  startDayTakesEffectNextMonth: boolean; // true: 다음 달부터 적용
};

type AppState = {
  budgets: Record<string, BudgetItem[]>; // key: YYYY-MM
  txs: Tx[]; // 모든 거래 (월 필터로 보기)
  settings: Settings;
};

const LS_KEY = "budgetbook_spec_v2";

// ===== 유틸 =====
const KRW = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});
const COLORS = [
  "#60a5fa",
  "#34d399",
  "#f472b6",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
  "#22d3ee",
  "#c084fc",
  "#f59e0b",
  "#10b981",
]; // 항목별 색상 팔레트
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function todayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function ym(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function startEndOfMonth(yearMonth: string, startDay: number) {
  // 해당 달의 실제 마지막 날 기반으로 29~31일도 정확히 처리
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const startD = Math.min(startDay, lastDay);
  const start = new Date(y, m - 1, startD);
  const end = new Date(y, m - 1, startD);
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function parseDate(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}


// (추가) 캘린더 헬퍼
function daysInMonth(y: number, m: number) {
  return new Date(y, m, 0).getDate(); // m: 1~12
}
function firstDayOfWeek(y: number, m: number) {
  return new Date(y, m - 1, 1).getDay(); // 0(일)~6(토)
}
function loadState(): AppState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) throw new Error("empty");
    return JSON.parse(raw) as AppState;
  } catch {
    // 초기값: 소비 항목 3개 샘플
    const initMonth = ym(new Date());
    return {
      budgets: {
        [initMonth]: [
          { id: uid(), top: "소비", name: "식비", plan: 300000 },
          { id: uid(), top: "소비", name: "생활비", plan: 300000 },
          { id: uid(), top: "소비", name: "공과금", plan: 100000 },
        ],
      },
      txs: [],
      settings: { startDay: 1, startDayTakesEffectNextMonth: true },
    };
  }
}
function saveState(s: AppState) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

// ===== 공용 컴포넌트 =====
function Section({
  title,
  children,
  right,
}: {
  title: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="mb-4 rounded-2xl border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-slate-600">{label}</span>
      {children}
    </label>
  );
}

// 🔧 (수정) TabBar의 타입을 TabId/Dispatch로
function TabBar({
  value,
  onChange,
}: {
  value: TabId;
  onChange: React.Dispatch<React.SetStateAction<TabId>>;
}) {
  const items: { id: TabId; label: string }[] = [
    { id: "home", label: "소비레포트" },
    { id: "list", label: "소비내역" },
    { id: "budget", label: "예산계획" },
    { id: "monthly", label: "월별 데이터" },
    { id: "settings", label: "설정" },
  ];
  return (
    <nav className="sticky bottom-0 z-10 mt-4 grid grid-cols-4 gap-2 border-t bg-white/95 px-2 py-2 sm:grid-cols-4">
      {items
        .filter((i) => i.id !== "home")
        .map((i) => (
          <button
            key={i.id}
            onClick={() => onChange(i.id)}
            className={`rounded-xl px-3 py-2 text-sm ${
              value === i.id ? "bg-black text-white" : "border"
            }`}
          >
            {i.label}
          </button>
        ))}
    </nav>
  );
}

// ===== 메인 컴포넌트 =====
export default function BudgetApp() {
  const [state, setState] = useState<AppState>(loadState());
  // 🔧 (수정) 탭 상태 타입을 TabId로 통일
  const [tab, setTab] = useState<TabId>("home");
const [filterItem, setFilterItem] = useState<string | null>(null);
const [filterDate, setFilterDate] = useState<string | null>(null);
  const [month, setMonth] = useState<string>(() => ym(new Date()));

  useEffect(() => saveState(state), [state]);

  // 새 달에 들어가면 직전 달의 예산 항목을 자동 복사 (이월 금액 아님, 항목/계획만)
  useEffect(() => {
    const list = state.budgets[month];
    if (!list || list.length === 0) {
      const keys = Object.keys(state.budgets).sort();
      const prevKey = keys.filter((k) => k < month).pop();
      if (prevKey) {
        const copied = (state.budgets[prevKey] || []).map((b) => ({
          id: uid(),
          top: b.top,
          name: b.name,
          plan: b.plan,
        }));
        setState((prev) => ({
          ...prev,
          budgets: { ...prev.budgets, [month]: copied },
        }));
      }
    }
  }, [month]);

  const monthBudgets = useMemo(
    () => state.budgets[month] || [],
    [state.budgets, month]
  );
  const consumptionItems = useMemo(
    () => monthBudgets.filter((b) => b.top === "소비"),
    [monthBudgets]
  );
  const monthRange = useMemo(
    () => startEndOfMonth(month, state.settings.startDay),
    [month, state.settings.startDay]
  );
  const monthTxs = useMemo(
    () =>
      state.txs.filter((tx) => {
        const d = parseDate(tx.date);
        return d >= monthRange.start && d <= monthRange.end;
      }),
    [state.txs, monthRange]
  );

  const actualByItem = useMemo(() => {
    const map = new Map<string, number>();
    monthTxs
      .filter((t) => t.top === "소비")
      .forEach((tx) => map.set(tx.item, (map.get(tx.item) || 0) + tx.amount));
    return map; // name -> sum
  }, [monthTxs]);

  const chartData = useMemo(
    () =>
      consumptionItems.map((b, idx) => {
        const actual = actualByItem.get(b.name) || 0;
        const rate =
          b.plan > 0 ? Math.min(100, Math.round((actual / b.plan) * 100)) : 0;
        return {
          name: b.name,
          rate,
          actual,
          plan: b.plan,
          color: COLORS[idx % COLORS.length],
        };
      }),
    [consumptionItems, actualByItem]
  );

  const spentSum = useMemo(
    () => chartData.reduce((s, d) => s + d.actual, 0),
    [chartData]
  );
  const planSum = useMemo(
    () => chartData.reduce((s, d) => s + d.plan, 0),
    [chartData]
  );
  const remainSum = Math.max(planSum - spentSum, 0);

  // ===== 홈: 지출 기입칸 =====
  
  

  function addTx(tx: Tx) {
    setState((prev) => ({ ...prev, txs: [{ ...tx, id: uid() }, ...prev.txs] }));
  }
  function removeTx(id: string) {
    setState((prev) => ({ ...prev, txs: prev.txs.filter((t) => t.id !== id) }));
  }

 
  // ===== 예산계획 조작 =====
  function upsertBudgetItem(b: Partial<BudgetItem> & { id?: string }) {
    setState((prev) => {
      const list = prev.budgets[month] ? [...prev.budgets[month]] : [];
      if (b.id) {
        const i = list.findIndex((x) => x.id === b.id);
        if (i >= 0) list[i] = { ...(list[i]), ...b } as BudgetItem;
      } else {
        list.push({
          id: uid(),
          top: (b.top || "소비") as TopCategory,
          name: b.name || "새 항목",
          plan: b.plan || 0,
        });
      }
      return { ...prev, budgets: { ...prev.budgets, [month]: list } };
    });
  }
  function deleteBudgetItem(id: string) {
    setState((prev) => ({
      ...prev,
      budgets: {
        ...prev.budgets,
        [month]: (prev.budgets[month] || []).filter((b) => b.id !== id),
      },
    }));
  }


// ===== 화면들 =====
function HomeView() {
  const dateRef = useRef<HTMLInputElement>(null);
  const itemRef = useRef<HTMLSelectElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const memoRef = useRef<HTMLInputElement>(null);

  function handleSubmit() {
    const date = dateRef.current?.value || todayStr();
    const item = itemRef.current?.value || "";
    const memo = memoRef.current?.value || "";
    const amt = Number(amountRef.current?.value.replace(/[^0-9]/g, ""));
    if (!item) return alert("항목을 선택하세요");
    if (!amt || amt <= 0) return alert("금액을 입력하세요");
    addTx({ id: "", date, top: "소비", item, amount: amt, memo });
    if (amountRef.current) amountRef.current.value = "";
    if (memoRef.current) memoRef.current.value = "";
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border px-3 py-2"
          />
        </div>
      </div>

      <Section
        title="소비 레포트"
        right={<span className="text-sm text-slate-500">항목별 집행률(%)</span>}
      >
        {chartData.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  interval={0}
                  height={100}
                  angle={-60}
                  textAnchor="end"
                  tickMargin={10}
                  tick={{ fontSize: 12 }}
                />
                <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} />
                <Tooltip
                  formatter={(v: any, _n: any, p: any) => [v + "%", p.payload.name]}
                />
                <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4" />
                <Bar dataKey="rate">
                  {chartData.map((d, idx) => (
                    <Cell key={idx} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-500">
            소비 항목이 없습니다. 예산계획에서 항목을 추가하세요.
          </div>
        )}
        <div className="mt-3 text-sm leading-6">
          <div>이달 소비 지출액: <strong>{KRW.format(spentSum)}</strong></div>
          <div>이달 소비 잔액: <strong>{KRW.format(remainSum)}</strong></div>
        </div>
      </Section>

      <Section title="지출 기입 칸">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="날짜">
            <input
              type="date"
              ref={dateRef}
              defaultValue={todayStr()}
              className="w-full rounded-xl border px-3 py-2"
            />
          </Field>

          <Field label="항목(소비)">
            <select
              ref={itemRef}
              defaultValue={consumptionItems[0]?.name || ""}
              className="w-full rounded-xl border px-3 py-2"
            >
              <option value="">선택</option>
              {consumptionItems.map((b) => (
                <option key={b.id} value={b.name}>
                  {b.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="금액">
            <input
              ref={amountRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              className="w-full rounded-xl border px-3 py-2"
              placeholder="예: 50000"
            />
          </Field>

          <Field label="메모(선택)">
            <input
              ref={memoRef}
              type="text"
              autoComplete="off"
              className="w-full rounded-xl border px-3 py-2"
            />
          </Field>

          <div className="flex items-end">
            <button
              type="button"
              onClick={handleSubmit}
              className="w-full rounded-xl bg-black px-4 py-3 text-white hover:opacity-90"
            >
              + 기입하기
            </button>
          </div>
        </div>
      </Section>

      <TabBar value={tab} onChange={setTab} />
    </div>
  );
}

function ListView({
  month,
  txs,
  filterItem,
  onChangeFilter,
  filterDate,
  onChangeDateFilter,
}: {
  month: string;
  txs: Tx[];
  filterItem: string | null;
  onChangeFilter: (item: string | null) => void;
  filterDate: string | null;
  onChangeDateFilter: (date: string | null) => void;
}) {
  const range = useMemo(
    () => startEndOfMonth(month, state.settings.startDay),
    [month, state.settings.startDay]
  );

  // 이 달 + 소비만
  const baseTxs = useMemo(() => {
    return txs.filter((t) => {
      const d = parseDate(t.date);
      return t.top === "소비" && d >= range.start && d <= range.end;
    });
  }, [txs, range]);

  // 드롭다운 옵션(항목 목록)
  const itemOptions = useMemo(() => {
    return Array.from(new Set(baseTxs.map((t) => t.item))).sort((a, b) =>
      a.localeCompare(b, "ko")
    );
  }, [baseTxs]);

  // 최종 표시 목록: 날짜 → 항목 순으로 필터
  const viewTxs = useMemo(() => {
    let arr = baseTxs;
    if (filterDate) arr = arr.filter((t) => t.date === filterDate);
    if (filterItem) arr = arr.filter((t) => t.item === filterItem);
    return arr;
  }, [baseTxs, filterDate, filterItem]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">소비내역</h2>
        <div className="flex items-center gap-2">
          {/* 항목 필터 */}
          <select
            className="rounded-xl border px-3 py-2"
            value={filterItem ?? ""}
            onChange={(e) =>
              onChangeFilter(e.target.value === "" ? null : e.target.value)
            }
          >
            <option value="">전체 항목</option>
            {itemOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>

          {/* 활성화된 필터 표시/해제 */}
          {(filterDate || filterItem) && (
            <button
              className="rounded-xl border px-2 py-1 text-sm"
              onClick={() => {
                onChangeFilter(null);
                onChangeDateFilter(null);
              }}
            >
              필터 해제
            </button>
          )}
        </div>
      </div>

      {/* 날짜 필터 배지(있을 때만) */}
      {filterDate && (
        <div className="mb-2 text-sm text-slate-600">
          날짜: <span className="font-medium">{filterDate}</span>
        </div>
      )}

      <div className="rounded-2xl border">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-3 py-2">날짜</th>
              <th className="px-3 py-2">항목</th>
              <th className="px-3 py-2 text-right">금액</th>
              <th className="px-3 py-2">메모</th>
              <th className="px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {viewTxs.map((t) => (
              <tr key={t.id} className="border-t">
                <td className="px-3 py-2 whitespace-nowrap">{t.date}</td>
                <td className="px-3 py-2 whitespace-nowrap">{t.item}</td>
                <td className="px-3 py-2 whitespace-nowrap text-right font-semibold">
                  {KRW.format(t.amount)}
                </td>
                <td className="px-3 py-2">{t.memo}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeTx(t.id)}
                    className="rounded-lg border px-2 py-1 hover:bg-slate-50"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {viewTxs.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                  내역이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <button
          onClick={() => setTab("home")}
          className="rounded-xl border px-4 py-3"
        >
          ⓧ 홈으로
        </button>
      </div>
      <TabBar value="list" onChange={setTab} />
    </div>
  );
}


  function BudgetView() {
    const list = monthBudgets;
    const [newTop, setNewTop] = useState<TopCategory>("소비");
    const [newName, setNewName] = useState("");
    const [newPlan, setNewPlan] = useState("");

    const actualByBudgetId = useMemo(() => {
      const map = new Map<string, number>();
      list.forEach((b) => {
        map.set(b.id, 0);
      });
      monthTxs
        .filter((t) => t.top !== undefined)
        .forEach((tx) => {
          const b = list.find((b) => b.top === tx.top && b.name === tx.item);
          if (b) map.set(b.id, (map.get(b.id) || 0) + tx.amount);
        });
      return map;
    }, [list, monthTxs]);

    // 입력 중엔 로컬 상태에만 반영 → onBlur 때 한 번 저장(커서 튐 방지)
    const [editingName, setEditingName] = useState<Record<string, string>>({});
    const [editingPlan, setEditingPlan] = useState<Record<string, string>>({});
    const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const planRefs = useRef<Record<string, HTMLInputElement | null>>({});

    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">예산계획</h2>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border px-3 py-2"
          />
        </div>

        {/* === [모바일/데스크톱 반응형] 항목 목록 === */}
<Section title="항목 목록">
  {/* 휴대폰에선 컴팩트 폰트/패딩, 데스크톱은 기존 크기 유지 */}
  <div className="-mx-2 overflow-x-auto sm:mx-0">
   <table className="min-w-[640px] sm:min-w-full text-xs sm:text-sm table-fixed">
 <colgroup>
  <col className="w-[56px] sm:w-[72px]" />      {/* 상위 */}
  <col className="w-[160px] sm:w-auto" />       {/* 항목명: ↓ 줄였음 */}
  <col className="w-[120px]" />                 {/* 계획 */}
  <col className="w-[140px]" />                 {/* 실제 */}
  <col className="w-[140px]" />                 {/* 잔액 */}
  <col className="w-[80px] sm:w-[100px]" />     {/* 관리 */}
</colgroup>

      <thead className="bg-slate-50 text-left">
        <tr>
          <th className="px-2 py-2 sm:px-3 sm:py-2">상위</th>
          <th className="px-2 py-2 sm:px-3 sm:py-2">항목명</th>
          <th className="px-2 py-2 text-right sm:px-3 sm:py-2">계획</th>
          <th className="px-2 py-2 text-right sm:px-3 sm:py-2">실제(해당 월)</th>
          <th className="px-2 py-2 text-right sm:px-3 sm:py-2">잔액</th>
          <th className="px-2 py-2 sm:px-3 sm:py-2">관리</th>
        </tr>
      </thead>

      <tbody>
        {list.map(b => {
          const actual = actualByBudgetId.get(b.id) || 0;
          const remain = Math.max(b.plan - actual, 0);
          const over = actual > b.plan;

          return (
            <tr key={b.id} className="border-t align-middle">
              {/* 상위 */}
              <td className="px-2 py-2 sm:px-3 sm:py-2 whitespace-nowrap">{b.top}</td>

              {/* 항목명: 모바일에선 줄바꿈 허용해 전체 표시, 데스크톱은 한 줄 */}
              <td className="px-2 py-2 sm:px-3 sm:py-2">
                <input
                  ref={el => { nameRefs.current[b.id] = el; }}
                  value={editingName[b.id] ?? b.name}
                  onFocus={() =>
                    setEditingName(prev => (prev[b.id] === undefined ? { ...prev, [b.id]: b.name } : prev))
                  }
                  onChange={e => setEditingName(prev => ({ ...prev, [b.id]: e.target.value }))}
                  onBlur={() => {
                    const val = editingName[b.id];
                    if (val !== undefined && val !== b.name) upsertBudgetItem({ id: b.id, name: val });
                    setEditingName(prev => { const cp = { ...prev }; delete cp[b.id]; return cp; });
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      setEditingName(prev => { const cp = { ...prev }; delete cp[b.id]; return cp; });
                      nameRefs.current[b.id]?.blur?.();
                    }
                  }}
                  className="w-full rounded-lg border px-1.5 py-1 text-[13px] sm:text-base leading-tight sm:whitespace-nowrap break-words"
                />
              </td>

              {/* 계획 입력칸: 모바일 좁은 폭 */}
              <td className="px-2 py-2 sm:px-3 sm:py-2 text-right">
                <input
                  ref={el => { planRefs.current[b.id] = el; }}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={editingPlan[b.id] ?? String(b.plan)}
                  onFocus={() =>
                    setEditingPlan(prev => (prev[b.id] === undefined ? { ...prev, [b.id]: String(b.plan) } : prev))
                  }
                  onChange={e => {
                    const digits = e.target.value.replace(/[^0-9]/g, "");
                    setEditingPlan(prev => ({ ...prev, [b.id]: digits }));
                  }}
                  onBlur={() => {
                    const val = editingPlan[b.id];
                    if (val !== undefined && String(b.plan) !== val) upsertBudgetItem({ id: b.id, plan: Number(val || 0) });
                    setEditingPlan(prev => { const cp = { ...prev }; delete cp[b.id]; return cp; });
                  }}
                  onKeyDown={e => {
                    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      setEditingPlan(prev => { const cp = { ...prev }; delete cp[b.id]; return cp; });
                      planRefs.current[b.id]?.blur?.();
                    }
                  }}
                  className="w-24 sm:w-28 rounded-lg border px-2 py-1 text-right text-sm sm:text-base"
                />
              </td>

              {/* 실제/잔액: 모바일에선 더 작게, 줄바꿈 없이 */}
              <td className="px-2 py-2 sm:px-3 sm:py-2 text-right whitespace-nowrap">
                <span className="font-medium tracking-tight text-[13px] sm:text-base">
                  {KRW.format(actual)}
                </span>
              </td>
              <td className="px-2 py-2 sm:px-3 sm:py-2 text-right whitespace-nowrap">
                <span className="font-medium tracking-tight text-[13px] sm:text-base">
                  {KRW.format(remain)}
                </span>
              </td>

              {/* 관리 */}
              <td className="px-2 py-2 sm:px-3 sm:py-2">
                <button
                  onClick={() => deleteBudgetItem(b.id)}
                  className="rounded-lg border px-2 py-1 hover:bg-slate-50 text-[12px] sm:text-sm"
                >
                  삭제
                </button>
                {over && (
                  <span className="ml-1 sm:ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] sm:text-xs text-rose-700">
                    100% 초과
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
</Section>


        <Section title="항목 추가">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              upsertBudgetItem({
                top: newTop,
                name: newName || "새 항목",
                plan: Number(newPlan || 0),
              });
              setNewName("");
              setNewPlan("");
            }}
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            <Field label="상위">
              <select
                value={newTop}
                onChange={(e) => setNewTop(e.target.value as TopCategory)}
                className="w-full rounded-xl border px-3 py-2"
              >
                <option>소비</option>
                <option>저축</option>
                <option>기타</option>
              </select>
            </Field>
            <Field label="항목명">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
              />
            </Field>
            <Field label="계획금액">
              <input
                type="number"
                min={0}
                value={newPlan}
                onChange={(e) => setNewPlan(e.target.value)}
                className="w-full rounded-xl border px-3 py-2"
              />
            </Field>
            <div className="col-span-2 flex items-end">
              <button className="w-full rounded-xl bg-black px-4 py-3 text-white hover:opacity-90 sm:w-auto">
                + 추가
              </button>
            </div>
          </form>
        </Section>

        <div className="mt-4">
          <button
            onClick={() => setTab("home")}
            className="rounded-xl border px-4 py-3"
          >
            ⓧ 홈으로
          </button>
        </div>
        <TabBar value="budget" onChange={setTab} />
      </div>
    );
  }

 function MonthlyView() {
  // 1) 캘린더 계산 (return 위, 함수 안)
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const dcount = daysInMonth(y, m);
  const first = firstDayOfWeek(y, m);

  // 이 달 소비 tx
  const monthConsumption = useMemo(() => {
    return monthTxs.filter((t) => t.top === "소비");
  }, [monthTxs]);

  // 날짜별 합계
  const byDate = useMemo(() => {
    const map = new Map<string, number>();
    monthConsumption.forEach((t) => {
      map.set(t.date, (map.get(t.date) || 0) + t.amount);
    });
    return map;
  }, [monthConsumption]);

  // 캘린더 셀
  const cells: { label: string; date?: string; sum?: number }[] = [];
  for (let i = 0; i < first; i++) cells.push({ label: "" });
  for (let d = 1; d <= dcount; d++) {
    const ds = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ label: String(d), date: ds, sum: byDate.get(ds) || 0 });
  }
  while (cells.length % 7 !== 0) cells.push({ label: "" });

  // 2) JSX 시작
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">월별 데이터</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-xl border px-3 py-2"
        />
      </div>

      {/* 캘린더 섹션 */}
      <Section title="월 캘린더(일별 합계)">
        <div className="grid grid-cols-7 gap-1 text-center text-sm">
          {["일","월","화","수","목","금","토"].map((w) => (
            <div key={w} className="py-1 text-slate-500">{w}</div>
          ))}
          {cells.map((c, idx) => {
            const clickable = !!c.date;
            return (
              <button
                key={idx}
                disabled={!clickable}
                onClick={() => {
                  if (!c.date) return;
                  setFilterDate(c.date);  // 날짜 필터 지정
                  setFilterItem(null);    // 항목 필터 초기화(원하면 유지 가능)
                  setTab("list");         // 소비내역으로 이동
                }}
             className={
  "h-16 p-1 min-w-0 rounded-lg border flex flex-col items-center justify-center overflow-hidden " +
  (clickable ? "hover:bg-slate-50" : "bg-slate-50/40 text-slate-400")
}
              >
                <div className="text-[11px] leading-none text-slate-500">{c.label}</div>
              {(() => {
  const sum = c.sum || 0;
  // 10만 이하는 축약 없이 전부 표시
  const text = sum <= 100000 ? KRW.format(sum)
                             : (sum >= 100000000 ? Math.round(sum/100000000) + "억"
                                                 : Math.round(sum/10000) + "만");
  // 10만 이하는 글자수에 따라 조금 더 줄임
  const digitLen = String(sum).length;
  const fontSize = sum <= 100000 ? (digitLen >= 6 ? 9 : 10) : 10;

  return (
    <div
      className={
        "mt-1 w-full px-1 leading-tight font-semibold text-center whitespace-nowrap " +
        (sum > 0 ? "text-rose-600" : "text-slate-400")
      }
      style={{ fontSize }}
    >
      {c.date ? (sum ? text : "0원") : ""}
    </div>
  );
})()}

              </button>
            );
          })}
        </div>
      </Section>

      {/* 기존 섹션 1: 항목별 지출(해당 월) */}
      <Section title="항목별 지출(해당 월)">
        <ul className="divide-y rounded-2xl border">
          {chartData.map((d) => (
            <li
              key={d.name}
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-slate-50"
              onClick={() => {
                setFilterItem(d.name);
                setTab("list");
              }}
            >
              <span className="truncate pr-3 text-sm">{d.name}</span>
              <span className="whitespace-nowrap font-semibold">
                {KRW.format(d.actual)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
          <span className="text-slate-600">합계</span>
          <span className="text-lg font-bold">{KRW.format(spentSum)}</span>
        </div>
      </Section>

      {/* 기존 섹션 2: 항목별 집행률(%) */}
      <Section title="항목별 집행률(%)">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="name"
                interval={0}
                height={80}
                tick={(props: any) => {
                  const { x, y, payload } = props;
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy={16} textAnchor="end" transform="rotate(-60)" style={{ fontSize: 12 }}>
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
              />
              <YAxis domain={[0, 100]} />
              <Tooltip
                formatter={(v: any, n: any, p: any) => {
                  void n;
                  return [v + "%", p.payload.name];
                }}
              />
              <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4" />
              <Bar dataKey="rate">
                {chartData.map((e, idx) => (
                  <Cell key={`c-${idx}`} fill={e.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <div className="mt-4">
        <button onClick={() => setTab("home")} className="rounded-xl border px-4 py-3">
          ⓧ 홈으로
        </button>
      </div>
      <TabBar value="monthly" onChange={setTab} />
    </div>
  );
}


  function SettingsView() {
    const [startDay, setStartDay] = useState<number>(state.settings.startDay);
    return (
      <div>
        <h2 className="mb-4 text-lg font-semibold">설정</h2>
        <Section title="월 시작 기준일">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={startDay}
              onChange={(e) => setStartDay(Number(e.target.value))}
              className="rounded-xl border px-3 py-2"
            >
              {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}일
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                setState((prev) => ({
                  ...prev,
                  settings: {
                    ...prev.settings,
                    startDay,
                    startDayTakesEffectNextMonth: true,
                  },
                }));
                alert("월 시작일이 저장되었습니다. 다음 달부터 적용됩니다.");
              }}
              className="rounded-xl bg-black px-4 py-2 text-white"
            >
              저장
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            변경 사항은 다음 달부터 적용됩니다. (이월 없음)
          </p>
        </Section>

        <Section title="데이터">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                if (!confirm("예시 데이터를 추가할까요?")) return;
                const baseMonth = month;
                const sample: Tx[] = [
                  {
                    id: "",
                    date: `${baseMonth}-01`,
                    top: "소비",
                    item: "식비",
                    amount: 3300,
                  },
                  {
                    id: "",
                    date: `${baseMonth}-02`,
                    top: "소비",
                    item: "생활비",
                    amount: 39000,
                  },
                  {
                    id: "",
                    date: `${baseMonth}-04`,
                    top: "소비",
                    item: "공과금",
                    amount: 23100,
                  },
                ];
                setState((prev) => ({
                  ...prev,
                  txs: [...sample.map((s) => ({ ...s, id: uid() })), ...prev.txs],
                }));
                alert("예시 데이터가 추가되었습니다.");
              }}
              className="rounded-xl border px-3 py-2"
            >
              예시 데이터 추가
            </button>
            <button
              onClick={() => {
                if (!confirm("모든 데이터를 초기화할까요?")) return;
                localStorage.removeItem(LS_KEY);
                location.reload();
              }}
              className="rounded-xl border px-3 py-2"
            >
              전체 초기화
            </button>
          </div>
        </Section>

        <div className="mt-4">
          <button
            onClick={() => setTab("home")}
            className="rounded-xl border px-4 py-3"
          >
            ⓧ 홈으로
          </button>
        </div>
        <TabBar value="settings" onChange={setTab} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-8">
      <header className="mb-4 flex flex-col justify-between gap-3 sm:mb-6 sm:flex-row sm:items-end">
        <h1 className="text-2xl font-bold">가계부</h1>
        <div className="text-sm text-slate-500">
          월 단위 예산 · 이월 없음 · 수동 입력
        </div>
      </header>

      {tab === "home" && <HomeView />}
      {tab === "list" && (
<ListView
  month={month}
  txs={state.txs}
  filterItem={filterItem}
  onChangeFilter={setFilterItem}
  filterDate={filterDate}
  onChangeDateFilter={setFilterDate}
/>
)}
      {tab === "budget" && <BudgetView />}
      {tab === "monthly" && <MonthlyView />}
      {tab === "settings" && <SettingsView />}
    </div>
  );
}
