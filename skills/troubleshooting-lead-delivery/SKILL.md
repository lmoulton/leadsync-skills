---
name: troubleshooting-lead-delivery
description: Diagnoses why a LeadSync lead did not arrive, failed, or did not trigger an autoresponder, and decides whether to resend or escalate. Use when the user or a customer says "my lead didn't arrive", "leads are missing", "lead not in my sheet or CRM", "autoresponder not sent", "lead failed", "lead is held", or asks to resend or check a lead. Not for first-time setup (use connecting-lead-forms) or key problems (use leadsync-setup).
license: MIT
metadata:
  version: "0.1.0"
  category: support
  related-skills: "leadsync-setup, connecting-lead-forms"
  summary: "Classify a missing lead, then resend or escalate"
---

# Troubleshooting lead delivery

Find out which of five cases you are in, then act. Read first, write last. On another account, pass `account_id` on every call.

## Workflow

1. `get_me` to confirm the account. `get_connections` to find the customer's list, its `active` flag and its connection.
2. `list_leads` for that `list_id` (use `since`, and `status` to narrow). Look for the lead by name, email or time. Each lead has `legs`, one per list/destination, with status success, failed, pending or held. Mind the window: `since` defaults to 7 days ago (the response echoes `since_used`), `limit` defaults to 50 (max 200), newest activity first.
3. `list_email_log` for the list when email is involved. Types: lead_notification, autoresponder, system, test_autoresponder, each with a delivery status.
4. Classify:

| Case | You see | Meaning and action |
| --- | --- | --- |
| 1. Never arrived | No lead row at all, and `since` was earlier than the lead's time and fewer than `limit` rows came back | It never reached LeadSync. If the window did not cover the lead's time, or `limit` rows came back, absence proves nothing: pass an earlier `since`, narrow with `list_id` or `status`, or escalate. Check the list is attached and `active` (`get_connections`), the right page and form, then `refresh_forms`. A paused list: resume with `set_list_active` (see Asking first). Meta permissions or the page token may be the cause: escalate. Do not resend, there is nothing to resend. |
| 2. Failed leg | Leg status failed | The destination rejected it. Read the error. Dead credentials or `reconnect_required`: the customer must reconnect in the UI, escalate. Wrong columns or a missing sheet tab caused by the mapping: `set_mapping` REPLACES the whole mapping and no tool can read the current one, so escalate to the human, or get the full mapping from them; never patch one field. A missing tab name is a settings change (`settings.sheet_id`), which merges safely (see Asking first). Then resend. |
| 3. Succeeded, not visible | Leg success, customer cannot see it | Check the destination (right sheet tab, right CRM, filters) and the mapping with `get_destination_fields`. For email destinations check the email log and ask the customer to check spam. Do not resend: it would duplicate. |
| 4. Autoresponder not received | Lead fine, no autoresponder | Check the email log for bounced or suppressed recipients. A hard-bounced address is permanently suppressed and silently skipped. Also the lead may have opted out. Check `list_autoresponders` that one exists on the CONNECTION. Resending does not fix a bounce. |
| 5. Held | Leg status held | A plan or balance limit is holding it (for example SMS credit). Escalate for the billing fix, then resend once it is cleared. |

A pending leg is still processing: wait a minute and read `list_leads` again.

## Asking first (applies to every write)

Reading (`get_*`, `list_*`, `find_accounts`) never needs a yes. You can diagnose and answer "why didn't my lead arrive" on your own.

Writes are `resend_lead`, `set_mapping`, `set_list_active`, `create_autoresponder`, `send_test_lead` and `attach_form` on a form that is receiving live leads.
- On another account (`acting_on_other_account: true`, or you are passing `account_id`): state exactly what you will do (lead id, list, the change or resend, and why), then wait for the human's yes before doing it.
- On the key's own account: state what you will do, then proceed.
- `acknowledge_customer_impact`, `acknowledge_shared_connection` and `override_limits` are never sent without the human's yes, on any account.

## When to resend

`resend_lead` re-queues one lead per call, Meta leads only, only failed or held legs. Use it only when all hold:

- the cause is fixed (mapping corrected, destination reconnected, balance restored);
- you checked `list_leads` and the leg really is failed or held;
- the lead is not still processing;
- you followed Asking first (on another account, the human said yes to this exact resend).

Pass `leadgen_id` exactly as `list_leads` returned it, and `list_id` to limit to one list. Duplicates are irreversible, so never resend to "see if it works". Delivery takes about a minute: poll `list_leads` and report what you see. The result's `skipped` explains legs it left alone (`success`, `not_failed`, `not_routed`, `other_list`).

## When to escalate to a human (do not act)

- A destination needs reconnecting. Only the customer can do OAuth.
- The same leg fails again after a resend.
- The fix needs a plan change, refund or billing action.
- The customer's data would be deleted or overwritten.
- Anything needs `override_limits`. It works only on LeadSync staff keys and is audited: never without the human's yes.

When escalating, give the human the account, list, lead id, the leg's error text and what you already tried. LeadSync support is at https://leadsync.me/account/support.

## Rules that bite

- Do not send a test lead to diagnose on a customer account unless the human agrees; it hits their real destination, and `acknowledge_customer_impact` is never sent without the human's yes.
- Mapping edits, pauses and resumes follow Asking first, like resends. A mapping edit replaces the whole mapping: only with the complete mapping from the human.
- Never print or ask for secrets.

## Edge cases

| Code | What to do |
| --- | --- |
| `lead_in_flight` | Still processing. Wait a minute, check `list_leads`, try again. |
| `lead_not_resendable` | No failed or held leg, or not a Meta lead. Read `detail`; likely case 3 or 4. |
| `conflict` | A resend would create a duplicate or a first delivery. Do not force it. Explain to the human. |
| `not_meta_source` | The lead is not from a Meta form. Resend is unavailable. |
| `not_found` | Wrong lead, list or account. Re-check ids and `account_id`. |
| `busy` | Retry once shortly. |
| `read_only_key` | Resend still works on read-only keys; mapping and pause changes do not. |
| `test_lead_forbidden` | This key may not send test leads. Do not work around it. |
