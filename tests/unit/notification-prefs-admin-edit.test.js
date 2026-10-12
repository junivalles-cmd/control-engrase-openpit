import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js', 'utf8');

describe('push token confidentiality', () => {
  it('keeps notification preference editing self-service only', () => {
    expect(app).not.toContain('saveNotificationPreferencesForUser');
    expect(app).not.toContain('openEditUserNotificationPrefsModal');
    expect(app).not.toContain('push-tokens-list');
    expect(app).toContain("filter(t => t.userId === App.currentUser.id)");
  });

  it('retains the authenticated user’s own notification preference form', () => {
    expect(app).toContain('saveNotificationPreferences({');
    expect(app).toContain('my-notif-prefs-form');
  });
});
