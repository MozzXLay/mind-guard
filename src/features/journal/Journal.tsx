import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorText, type JournalSummary } from '../../app/api';

export default function Journal() {
  const [items, setItems] = useState<JournalSummary[]>([]);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setItems(await api.journal(50, offset)); setError(''); }
    catch (cause) { setError(errorText(cause)); }
  }, [offset]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function open(id: string | null) {
    if (content !== original && !window.confirm('放弃未保存的修改？')) return;
    if (id === null) { setSelected(null); setContent(''); setOriginal(''); return; }
    setBusy(true);
    try { const entry = await api.journalEntry(id); setSelected(id); setContent(entry.content); setOriginal(entry.content); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try { const entry = await api.saveJournal(selected, content); setSelected(entry.id); setOriginal(entry.content); await refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm('删除这篇日记？此操作不能撤销。')) return;
    setBusy(true);
    try { await api.deleteJournal(selected); setSelected(null); setContent(''); setOriginal(''); await refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <><p className="kicker">JOURNAL / 06</p><h1 className="page-title">写给自己的几句话。</h1><p className="subtitle">内容只在解锁后显示，并加密保存在这台设备上。</p>
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="card-grid"><section className="card"><div className="row-between"><h2>我的日记</h2><button className="button ghost" disabled={busy} onClick={() => void open(null)}>＋ 新建</button></div>
      {items.length ? <ul className="record-list">{items.map((item) => <li className="record-item" key={item.id}><button className="text-button journal-link" onClick={() => void open(item.id)}><span>{new Date(item.updatedAt).toLocaleString('zh-CN')}</span><br />{item.excerpt.replace(/\s+/g, ' ').slice(0, 80)}</button></li>)}</ul> : <p className="muted">还没有日记。可以写下一句当下的想法。</p>}
      <div className="form-actions left"><button className="button ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><button className="button ghost" disabled={items.length < 50} onClick={() => setOffset(offset + 50)}>下一页</button></div>
    </section><section className="card"><h2>{selected ? '编辑日记' : '新日记'}</h2><form onSubmit={(e) => void save(e)}><label className="field">正文<textarea required maxLength={10000} rows={15} value={content} onChange={(e) => setContent(e.target.value)} placeholder="此刻想记下什么？" /></label><p className="small muted">{[...content].length} / 10000 字</p><div className="form-actions"><button className="button primary" disabled={busy || !content.trim()}>保存日记</button>{selected && <button className="button ghost" type="button" disabled={busy} onClick={() => void remove()}>删除</button>}</div></form></section></div>
  </>;
}
