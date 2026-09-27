import { useEffect, useState } from 'react';
import { api, errorText, type Insights as InsightsData } from '../../app/api';
import type { CalendarDay } from '../../app/calendar';
import { eventLabels } from '../records/Records';

const triggerLabels: Record<string, string> = { boredom: '无聊', stress: '压力', loneliness: '孤独', anxiety: '焦虑', fatigue: '疲劳', sleep_loss: '睡眠不足', desire: '性欲', habit: '习惯', other: '其他' };

export default function Insights({ day }: { day: CalendarDay }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<InsightsData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; setData(null); void api.insights(day.date, days).then((result) => { if (active) { setData(result); setError(''); } }).catch((cause) => { if (active) setError(errorText(cause)); }); return () => { active = false; }; }, [day.date, days]);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, count: data?.hourlyDistribution.find((item) => item.hour === hour)?.count ?? 0 }));
  const maxHour = Math.max(1, ...hours.map((item) => item.count));
  return <><p className="kicker">INSIGHTS / 05</p><h1 className="page-title">把规律看清一点。</h1><p className="subtitle">只整理你留下的事件、行动和 SOS；不推断健康变化。</p>
    <div className="form-actions left"><button className={`button ${days === 7 ? 'primary' : 'ghost'}`} onClick={() => setDays(7)}>近 7 天</button><button className={`button ${days === 30 ? 'primary' : 'ghost'}`} onClick={() => setDays(30)}>近 30 天</button></div>
    {error && <p className="message error" role="alert">{error}</p>}
    {!data ? <p role="status">正在计算本地记录…</p> : <><p className="small muted">统计区间：{data.from} 至 {data.to}，共 {data.days} 个当地日历日。日数来源：事件、行动完成、已保存 SOS 的日期并集。</p>
      <div className="card-grid"><section className="card"><h2>有记录的日子</h2><div className="empty-number">{data.loggedDays} / {data.days}</div><p className="muted">至少有一项上述记录的日期。</p></section><section className="card"><h2>记录数量</h2><p>事件 {data.eventTotal} 条 · 行动完成 {data.actionCount} 次 · 已保存 SOS {data.sosCount} 次</p><p className="small muted">强度非空样本 {data.intensitySamples} 条{data.averageIntensity !== null ? `，样本平均 ${data.averageIntensity.toFixed(1)} / 10` : '，暂无平均值'}。</p></section></div>
      {data.eventTotal === 0 ? <section className="card below"><h2>暂无事件记录</h2><p className="muted">此区间内没有事件，因此没有类型、小时或触发因素分布。没有记录不代表成功或失败。</p></section> : <><section className="card below"><h2>事件类型</h2><ul className="goal-list">{data.eventCounts.map((item) => <li key={item.name}>{eventLabels[item.name]}：{item.count} / {data.eventTotal} 条事件</li>)}</ul>{data.eventTotal < 5 && <p className="small muted">事件少于 5 条，仅显示原始计数。</p>}</section>
        <section className="card below"><h2>事件发生小时</h2><p className="small muted">每小时条数，分母为 {data.eventTotal} 条事件；按事件发生地的当地小时统计。</p><div className="hour-grid">{hours.map(({ hour, count }) => <div key={hour} className="hour-cell" aria-label={`${hour} 时：${count} 条`}><span>{String(hour).padStart(2, '0')}</span><div className="hour-track"><span style={{ height: `${count / maxHour * 100}%` }} /></div><strong>{count}</strong></div>)}</div></section>
        <section className="card below"><h2>触发因素</h2><p className="small muted">可多选；每项是出现次数，不是互斥百分比。来源：此区间 {data.eventTotal} 条事件。</p>{data.triggerCounts.length ? <ul className="goal-list">{data.triggerCounts.map((item) => <li key={item.name}>{triggerLabels[item.name] ?? item.name}：{item.count} 次</li>)}</ul> : <p className="muted">没有填写触发因素。</p>}</section></>}
    </>}
  </>;
}
