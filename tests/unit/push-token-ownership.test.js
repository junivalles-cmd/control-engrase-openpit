import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const root = process.cwd();
const policy = readFileSync(`${root}/CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0007_push_tokens_ownership_rls_PREPARED.sql`, 'utf8');
const rollback = readFileSync(`${root}/CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0007_push_tokens_ownership_rls_ROLLBACK.sql`, 'utf8');
const app = readFileSync(`${root}/CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js`, 'utf8');
const sync = readFileSync(`${root}/CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/sync.js`, 'utf8');

describe('push_tokens ownership hardening', () => {
  it('requires an active Auth profile owner on insert and update, with no Admin override', () => {
    expect(policy).toContain("payload->>'userId'=(select app_user_id from app_profiles");
    expect(policy).toContain("payload->>'id'=engrase_sync.id");
    expect(policy).toContain('current_app_active()');
    expect(policy).not.toMatch(/ADMINISTRADOR.{0,80}push_tokens|push_tokens.{0,80}ADMINISTRADOR/is);
  });

  it('restricts reads to the owner and adds no physical or logical delete path', () => {
    expect(policy).toContain('push_tokens_select_owner_only');
    expect(policy).toMatch(/as restrictive for select to authenticated/i);
    expect(policy).toContain('push_tokens_no_hard_delete');
    expect(policy).toMatch(/push_tokens_no_hard_delete[\s\S]+as restrictive for delete to authenticated[\s\S]+using \(store <> 'push_tokens'\)/i);
    expect(rollback).toContain('No safe automatic rollback');
    expect(rollback).not.toMatch(/drop\s+policy|create\s+policy/i);
  });

  it('does not render or write another person’s token preferences from Admin UI', () => {
    expect(app).not.toContain('saveNotificationPreferencesForUser');
    expect(app).not.toContain('openEditUserNotificationPrefsModal');
    expect(app).not.toContain('push-tokens-list');
    expect(app).toContain("filter(t => t.userId === App.currentUser.id)");
  });

  it('preserves a dirty token for its owner and never sends it with a different account JWT', () => {
    expect(sync).toContain("store === 'push_tokens' && row.userId !== Auth.getProfile?.()?.appUserId");
    expect(sync).toContain("errors.push('PUSH_TOKEN_ACCOUNT_MISMATCH')");
  });
});
