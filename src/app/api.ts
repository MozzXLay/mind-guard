import { invoke } from '@tauri-apps/api/core';

export type VaultStatus = {
  initialized: boolean;
  unlocked: boolean;
  autoLockMinutes: number;
  recoveryRequired: boolean;
};

export type RestorePreview = {
  goalCount: number;
  createdAt: number;
};

export type CommandError = {
  code: string;
  message: string;
};

export type BehaviorType = 'urge' | 'viewed_content' | 'stopped_viewing' | 'masturbation' | 'alternative_action';
export type EventInput = { eventType: BehaviorType; occurredAtUtcMs: number; zoneId: string; intensity: number | null; note: string | null; triggers: string[] };
export type BehaviorEvent = EventInput & { id: string; localDate: string; localHour: number };
export type TodaySnapshot = { todayEvents: number; loggedDaysLast7: number; recent: BehaviorEvent[] };
export type Goal = { id: string; title: string; kind: string; status: 'active' | 'paused' | 'archived' };
export type PlanAction = { id: string; goalId: string; title: string; enabled: boolean; goalStatus: Goal['status']; completed: boolean };

export const api = {
  status: () => invoke<VaultStatus>('vault_status'),
  initialize: (password: string, goals: string[]) => invoke<VaultStatus>('initialize_vault', { password, goals }),
  unlock: (password: string) => invoke<VaultStatus>('unlock_vault', { password }),
  lock: () => invoke<VaultStatus>('lock_vault'),
  touch: () => invoke<void>('touch_activity'),
  goals: () => invoke<string[]>('list_goals'),
  setAutoLock: (minutes: number) => invoke<VaultStatus>('set_auto_lock_minutes', { minutes }),
  backup: (password: string) => invoke<string>('create_encrypted_backup', { password }),
  previewRestore: (path: string, password: string) => invoke<RestorePreview>('preview_restore', { path, password }),
  restore: (path: string, password: string) => invoke<VaultStatus>('restore_backup', { path, password }),
  createEvent: (input: EventInput) => invoke<BehaviorEvent>('create_behavior_event', { input }),
  event: (id: string) => invoke<BehaviorEvent>('get_behavior_event', { id }),
  events: (from: string | null, to: string | null, eventType: BehaviorType | null, limit = 50, offset = 0) => invoke<BehaviorEvent[]>('list_behavior_events', { from, to, eventType, limit, offset }),
  updateEvent: (id: string, input: EventInput) => invoke<BehaviorEvent>('update_behavior_event', { id, input }),
  deleteEvent: (id: string) => invoke<void>('delete_behavior_event', { id }),
  today: (today: string, from: string) => invoke<TodaySnapshot>('today_snapshot', { today, from }),
  goalDetails: () => invoke<Goal[]>('list_goal_details'),
  saveGoal: (id: string | null, title: string, status: Goal['status']) => invoke<Goal>('save_goal', { id, title, status }),
  actions: (date: string) => invoke<PlanAction[]>('list_plan_actions', { date }),
  saveAction: (id: string | null, goalId: string, title: string, enabled: boolean) => invoke<void>('save_plan_action', { id, goalId, title, enabled }),
  completeAction: (actionId: string, date: string, done: boolean) => invoke<void>('set_action_completion', { actionId, date, done }),
};

export function errorText(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '操作未完成，请检查本地环境并重试。';
}
