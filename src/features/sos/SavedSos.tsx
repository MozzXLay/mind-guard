import { useEffect, useRef, useState } from 'react';
import { api, errorText, type SosOutcome, type SosSession } from '../../app/api';

export default function SavedSos({ onLeave }: { onLeave: () => void }) {
  const [seconds, setSeconds] = useState(90);
  const [running, setRunning] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [initial, setInitial] = useState('');
  const [final, setFinal] = useState('');
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState<SosOutcome | null>(null);
  const [history, setHistory] = useState<SosSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const deadline = useRef(0);
  useEffect(() => { void api.sosSessions().then(setHistory).catch((cause) => setError(errorText(cause))); }, []);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline.current - performance.now()) / 1000));
      setSeconds(remaining);
      if (remaining === 0) { setRunning(false); setOutcome('completed'); }
    }, 200);
    return () => window.clearInterval(timer);
  }, [running]);
  function start() {
    if (startedAt === null) setStartedAt(Date.now());
    deadline.current = performance.now() + seconds * 1000;
    setRunning(true);
  }
  async function save(result: SosOutcome) {
    if (startedAt === null) { onLeave(); return; }
    setBusy(true); setError('');
    try {
      const saved = await api.saveSos({ startedAtUtcMs: startedAt, endedAtUtcMs: Date.now(), zoneId: Intl.DateTimeFormat().resolvedOptions().timeZone, initialIntensity: initial === '' ? null : Number(initial), finalIntensity: final === '' ? null : Number(final), outcome: result, action: action || null });
      setHistory((old) => [saved, ...old]);
      onLeave();
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return <><p className="kicker">PAUSE / 03</p><h1 className="page-title">现在先缓一缓。</h1><p className="subtitle">可以呼吸、静坐、跳过，或随时离开。保存由你决定；锁屏会丢弃未保存的会话。</p>
    <section className="card sos-panel"><div className={`breath ${running ? 'live' : ''}`} aria-label={`剩余 ${time}`}><span>{time}</span></div>
      {startedAt === null && <label className="field">开始强度 0–10（可留空）<select value={initial} onChange={(e) => setInitial(e.target.value)}><option value="">不记录</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></label>}
      <div className="form-actions">
        {!outcome && (running ? <button className="button primary" onClick={() => setRunning(false)}>暂停</button> : <button className="button primary" onClick={start}>{startedAt === null ? '开始 90 秒' : '继续'}</button>)}
        {!outcome && startedAt !== null && <button className="button ghost" onClick={() => { setRunning(false); setSeconds(0); setOutcome('skipped'); }}>跳过</button>}
        {startedAt !== null && !outcome && <button className="button ghost" disabled={busy} onClick={() => { setRunning(false); void save('interrupted'); }}>保存为中断并离开</button>}
        <button className="button ghost" onClick={onLeave}>不保存并离开</button>
      </div>
      {outcome && <div className="quiet-box"><p>{outcome === 'skipped' ? '已跳过计时。' : '90 秒已结束。'}你可以选择下一步，也可以不选。</p>
        <label className="field">结束强度 0–10（可留空）<select value={final} onChange={(e) => setFinal(e.target.value)}><option value="">不记录</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></label>
        <label className="field">下一步行动（可留空）<select value={action} onChange={(e) => setAction(e.target.value)}><option value="">不选择</option><option value="喝点水">喝点水</option><option value="离开屏幕">离开屏幕</option><option value="走动一下">走动一下</option></select></label>
        <button className="button primary" disabled={busy} onClick={() => void save(outcome)}>{busy ? '正在保存…' : '保存会话'}</button>
      </div>}
      {error && <p className="message error" role="alert">{error}</p>}
    </section>
    <section className="card below"><h2>已保存的 SOS 会话</h2>{history.length ? <ul className="goal-list">{history.map((item) => <li key={item.id}>{new Date(item.startedAtUtcMs).toLocaleString('zh-CN')} · {item.outcome === 'completed' ? '已结束' : item.outcome === 'skipped' ? '已跳过' : '已中断'}{item.action ? ` · ${item.action}` : ''}</li>)}</ul> : <p className="muted">还没有保存的会话。匿名 SOS 不会出现在这里。</p>}</section>
  </>;
}
