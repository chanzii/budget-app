import React, { useEffect, useMemo, useRef, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Cell } from "recharts";

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
 const KRW = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });
 const COLORS = ["#60a5fa", "#34d399", "#f472b6", "#fbbf24", "#a78bfa", "#fb7185", "#22d3ee", "#c084fc", "#f59e0b", "#10b981"]; // 항목별 색상 팔레트
 function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
 function todayStr() {
   const d = new Date();
   const yyyy = d.getFullYear();
   const mm = String(d.getMonth() + 1).padStart(2, "0");
   const dd = String(d.getDate()).padStart(2, "0");
   return `${yyyy}-${mm}-${dd}`;
 }
 function ym(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
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
 function parseDate(s: string) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }

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
 function saveState(s: AppState) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

 // ===== 공용 컴포넌트 =====
 function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
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
 function Field({ label, children }: { label: string; children: React.ReactNode }) {
   return (
     <label className="flex flex-col gap-1">
       <span className="text-sm text-slate-600">{label}</span>
       {children}
     </label>
   );
 }
 function TabBar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
   const items = [
     { id: "home", label: "소비레포트" },
     { id: "list", label: "소비내역" },
     { id: "budget", label: "예산계획" },
     { id: "monthly", label: "월별 데이터" },
     { id: "settings", label: "설정" },
   ];
   return (
     <nav className="sticky bottom-0 z-10 mt-4 grid grid-cols-4 gap-2 border-t bg-white/95 px-2 py-2 sm:grid-cols-4">
       {items.filter((i)=>i.id!=="home").map((i) => (
         <button key={i.id} onClick={() => onChange(i.id)} className={`rounded-xl px-3 py-2 text-sm ${value===i.id?"bg-black text-white":"border"}`}>{i.label}</button>
       ))}
     </nav>
   );
 }

 // ===== 메인 컴포넌트 =====
 export default function BudgetApp() {
   const [state, setState] = useState<AppState>(loadState());
   const [tab, setTab] = useState<"home" | "list" | "budget" | "monthly" | "settings">("home");
   const [month, setMonth] = useState<string>(() => ym(new Date()));

   useEffect(() => saveState(state), [state]);

   // 새 달에 들어가면 직전 달의 예산 항목을 자동 복사 (이월 금액 아님, 항목/계획만)
   useEffect(() => {
     const list = state.budgets[month];
     if (!list || list.length === 0) {
       const keys = Object.keys(state.budgets).sort();
       const prevKey = keys.filter(k => k < month).pop();
       if (prevKey) {
         const copied = (state.budgets[prevKey] || []).map(b => ({ id: uid(), top: b.top, name: b.name, plan: b.plan }));
         setState(prev => ({ ...prev, budgets: { ...prev.budgets, [month]: copied } }));
       }
     }
   }, [month]);

   const monthBudgets = useMemo(() => state.budgets[month] || [], [state.budgets, month]);
   const consumptionItems = useMemo(() => monthBudgets.filter(b => b.top === "소비"), [monthBudgets]);
   const monthRange = useMemo(() => startEndOfMonth(month, state.settings.startDay), [month, state.settings.startDay]);
   const monthTxs = useMemo(() => state.txs.filter(tx => {
     const d = parseDate(tx.date);
     return d >= monthRange.start && d <= monthRange.end;
   }), [state.txs, monthRange]);

   const actualByItem = useMemo(() => {
     const map = new Map<string, number>();
     monthTxs.filter(t=>t.top==="소비").forEach(tx => map.set(tx.item, (map.get(tx.item)||0) + tx.amount));
     return map; // name -> sum
   }, [monthTxs]);

   const chartData = useMemo(() => consumptionItems.map((b, idx) => {
     const actual = actualByItem.get(b.name) || 0;
     const rate = b.plan > 0 ? Math.min(100, Math.round((actual / b.plan) * 100)) : 0;
     return { name: b.name, rate, actual, plan: b.plan, color: COLORS[idx % COLORS.length] };
   }), [consumptionItems, actualByItem]);

   const spentSum = useMemo(() => chartData.reduce((s, d) => s + d.actual, 0), [chartData]);
   const planSum = useMemo(() => chartData.reduce((s, d) => s + d.plan, 0), [chartData]);
   const remainSum = Math.max(planSum - spentSum, 0);

   // ===== 홈: 지출 기입칸 =====
   const [quick, setQuick] = useState<{date: string; item: string; amount: string; memo: string}>({ date: todayStr(), item: consumptionItems[0]?.name || "", amount: "", memo: "" });
   const amountRef = useRef<HTMLInputElement>(null);
   const memoRef = useRef<HTMLInputElement>(null);
   useEffect(()=>{ // 월/항목 변경 시 기본값 보정
     setQuick(q=>({ ...q, item: q.item || consumptionItems[0]?.name || "" }));
   },[consumptionItems.length]);

   function addTx(tx: Tx) { setState(prev => ({ ...prev, txs: [{ ...tx, id: uid() }, ...prev.txs] })); }
   function removeTx(id: string) { setState(prev => ({ ...prev, txs: prev.txs.filter(t=>t.id!==id) })); }

   function handleQuickSubmit(e: React.FormEvent) {
     e.preventDefault();
     const amt = Number(String(quick.amount).replace(/[^0-9]/g, ""));
     if (!quick.item) return alert("항목을 선택하세요");
     if (!amt || amt <= 0) return alert("금액을 입력하세요");
     addTx({ id: "", date: quick.date, top: "소비", item: quick.item, amount: amt, memo: quick.memo });
     setQuick({ date: quick.date, item: quick.item, amount: "", memo: "" });
   }

   // ===== 예산계획 조작 =====
   function upsertBudgetItem(b: Partial<BudgetItem> & { id?: string }) {
     setState(prev => {
       const list = prev.budgets[month] ? [...prev.budgets[month]] : [];
       if (b.id) {
         const i = list.findIndex(x=>x.id===b.id);
         if (i>=0) list[i] = { ...(list[i]), ...b } as BudgetItem;
       } else {
         list.push({ id: uid(), top: (b.top||"소비") as TopCategory, name: b.name||"새 항목", plan: b.plan||0 });
       }
       return { ...prev, budgets: { ...prev.budgets, [month]: list } };
     });
   }
   function deleteBudgetItem(id: string) {
     setState(prev => ({ ...prev, budgets: { ...prev.budgets, [month]: (prev.budgets[month]||[]).filter(b=>b.id!==id) } }));
   }

   // ===== 화면들 =====
   function HomeView() {
     return (
       <div className="space-y-4">
         <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
           <div className="flex items-center gap-2">
             <input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} className="rounded-xl border px-3 py-2" />
           </div>
         </div>

         <Section title="소비 레포트" right={<span className="text-sm text-slate-500">항목별 집행률(%)</span>}>
           {chartData.length>0 ? (
             <div className="h-64 w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                   <CartesianGrid strokeDasharray="3 3" />
                   <XAxis dataKey="name" interval={0} height={50} angle={0} tick={{ fontSize: 12 }} />
                   <YAxis domain={[0, 100]} ticks={[0,25,50,75,100]} />
                   <Tooltip formatter={(v: any, n: any, p: any)=> [v+"%", p.payload.name]} />
                   <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4" />
                   <Bar dataKey="rate">
                    {chartData.map((d, idx)=> (<Cell key={idx} fill={d.color} />))}
                   </Bar>
                 </BarChart>
               </ResponsiveContainer>
             </div>
           ) : (
             <div className="py-8 text-center text-slate-500">소비 항목이 없습니다. 예산계획에서 항목을 추가하세요.</div>
           )}
           <div className="mt-3 text-sm leading-6">
             <div>이달 소비 지출액: <strong>{KRW.format(spentSum)}</strong></div>
             <div>이달 소비 잔액: <strong>{KRW.format(remainSum)}</strong></div>
           </div>
         </Section>

         <Section title="지출 기입 칸">
           <form onSubmit={handleQuickSubmit} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
             <Field label="날짜">
               <input type="date" value={quick.date} onChange={(e)=>setQuick(v=>({...v, date:e.target.value}))} className="w-full rounded-xl border px-3 py-2" />
             </Field>
             <Field label="항목(소비)">
               <select value={quick.item} onChange={(e)=>setQuick(v=>({...v, item:e.target.value}))} className="w-full rounded-xl border px-3 py-2">
                 <option value="">선택</option>
                 {consumptionItems.map(b=> <option key={b.id} value={b.name}>{b.name}</option>)}
               </select>
             </Field>
             <Field label="금액">
               <input
                 ref={amountRef}
                 type="text"
                 inputMode="numeric"
                 pattern="[0-9]*"
                 value={quick.amount}
                 onChange={(e)=>{
                   const digits = e.target.value.replace(/[^0-9]/g, "");
                   setQuick(v=>({ ...v, amount: digits }));
                   requestAnimationFrame(()=>{
                     const el = amountRef.current; if (!el) return; const pos = el.value.length; el.focus(); el.setSelectionRange(pos, pos);
                   });
                 }}
                 onPaste={(e)=>{ const t = (e.clipboardData.getData('text')||'').replace(/[^0-9]/g,''); e.preventDefault(); setQuick(v=>({...v, amount:t})); requestAnimationFrame(()=>{ const el=amountRef.current; if(el){ const pos = el.value.length; el.focus(); el.setSelectionRange(pos,pos);} }); }}
                 onKeyDown={(e)=>{ if(e.key==='Enter'){ e.preventDefault(); } }}
                 className="w-full rounded-xl border px-3 py-2"
                 placeholder="예: 50000"
               />
             </Field>
             <Field label="메모(선택)">
               <input
                 ref={memoRef}
                 value={quick.memo}
                 onChange={(e)=>{
                   const val = e.target.value;
                   setQuick(v=>({...v, memo: val}));
                   requestAnimationFrame(()=>{ const el = memoRef.current; if(!el) return; const pos = el.value.length; el.focus(); el.setSelectionRange(pos,pos); });
                 }}
                 className="w-full rounded-xl border px-3 py-2"
               />
             </Field>
             <div className="flex items-end">
               <button className="w-full rounded-xl bg-black px-4 py-3 text-white hover:opacity-90">+ 기입하기</button>
             </div>
           </form>
         </Section>
         <TabBar value={tab} onChange={setTab} />
       </div>
     );
   }

   function ListView() {
     const txs = monthTxs.filter(t=>t.top==="소비");
     return (
       <div>
         <div className="mb-3 flex items-center justify-between">
           <h2 className="text-lg font-semibold">소비내역</h2>
           <input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} className="rounded-xl border px-3 py-2" />
         </div>
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
               {txs.map(t=> (
                 <tr key={t.id} className="border-t">
                   <td className="px-3 py-2 whitespace-nowrap">{t.date}</td>
                   <td className="px-3 py-2 whitespace-nowrap">{t.item}</td>
                   <td className="px-3 py-2 whitespace-nowrap text-right font-semibold">{KRW.format(t.amount)}</td>
                   <td className="px-3 py-2">{t.memo}</td>
                   <td className="px-3 py-2">
                     <button onClick={()=>removeTx(t.id)} className="rounded-lg border px-2 py-1 hover:bg-slate-50">삭제</button>
                   </td>
                 </tr>
               ))}
               {txs.length===0 && (
                 <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-500">내역이 없습니다.</td></tr>
               )}
             </tbody>
           </table>
         </div>
         <div className="mt-4">
           <button onClick={()=>setTab("home")} className="rounded-xl border px-4 py-3">ⓧ 홈으로</button>
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

     const actualByBudgetId = useMemo(()=>{
       const map = new Map<string, number>();
       list.forEach(b=>{ map.set(b.id, 0); });
       monthTxs.filter(t=> t.top!==undefined).forEach(tx=>{
         const b = list.find(b=>b.top===tx.top && b.name===tx.item);
         if (b) map.set(b.id, (map.get(b.id)||0)+tx.amount);
       });
       return map;
     },[list, monthTxs]);

     // 입력 중엔 로컬 상태에만 반영 → onBlur 때 한 번 저장(커서 튐 방지)
     const [editingName, setEditingName] = useState<Record<string,string>>({});
     const [editingPlan, setEditingPlan] = useState<Record<string,string>>({});
     const nameRefs = useRef<Record<string, HTMLInputElement | null>>({});
     const planRefs = useRef<Record<string, HTMLInputElement | null>>({});

     return (
       <div>
         <div className="mb-3 flex items-center justify-between">
           <h2 className="text-lg font-semibold">예산계획</h2>
           <input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} className="rounded-xl border px-3 py-2" />
         </div>

         <Section title="항목 목록">
           <div className="overflow-x-auto">
             <table className="min-w-full text-sm">
               <thead className="bg-slate-50 text-left">
                 <tr>
                   <th className="px-3 py-2">상위</th>
                   <th className="px-3 py-2">항목명</th>
                   <th className="px-3 py-2 text-right">계획</th>
                   <th className="px-3 py-2 text-right">실제(해당 월)</th>
                   <th className="px-3 py-2 text-right">잔액</th>
                   <th className="px-3 py-2">관리</th>
                 </tr>
               </thead>
               <tbody>
                 {list.map(b=> {
                   const actual = actualByBudgetId.get(b.id)||0;
                   const remain = Math.max(b.plan - actual, 0);
                   const over = actual > b.plan;
                   return (
                     <tr key={b.id} className="border-t">
                       <td className="px-3 py-2 whitespace-nowrap">{b.top}</td>
                       <td className="px-3 py-2"><input
                         ref={(el)=>{nameRefs.current[b.id]=el}}
                         value={editingName[b.id] ?? b.name}
                         onFocus={()=> setEditingName(prev=> prev[b.id]===undefined? {...prev, [b.id]: b.name }: prev)}
                         onChange={(e)=> setEditingName(prev=> ({...prev, [b.id]: e.target.value}))}
                         onBlur={()=>{ const val=editingName[b.id]; if(val!==undefined && val!==b.name){ upsertBudgetItem({ id:b.id, name: val }); } setEditingName(prev=>{ const cp={...prev}; delete cp[b.id]; return cp; }); }}
                         onKeyDown={(e)=>{ if(e.key==='Enter'){ (e.currentTarget as HTMLInputElement).blur(); } if(e.key==='Escape'){ setEditingName(prev=>{ const cp={...prev}; delete cp[b.id]; return cp; }); (nameRefs.current[b.id]?.blur?.()); } }}
                         className="w-full rounded-lg border px-2 py-1"/></td>
                       <td className="px-3 py-2 text-right"><input
                         ref={(el)=>{planRefs.current[b.id]=el}}
                         type="text" inputMode="numeric" pattern="[0-9]*"
                         value={editingPlan[b.id] ?? String(b.plan)}
                         onFocus={()=> setEditingPlan(prev=> prev[b.id]===undefined? {...prev, [b.id]: String(b.plan)}: prev)}
                         onChange={(e)=>{ const digits = e.target.value.replace(/[^0-9]/g,''); setEditingPlan(prev=> ({...prev, [b.id]: digits})); }}
                         onBlur={()=>{ const val=editingPlan[b.id]; if(val!==undefined && String(b.plan)!==val){ upsertBudgetItem({ id:b.id, plan: Number(val||0)}); } setEditingPlan(prev=>{ const cp={...prev}; delete cp[b.id]; return cp; }); }}
                         onKeyDown={(e)=>{ if(e.key==='Enter'){ (e.currentTarget as HTMLInputElement).blur(); } if(e.key==='Escape'){ setEditingPlan(prev=>{ const cp={...prev}; delete cp[b.id]; return cp; }); (planRefs.current[b.id]?.blur?.()); } }}
                         className="w-28 rounded-lg border px-2 py-1 text-right"/></td>
                       <td className="px-3 py-2 text-right">{KRW.format(actual)}</td>
                       <td className="px-3 py-2 text-right">{KRW.format(remain)}</td>
                       <td className="px-3 py-2">
                         <button onClick={()=>deleteBudgetItem(b.id)} className="rounded-lg border px-2 py-1 hover:bg-slate-50">삭제</button>
                         {over && <span className="ml-2 rounded-full bg-rose-100 px-2 py-1 text-xs text-rose-700">100% 초과</span>}
                       </td>
                     </tr>
                   );
                 })}
               </tbody>
             </table>
           </div>
         </Section>

         <Section title="항목 추가">
           <form onSubmit={(e)=>{e.preventDefault(); upsertBudgetItem({ top:newTop, name:newName||"새 항목", plan:Number(newPlan||0) }); setNewName(""); setNewPlan(""); }} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
             <Field label="상위">
               <select value={newTop} onChange={(e)=>setNewTop(e.target.value as TopCategory)} className="w-full rounded-xl border px-3 py-2">
                 <option>소비</option>
                 <option>저축</option>
                 <option>기타</option>
               </select>
             </Field>
             <Field label="항목명">
               <input value={newName} onChange={(e)=>setNewName(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
             </Field>
             <Field label="계획금액">
               <input type="number" min={0} value={newPlan} onChange={(e)=>setNewPlan(e.target.value)} className="w-full rounded-xl border px-3 py-2" />
             </Field>
             <div className="col-span-2 flex items-end">
               <button className="w-full rounded-xl bg-black px-4 py-3 text-white hover:opacity-90 sm:w-auto">+ 추가</button>
             </div>
           </form>
         </Section>

         <div className="mt-4">
           <button onClick={()=>setTab("home")} className="rounded-xl border px-4 py-3">ⓧ 홈으로</button>
         </div>
         <TabBar value="budget" onChange={setTab} />
       </div>
     );
   }

   function MonthlyView() {
     return (
       <div>
         <div className="mb-3 flex items-center justify-between">
           <h2 className="text-lg font-semibold">월별 데이터</h2>
           <input type="month" value={month} onChange={(e)=>setMonth(e.target.value)} className="rounded-xl border px-3 py-2" />
         </div>

         <Section title="소비 요약">
           <div className="grid gap-3 sm:grid-cols-3">
             <div className="rounded-2xl bg-slate-50 p-4">
               <div className="text-slate-500">소비 계획 합계</div>
               <div className="text-xl font-semibold">{KRW.format(planSum)}</div>
             </div>
             <div className="rounded-2xl bg-slate-50 p-4">
               <div className="text-slate-500">소비 실제 합계</div>
               <div className="text-xl font-semibold">{KRW.format(spentSum)}</div>
             </div>
             <div className="rounded-2xl bg-slate-50 p-4">
               <div className="text-slate-500">소비 잔액</div>
               <div className="text-xl font-semibold">{KRW.format(remainSum)}</div>
             </div>
           </div>
         </Section>

         <Section title="항목별 집행률(%)">
           <div className="h-64 w-full">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={chartData} margin={{ top: 10, right: 10, bottom: 10, left: 0 }}>
                 <CartesianGrid strokeDasharray="3 3" />
                 <XAxis dataKey="name" interval={0} height={50} tick={{ fontSize: 12 }} />
                 <YAxis domain={[0, 100]} />
                 <Tooltip formatter={(v: any, n: any, p: any)=> [v+"%", p.payload.name]} />
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
           <button onClick={()=>setTab("home")} className="rounded-xl border px-4 py-3">ⓧ 홈으로</button>
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
             <select value={startDay} onChange={(e)=>setStartDay(Number(e.target.value))} className="rounded-xl border px-3 py-2">
               {Array.from({length:31}, (_,i)=>i+1).map(n=> <option key={n} value={n}>{n}일</option>)}
             </select>
             <button onClick={()=>{
               setState(prev=>({ ...prev, settings: { ...prev.settings, startDay, startDayTakesEffectNextMonth: true } }));
               alert("월 시작일이 저장되었습니다. 다음 달부터 적용됩니다.");
             }} className="rounded-xl bg-black px-4 py-2 text-white">저장</button>
           </div>
           <p className="mt-2 text-sm text-slate-500">변경 사항은 다음 달부터 적용됩니다. (이월 없음)</p>
         </Section>

         <Section title="데이터">
           <div className="flex flex-wrap gap-2">
             <button onClick={()=>{
               if(!confirm("예시 데이터를 추가할까요?")) return;
               const baseMonth = month;
               const sample: Tx[] = [
                 { id:"", date: `${baseMonth}-01`, top: "소비", item: "식비", amount: 3300 },
                 { id:"", date: `${baseMonth}-02`, top: "소비", item: "생활비", amount: 39000 },
                 { id:"", date: `${baseMonth}-04`, top: "소비", item: "공과금", amount: 23100 },
               ];
               setState(prev=>({ ...prev, txs: [...sample.map(s=>({ ...s, id: uid()})), ...prev.txs] }));
               alert("예시 데이터가 추가되었습니다.");
             }} className="rounded-xl border px-3 py-2">예시 데이터 추가</button>
             <button onClick={()=>{
               if(!confirm("모든 데이터를 초기화할까요?")) return;
               localStorage.removeItem(LS_KEY);
               location.reload();
             }} className="rounded-xl border px-3 py-2">전체 초기화</button>
           </div>
         </Section>

         <div className="mt-4">
           <button onClick={()=>setTab("home")} className="rounded-xl border px-4 py-3">ⓧ 홈으로</button>
         </div>
         <TabBar value="settings" onChange={setTab} />
       </div>
     );
   }

   return (
     <div className="mx-auto max-w-4xl px-3 py-4 sm:px-6 sm:py-8">
       <header className="mb-4 flex flex-col justify-between gap-3 sm:mb-6 sm:flex-row sm:items-end">
         <h1 className="text-2xl font-bold">가계부</h1>
         <div className="text-sm text-slate-500">월 단위 예산 · 이월 없음 · 수동 입력</div>
       </header>

       {tab === "home" && <HomeView />}
       {tab === "list" && <ListView />}
       {tab === "budget" && <BudgetView />}
       {tab === "monthly" && <MonthlyView />}
       {tab === "settings" && <SettingsView />}
     </div>
   );
 }
