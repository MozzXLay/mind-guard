import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { api, errorText, type BehaviorEvent, type BehaviorType, type EventInput } from '../../app/api';

export const eventLabels: Record<BehaviorType, string> = { urge: '出现冲动', viewed_content: '浏览内容', stopped_viewing: '主动停止浏览', masturbation: '自慰', alternative_action: '替代行动' };
const triggerLabels: Record<string, string> = { boredom: '无聊', stress: '压力', loneliness: '孤独', anxiety: '焦虑', fatigue: '疲劳', sleep_loss: '睡眠不足', desire: '性欲', habit: '习惯', other: '其他' };
const types = Object.keys(eventLabels) as BehaviorType[];
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function fromDays(days: number) { const date = new Date(); date.setDate(date.getDate() - days + 1); return localDate(date); }
export function todayDate() { return localDate(new Date()); }
function inputTime(date: Date) { return `${localDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`; }
export function eventWhen(event: BehaviorEvent) { return new Intl.DateTimeFormat('zh-CN', { timeZone: event.zoneId, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.occurredAtUtcMs)); }

export default function Records() {
  const location = useLocation();
  const [items, setItems] = useState<BehaviorEvent[]>([]);
  const [period, setPeriod] = useState(30);
  const [kind, setKind] = useState<BehaviorType | ''>('');
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<BehaviorEvent | null | undefined>(() => new URLSearchParams(location.search).has('new') ? null : undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [undoId, setUndoId] = useState('');
  const refresh = useCallback(async () => {
    try { setItems(await api.events(fromDays(period), todayDate(), kind || null, 50, offset)); setError(''); }
    catch (cause) { setError(errorText(cause)); }
  }, [period, kind, offset]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function remove(id: string, undo = false) {
    if (!undo && !window.confirm('删除这条记录？删除后相关统计会重新计算。')) return;
    setBusy(true);
    try { await api.deleteEvent(id); if (undoId === id) setUndoId(''); await refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <><p className="kicker">LOG / 02</p><h1 className="page-title">记录，不用评判。</h1><p className="subtitle">只写你愿意留下的部分。自慰只是一种可选的观察记录。</p>
    <div className="row-between"><div className="form-actions left"><label>时间范围 <select value={period} onChange={(e) => { setPeriod(Number(e.target.value)); setOffset(0); }}><option value={7}>近 7 天</option><option value={30}>近 30 天</option></select></label><label>类型 <select value={kind} onChange={(e) => { setKind(e.target.value as BehaviorType | ''); setOffset(0); }}><option value="">全部</option>{types.map((type) => <option key={type} value={type}>{eventLabels[type]}</option>)}</select></label></div><button className="button primary" onClick={() => setEditing(null)}>＋ 新建记录</button></div>
    {error && <p className="message error" role="alert">{error}</p>}
    {undoId && <p className="message" role="status">记录已保存。<button className="text-button" disabled={busy} onClick={() => void remove(undoId, true)}>撤销刚保存的记录</button></p>}
    <section className="card below"><h2>历史记录</h2>{items.length === 0 ? <p className="muted">此范围内还没有记录。没有记录不代表成功或失败。</p> : <ul className="record-list">{items.map((item) => <li key={item.id} className="record-item"><div className="row-between"><div><strong>{eventLabels[item.eventType]}</strong><p className="small muted">{eventWhen(item)} · {item.zoneId}{item.intensity !== null ? ` · 强度 ${item.intensity}/10` : ''}</p></div><div className="form-actions left"><button className="button ghost" onClick={() => setEditing(item)}>编辑</button><button className="button ghost" disabled={busy} onClick={() => void remove(item.id)}>删除</button></div></div>{item.triggers.length > 0 && <p className="small muted">触发因素：{item.triggers.map((code) => triggerLabels[code] ?? code).join('、')}</p>}{item.note && <p>{item.note}</p>}</li>)}</ul>}
      <div className="form-actions left"><button className="button ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><button className="button ghost" disabled={items.length < 50} onClick={() => setOffset(offset + 50)}>下一页</button></div>
    </section>
    {editing !== undefined && <EventEditor key={editing?.id ?? 'new'} original={editing} onClose={() => setEditing(undefined)} onSaved={async (id) => { setEditing(undefined); setUndoId(editing ? '' : id); setOffset(0); await refresh(); }} />}
  </>;
}

function EventEditor({ original, onClose, onSaved }: { original: BehaviorEvent | null; onClose: () => void; onSaved: (id: string) => Promise<void> }) {
  const initialTime = original ? inputTime(new Date(original.occurredAtUtcMs)) : inputTime(new Date());
  const [eventType, setEventType] = useState<BehaviorType>(original?.eventType ?? 'urge');
  const [time, setTime] = useState(initialTime);
  const [intensity, setIntensity] = useState(original?.intensity?.toString() ?? '');
  const [triggers, setTriggers] = useState<string[]>(original?.triggers ?? []);
  const [note, setNote] = useState(original?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLFormElement>(null);
  const dirty = eventType !== (original?.eventType ?? 'urge') || time !== initialTime || intensity !== (original?.intensity?.toString() ?? '') || note !== (original?.note ?? '') || [...triggers].sort().join(',') !== [...(original?.triggers ?? [])].sort().join(',');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (!dirty || window.confirm('放弃未保存的修改？'))) onClose();
      if (event.key === 'Tab' && dialog.current) {
        const controls = [...dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    const parsed = new Date(time).getTime();
    if (!Number.isFinite(parsed)) { setError('请选择有效的发生时间。'); return; }
    const unchangedTime = original && time === initialTime;
    const input: EventInput = { eventType, occurredAtUtcMs: unchangedTime ? original.occurredAtUtcMs : parsed, zoneId: unchangedTime ? original.zoneId : Intl.DateTimeFormat().resolvedOptions().timeZone, intensity: intensity === '' ? null : Number(intensity), triggers, note: note || null };
    setBusy(true); setError('');
    try { const saved = original ? await api.updateEvent(original.id, input) : await api.createEvent(input); await onSaved(saved.id); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><form ref={dialog} className="auth-panel record-editor" onSubmit={(e) => void save(e)} role="dialog" aria-modal="true" aria-label={original ? '编辑记录' : '新建记录'}>
    <h2>{original ? '编辑记录' : '新建记录'}</h2><p className="small muted">时间按当前系统时区编辑；未修改时间时保留原记录时区。</p>
    <label className="field">发生了什么？<select autoFocus value={eventType} onChange={(e) => setEventType(e.target.value as BehaviorType)}>{types.map((type) => <option key={type} value={type}>{eventLabels[type]}</option>)}</select></label>
    <label className="field">发生时间<input type="datetime-local" required value={time} onChange={(e) => setTime(e.target.value)} /></label>
    <label className="field">强度 0–10（可留空）<select value={intensity} onChange={(e) => setIntensity(e.target.value)}><option value="">不记录</option>{Array.from({ length: 11 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></label>
    <fieldset className="field"><legend>触发因素（可多选）</legend>{Object.entries(triggerLabels).map(([code, label]) => <label className="checkrow" key={code}><input type="checkbox" checked={triggers.includes(code)} onChange={() => setTriggers((old) => old.includes(code) ? old.filter((x) => x !== code) : [...old, code])} />{label}</label>)}</fieldset>
    <label className="field">备注（可留空，最多 2000 字）<textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="form-actions"><button type="button" className="button ghost" onClick={() => { if (!dirty || window.confirm('放弃未保存的修改？')) onClose(); }}>取消</button><button className="button primary" disabled={busy}>{busy ? '正在保存…' : '保存记录'}</button></div>
  </form></div>;
}
