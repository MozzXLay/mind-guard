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
};

export function errorText(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '操作未完成，请检查本地环境并重试。';
}
