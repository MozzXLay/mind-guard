import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorText, type Goal, type PlanAction } from '../../app/api';
import { todayDate } from '../records/Records';

const statusLabels = { active: '进行中', paused: '已暂停', archived: '已归档' };
type GoalDraft = { id: string | null; title: string; status: Goal['status'] };
type ActionDraft = { id: string | null; goalId: string; title: string; enabled: boolean };

export default function Plan() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [actions, setActions] = useState<PlanAction[]>([]);
  const [goalDraft, setGoalDraft] = useState<GoalDraft | null>(null);
  const [actionDraft, setActionDraft] = useState<ActionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const [nextGoals, nextActions] = await Promise.all([api.goalDetails(), api.actions(todayDate())]); setGoals(nextGoals); setActions(nextActions); setError(''); }
    catch (cause) { setError(errorText(cause)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function saveGoal(event: FormEvent) {
    event.preventDefault(); if (!goalDraft) return;
    setBusy(true);
    try { await api.saveGoal(goalDraft.id, goalDraft.title, goalDraft.status); setGoalDraft(null); await refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function saveAction(event: FormEvent) {
    event.preventDefault(); if (!actionDraft) return;
    setBusy(true);
    try { await api.saveAction(actionDraft.id, actionDraft.goalId, actionDraft.title, actionDraft.enabled); setActionDraft(null); await refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function toggle(action: PlanAction, done: boolean) {
    setBusy(true);
    try { await api.completeAction(action.id, todayDate(), done); await refresh(); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const activeActions = actions.filter((action) => action.goalStatus === 'active' && action.enabled);
  return <><p className="kicker">PLAN / 04</p><h1 className="page-title">一个能调整的计划。</h1><p className="subtitle">目标由你定义，小行动可以暂停；历史不会因修改目标而重置。</p>
    <div className="row-between"><span className="pill">今日小行动 {activeActions.filter((action) => action.completed).length} / {activeActions.length}</span><button className="button primary" onClick={() => setGoalDraft({ id: null, title: '', status: 'active' })}>＋ 新增目标</button></div>
    {error && <p className="message error" role="alert">{error}</p>}
    {goals.length === 0 && <section className="card below"><p className="muted">还没有目标。你可以从想调整的一件事开始；也可以暂时不设目标。</p></section>}
    {goals.map((goal) => <section className="card below" key={goal.id}><div className="row-between"><div><span className="pill">{statusLabels[goal.status]}</span><h2>{goal.title}</h2></div><button className="button ghost" onClick={() => setGoalDraft({ id: goal.id, title: goal.title, status: goal.status })}>编辑目标</button></div>
      <h3>小行动</h3>{actions.filter((action) => action.goalId === goal.id).map((action) => <div className="row-between action-row" key={action.id}><label className="checkrow"><input type="checkbox" checked={action.completed} disabled={busy || !action.enabled || goal.status !== 'active'} onChange={(e) => void toggle(action, e.target.checked)} />{action.title}{!action.enabled && <span className="small muted"> · 已暂停</span>}</label><button className="button ghost" onClick={() => setActionDraft({ id: action.id, goalId: goal.id, title: action.title, enabled: action.enabled })}>编辑</button></div>)}
      {actions.every((action) => action.goalId !== goal.id) && <p className="muted">还没有小行动。</p>}
      {goal.status !== 'archived' && <button className="button ghost" onClick={() => setActionDraft({ id: null, goalId: goal.id, title: '', enabled: true })}>＋ 添加小行动</button>}
    </section>)}
    {goalDraft && <div className="modal-backdrop"><form className="auth-panel" role="dialog" aria-modal="true" aria-label="编辑目标" onSubmit={(e) => void saveGoal(e)}><h2>{goalDraft.id ? '编辑目标' : '新增目标'}</h2><label className="field">目标标题<input autoFocus required maxLength={100} value={goalDraft.title} onChange={(e) => setGoalDraft({ ...goalDraft, title: e.target.value })} /></label><label className="field">状态<select value={goalDraft.status} onChange={(e) => setGoalDraft({ ...goalDraft, status: e.target.value as Goal['status'] })}><option value="active">进行中</option><option value="paused">暂停</option><option value="archived">归档</option></select></label><div className="form-actions"><button type="button" className="button ghost" onClick={() => setGoalDraft(null)}>取消</button><button className="button primary" disabled={busy}>保存目标</button></div></form></div>}
    {actionDraft && <div className="modal-backdrop"><form className="auth-panel" role="dialog" aria-modal="true" aria-label="编辑小行动" onSubmit={(e) => void saveAction(e)}><h2>{actionDraft.id ? '编辑小行动' : '添加小行动'}</h2><label className="field">行动名称<input autoFocus required maxLength={100} value={actionDraft.title} onChange={(e) => setActionDraft({ ...actionDraft, title: e.target.value })} /></label><label className="checkrow"><input type="checkbox" checked={actionDraft.enabled} onChange={(e) => setActionDraft({ ...actionDraft, enabled: e.target.checked })} />启用每日行动</label><div className="form-actions"><button type="button" className="button ghost" onClick={() => setActionDraft(null)}>取消</button><button className="button primary" disabled={busy}>保存行动</button></div></form></div>}
  </>;
}
