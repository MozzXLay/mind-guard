import { useEffect, useState } from 'react';
import { api, errorText, type Goal, type PlanAction, type TodaySnapshot } from '../../app/api';
import { eventLabels, eventWhen, fromDays, todayDate } from '../records/Records';

type Props = { onSos: () => void; onRecord: () => void; onPlan: () => void };

export default function Today({ onSos, onRecord, onPlan }: Props) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [actions, setActions] = useState<PlanAction[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { void Promise.all([api.today(todayDate(), fromDays(7)), api.goalDetails(), api.actions(todayDate())]).then(([summary, goalRows, actionRows]) => { setSnapshot(summary); setGoals(goalRows); setActions(actionRows); }).catch((cause) => setError(errorText(cause))); }, []);
  const activeGoals = goals.filter((goal) => goal.status === 'active');
  const activeActions = actions.filter((action) => action.enabled && action.goalStatus === 'active');
  const today = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date());
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
      <section className="card"><h2>当前目标与行动</h2>{activeGoals.length ? <ul className="goal-list">{activeGoals.map((goal) => <li key={goal.id}>{goal.title}</li>)}</ul> : <p className="muted">目标是可选的。</p>}<p className="small muted">今日小行动 {activeActions.filter((action) => action.completed).length} / {activeActions.length} 已做</p>{activeActions.map((action) => <label className="checkrow" key={action.id}><input type="checkbox" checked={action.completed} onChange={(e) => void api.completeAction(action.id, todayDate(), e.target.checked).then(() => api.actions(todayDate())).then(setActions).catch((cause) => setError(errorText(cause)))} />{action.title}</label>)}<button className="button ghost" onClick={onPlan}>调整计划</button></section>
      <section className="card"><h2>最近的观察</h2>{snapshot?.recent.length ? <ul className="goal-list">{snapshot.recent.map((event) => <li key={event.id}>{eventLabels[event.eventType]} · {eventWhen(event)}</li>)}</ul> : <p className="muted">还没有记录。想记下观察时，可以从这里开始。</p>}<span className="pill">{today}</span></section>
    </div>
    {error && <p className="message error" role="alert">{error}</p>}
  </div>;
}
