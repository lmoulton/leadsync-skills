---
name: leadsync-setup
description: Checks that the LeadSync tools are connected and which account they act on. Use when the user asks to "set up LeadSync", "check my LeadSync key", "which LeadSync account am I on", "get started with LeadSync", or when a LeadSync tool returns "LEADSYNC_API_KEY is not set", "could not be read", unauthorized, key_revoked, read_only_key or act_as_forbidden. Not for connecting a lead form (use connecting-lead-forms) or for a missing lead (use troubleshooting-lead-delivery).
license: MIT
metadata:
  version: "0.1.0"
  category: operations
  related-skills: "connecting-lead-forms, troubleshooting-lead-delivery"
  summary: "Confirms the API key works and which account you are acting on"
---

# LeadSync setup

Confirm the LeadSync tools work, the key has the right scope, and you know which account every call will act on.

## Workflow

### Step 1: Call `get_me`

`get_me` returns `account`, `key` (name, scope, can_write_accounts, can_test_lead), `acting_on_other_account` and `limits`. Read it before anything else.

- If it works, go to Step 3.
- If it fails, go to Step 2.

### Step 2: Fix the key

| Tool error | Meaning | What to do |
| --- | --- | --- |
| `config_error: LEADSYNC_API_KEY is not set. Run: npx @leadsync/skills login` | No key in the environment or the key file | Ask the human to run `npx @leadsync/skills login` in a terminal, then restart the assistant. |
| `config_error: <file> could not be read: ...` | The key file is unreadable, or has a line that is not `KEY=value` (for example a key pasted without `LEADSYNC_API_KEY=`) | Ask the human to open that file and fix the line, or delete the file and run `npx @leadsync/skills login`. Do not open it yourself. |
| `unauthorized` | The key is wrong, mistyped, or a placeholder | A `LEADSYNC_API_KEY` set in the assistant's MCP config (an `env` block) wins over `~/.leadsync/.env`: ask the human to check that config for a leftover key or the placeholder `ls_live_your_key_here` and remove that line if they used `login`. Otherwise check the key was saved exactly; if it still fails, create a new key and revoke the old one. |
| `key_revoked` | The key was revoked | Create a new key, or run `npx @leadsync/skills login`. |

Create a key under Account, Settings, API keys in LeadSync (https://leadsync.me/account/settings#api-keys), or run `npx @leadsync/skills login`, which saves it to `~/.leadsync/.env`. Restart the assistant afterwards. The server reads `LEADSYNC_API_KEY` from its environment first, then from `~/.leadsync/.env` (one line, `LEADSYNC_API_KEY=ls_live_...`, file mode 600).

Never ask for the key in chat, paste it, echo it or print it. Do not read the key file. Tell the human the steps and let them do it.

### Step 3: Know what the key can do

- `account` scope: the keys customers create (under API keys, or with `login`). They act only on their own account, can write, and can send test leads there. Passing another `account_id` gives 403 `act_as_forbidden`.
- `admin` scope: LeadSync staff keys; they pick the account with `account_id` (from `find_accounts`) or `LEADSYNC_ACCOUNT`, and pass that `account_id` on every call.
- `can_write_accounts` false (or `read_only_key` errors): the key is read-only. Reads and `resend_lead` still work; attaching, mapping, pausing and autoresponders do not.
- `can_test_lead` false: `send_test_lead` fails with `test_lead_forbidden`.

### Step 4: Report back

Say in two or three lines: which account (name and id), the key's scope, whether it can write and send test leads, and whether `acting_on_other_account` is true. If it is true, remind yourself that customers are affected by what you do.

## Rules that bite

- Check `get_me` again after any change of key or `LEADSYNC_ACCOUNT`.
- On a customer account, state what you will do and wait for the human's yes before any write (`resend_lead`, `set_mapping`, `set_list_active`, `create_autoresponder`, `send_test_lead`, `attach_form` on a live form). Reads never need a yes. The flags `acknowledge_customer_impact`, `acknowledge_shared_connection` and `override_limits` are never sent without the human's yes, on any account.
- `override_limits` works only on LeadSync staff keys and is audited: never without the human's yes.

## Edge cases

| Code | What to do |
| --- | --- |
| `account_not_found` | The `account_id` is wrong. Run `find_accounts` again. |
| `act_as_forbidden` | An account key tried another account. Drop `account_id`; a key only works on the account that created it. |
| `read_only_key` | Stop writing. Tell the human the key is read-only. |
| `rate_limited` | Wait a minute and retry once. |
| `internal` | Retry once, then tell the human. |
