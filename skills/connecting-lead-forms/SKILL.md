---
name: connecting-lead-forms
description: Connects a Meta (Facebook or Instagram) lead form to a LeadSync destination such as Google Sheets, a CRM or email, maps the fields, optionally adds an autoresponder, and proves it with a test lead. Use when the user asks to "connect a lead form", "attach a form to a sheet", "set up lead delivery", "add an autoresponder", "send a test lead", "map the fields" or "set up LeadSync for a customer". Not for the key or account check (use leadsync-setup) or for a lead that did not arrive (use troubleshooting-lead-delivery).
license: MIT
metadata:
  version: "0.1.0"
  category: operations
  related-skills: "leadsync-setup, troubleshooting-lead-delivery"
  summary: "Attach a form to a destination, map fields, add an autoresponder, test and verify"
---

# Connecting lead forms

This skill follows the `connect_form_to_destination` MCP prompt, in the same order. You can run that prompt with `account_id`, `page_id`, `form_name` and `connection_name`, or follow the steps below by hand. Run `get_me` first if you have not (see leadsync-setup). On another account, pass `account_id` on every call.

## Model

A list joins one page and one form (or the page catch-all, `form_id: 'catch_all'`) to exactly one connection. To send a form to two destinations, attach it twice. The API cannot create connections or do OAuth: the destination connection must already exist, made by the customer in the LeadSync UI.

## Workflow

Map BEFORE attaching. `attach_form` creates the list and immediately replays up to 7 days of the form's leads using whatever mapping it was given. Attaching first and mapping second delivers that replay unmapped (blank Sheets rows marked success, junk CRM records, autoresponders still firing).

1. `get_connections`. Find the source whose `page.id` or `page.page_fb_id` matches (from here use `page.id`, the LeadSync id, as `page_id`), the form by name, and the connection by name. If anything is missing or matches twice, ask the human to confirm the ids. If the form is missing, call `refresh_forms` with the LeadSync page id and look again; its `leads_count` also shows whether the form is live, and `questions` lists each form's question keys.
2. `get_destination_fields` with the `connection_id`. For Google Sheets also pass `sheet_id`, the exact tab name: this proves the tab exists.
3. Build the mapping `{form_field_key: destination_field}`. Keys are lead field keys as delivered to destinations: Meta standard fields `first_name`, `last_name`, `full_name`, `email`, `phone_number` (`list_leads` shows `phone`, but the mapping key is `phone_number`), custom question keys: call `refresh_forms` for the page if you have not yet, and use `forms[].questions[].key` for this form (ask the human only if the form is not listed), and metadata keys `created_time`, `created_at` (m/d/Y date), `leadgen_id`, `platform`, `form_id`, `form_name`, `page_id`, `page_name`, `ad_account_id`, `ad_account_name`. Google Sheets also supports `leadsync:campaign_name`, `leadsync:adset_name`, `leadsync:ad_name`. Values are destination field names exactly as `get_destination_fields` returned them. Example for a Sheets tab with headers Date, First name, Email, Phone and the three leadsync columns:
   `{"created_at":"Date","first_name":"First name","email":"Email","phone_number":"Phone","leadsync:campaign_name":"leadsync:campaign_name","leadsync:adset_name":"leadsync:adset_name","leadsync:ad_name":"leadsync:ad_name"}`
4. `attach_form` with `page_id`, `form_id`, `form_name`, `connection_id`, `mapping` AND `settings` (`sheet_id` for Sheets) in ONE call. Gated (see Asking first). Note the `list_id`. It is idempotent on page, form and connection: an existing list comes back with `created: false`, `mapping_applied: false` and a `hint` (for example to resume a paused list with `set_list_active`). Say so, and follow the `set_mapping` rules below before touching that list's mapping.
5. Optional: `create_autoresponder` on the `connection_id` (gated). It attaches to the CONNECTION, not the list: every lead through that connection gets every autoresponder on it.
6. `send_test_lead` with the `list_id` (gated).
7. `list_leads` for the list to confirm the test lead's legs are success (delivery takes about a minute, so poll before calling it a failure), then `list_email_log` for the list to confirm the notification or autoresponder went out.

Finish with a short summary: ids used, mapping set, what the test lead and the email log showed.

## set_mapping is for existing lists only

`set_mapping` REPLACES the whole mapping with what you send; only settings keys are merged. Send `settings` alone to leave the mapping untouched. An empty mapping object clears it. No tool can read a list's current mapping (`get_connections` shows only `mapping_set`), so on a list with `mapping_set: true` never send `mapping` unless the human has given you the complete mapping. Otherwise the change is made in the LeadSync UI.

## Asking first

Reading (`get_*`, `list_*`, `find_accounts`) never needs a yes. For writes (`attach_form`, `set_mapping`, `set_list_active`, `create_autoresponder`, `send_test_lead`):
- On another account (`acting_on_other_account: true`, or you are passing `account_id`): state exactly what you will do and why, then wait for the human's yes. `create_autoresponder` counts: on another account there may be no 409, and it would start emailing the customer's prospects.
- `attach_form` on a form that is receiving live leads (`leads_count` above 0, or recent rows in `list_leads`): wait for the human's go-ahead on any account, because of the 7 day replay.
- On the key's own account: state what you will do, then proceed.

## Rules that bite

- Never send `acknowledge_customer_impact` (on `send_test_lead` for another account), `acknowledge_shared_connection` (on `create_autoresponder`) or `override_limits` (LeadSync staff keys only, audited) without the human's yes, on any account. Ask every time; never assume.
- Google Sheets: the spreadsheet is chosen on the connection (in the UI, via Google sign-in). `sheet_id` is the exact TAB NAME inside it, not the spreadsheet id. Ask the human for it: new Google Sheets often use "Sheet1", but a sheet created another way may be "Untitled". Pass it in `settings.sheet_id` on `attach_form`, and as `sheet_id` to `get_destination_fields`. A `destination_error` with a `sheet_id` usually means the tab name is wrong: check that before suggesting a reconnect.
- A test lead uses email `test+<id>@leadsync.me` and phone `+12025550123`. It flows into the REAL destinations (a sheet row, a CRM record, a notification). Autoresponders and SMS for it go to the account owner (subject prefixed "[Test lead]"), not the fake address. Meta lead forms only. Limit: 1 per form per minute, 20 per account per day.
- A second autoresponder on a connection means every lead gets two emails.

## Edge cases

| Code | What to do |
| --- | --- |
| `shared_connection_autoresponder` (409) | Show the human the `existing` autoresponders. Resend with `acknowledge_shared_connection: true` only if they agree. |
| `customer_impact_not_acknowledged` | Ask the human. Resend with `acknowledge_customer_impact: true` only if they agree. |
| `test_lead_forbidden` | The key cannot send test leads. Tell the human; do not work around it. |
| `test_lead_throttled` | Wait a minute (or until tomorrow if the daily 20 is hit). |
| `one_destination_per_list` | The list already has a destination. Attach the form again with the other connection instead. |
| `conflict` | Another active list covers this form and connection, or the page is not ready. Read `detail`, check `get_connections`. |
| `source_limit`, `forms_limit`, `autoresponder_limit`, `account_inactive` | A plan limit. Tell the human; `override_limits` needs their say-so. |
| `read_only_key` | The key cannot write. Stop. |
| `reconnect_required`, `meta_error` | Meta access has lapsed. Only the customer can reconnect in the UI. Escalate. |
| `not_meta_source` | The source is not a Meta lead form. Tools only cover Meta forms. |
| `not_found` | An id is wrong. Re-read `get_connections`. |
| `validation` | Fix the argument named in `detail`. |
| `busy` | Retry once after a few seconds. |
| `destination_error` | The destination refused the field lookup. Check the `sheet_id` tab name first, then the connection; a reconnect is the last resort. |
