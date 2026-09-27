import { useEffect, useState } from 'react';
import { api, errorText, type TodaySnapshot } from '../../app/api';
import { eventLabels, eventWhen, fromDays, todayDate } from '../records/Records';

type Props = { goals: string[]; onSos: () => void; onRecord: () => void };

export default function Today({ goals, onSos, onRecord }: Props) {
  const [snapshot, setSnapshot] = useState<TodaySnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void api.today(todayDate(), fromDays(7)).then(setSnapshot).catch((cause) => setError(errorText(cause))); }, []);
  const today = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date());
  return <div>
    <p className="kicker">TODAY / 01</p>
    <h1 className="page-title">今晚，先照顾好自己。</h1>
    <p className="subtitle">这是一处安静的空间。可以观察，也可以先休息。</p>
    <div className="card-grid">
      <section className="card hero">
        <p className="kicker">你的方向</p>
        <h2>{goals.length ? '把冲动与行动之间，留出一点空间。' : '今天先做一件小事。'}</h2>
        <p>{goals.length ? '目标由你选择，随时可以调整节奏。' : '目前还没有目标。你也可以先停一会儿。'}</p>
        <div className="form-actions left"><button className="button primary" onClick={onRecord}>快速记录</button><button className="button ghost" onClick={onSos}>开始 SOS</button></div>
      </section>
      <section className="card">
        <div className="row-between"><h2>近 7 天概览</h2><span className="pill">真实记录</span></div>
        <div className="empty-number">{snapshot?.loggedDaysLast7 ?? '…'} / 7</div>
        <p className="muted">有事件记录的日子。今天 {snapshot?.todayEvents ?? '…'} 条事件。</p>
      </section>
    </div>
    <div className="card-grid below">
      <section className="card"><h2>当前目标</h2>{goals.length ? <ul className="goal-list">{goals.map((goal) => <li key={goal}>{goal}</li>)}</ul> : <p className="muted">首次引导选择目标是可选的。</p>}</section>
      <section className="card"><h2>最近的观察</h2>{snapshot?.recent.length ? <ul className="goal-list">{snapshot.recent.map((event) => <li key={event.id}>{eventLabels[event.eventType]} · {eventWhen(event)}</li>)}</ul> : <p className="muted">还没有记录。想记下观察时，可以从这里开始。</p>}<span className="pill">{today}</span></section>
    </div>
    {error && <p className="message error" role="alert">{error}</p>}
  </div>;
}
