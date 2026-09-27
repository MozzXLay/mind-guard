import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText, type Goal, type PlanAction, type TodaySnapshot } from '../../app/api';
import { fromDays, type CalendarDay } from '../../app/calendar';
import { eventLabels, eventWhen } from '../records/Records';

type Props = { day: CalendarDay; onSos: () => void; onRecord: () => void; onPlan: () => void };

export default function Today({ day, onSos, onRecord, onPlan }: Props) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [actions, setActions] = useState<PlanAction[]>([]);
  const [error, setError] = useState('');
  const request = useRef(0);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const seq = ++request.current;
    try {
      const [summary, goalRows, actionRows] = await Promise.all([api.today(day.date, fromDays(7, day.date)), api.goalDetails(), api.actions(day.date)]);
      if (seq !== request.current) return;
      setSnapshot(summary); setGoals(goalRows); setActions(actionRows); setError('');
    } catch (cause) { if (seq === request.current) setError(errorText(cause)); }
  }, [day.date]);
  useEffect(() => { void refresh(); return () => { ++request.current; }; }, [refresh]);
  async function toggle(action: PlanAction, done: boolean) {
    setBusy(true);
    try { await api.completeAction(action.id, day.date, done); await refresh(); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const activeActions = actions.filter((action) => action.enabled && action.goalStatus === 'active');
  const completedCount = actions.filter((action) => action.completed).length;
  return <div>
    <p className="kicker">TODAY / 01</p>
    <h1 className="page-title">今晚，先照顾好自己。</h1>
    <p className="subtitle">这是一处安静的空间。可以观察，也可以先休息。</p>
    <div className="card-grid">
      <section className="card hero">
        <p className="kicker">你的方向</p>
        <h2>{activeGoals.length ? '把冲动与行动之间，留出一点空间。' : '今天先做一件小事。'}</h2>
        <p>{activeGoals.length ? `${activeGoals.length} 个进行中的目标，随时可以调整节奏。` : '目前没有进行中的目标。你也可以先停一会儿。'}</p>
        <div className="form-actions left"><button className="button primary" onClick={onRecord}>快速记录</button><button className="button ghost" onClick={onSos}>开始 SOS</button></div>
      </section>
      <section className="card">
        <div className="row-between"><h2>近 7 天概览</h2><span className="pill">真实记录</span></div>
        <div className="empty-number">{snapshot?.loggedDaysLast7 ?? '…'} / 7</div>
        <p className="muted">有事件、行动完成或已保存 SOS 的日子。今天 {snapshot?.todayEvents ?? '…'} 条事件。</p>
      </section>
    </div>
    <div className="card-grid below">
      <section className="card"><h2>当前目标与行动</h2>{activeGoals.length ? <ul className="goal-list">{activeGoals.map((goal) => <li key={goal.id}>{goal.title}</li>)}</ul> : <p className="muted">目标是可选的。</p>}<p className="small muted">{day.date} 完成记录 {completedCount} 项 · 当前可进行 {activeActions.length} 项</p>{activeActions.map((action) => <label className="checkrow" key={action.id}><input type="checkbox" checked={action.completed} disabled={busy} onChange={(e) => void toggle(action, e.target.checked)} />{action.title}</label>)}{completedCount > activeActions.filter((action) => action.completed).length && <p className="small muted">已暂停或归档的完成记录可在计划页撤销。</p>}<button className="button ghost" onClick={onPlan}>调整计划</button></section>
      <section className="card"><h2>最近的观察</h2>{snapshot?.recent.length ? <ul className="goal-list">{snapshot.recent.map((event) => <li key={event.id}>{eventLabels[event.eventType]} · {eventWhen(event)}</li>)}</ul> : <p className="muted">还没有记录。想记下观察时，可以从这里开始。</p>}<span className="pill">{day.longLabel}</span></section>
    </div>
    {error && <p className="message error" role="alert">{error}</p>}
  </div>;
}
