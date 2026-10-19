---
name: PII Redaction
description: Detect and redact personal data in community messages, evidence and reports before they are stored, shared or sent to a model.
owner: nova
version: 1.0.0
tags: [privacy, pii, redaction, compliance, doxxing]
---

# PII Redaction

## When to use
- Before any message text is placed into a report, BAND payload, wiki entry or external model prompt.
- When a message itself is doxxing (posting someone's address, phone, real name + location).

## Instructions
1. Detect: email addresses, phone numbers, street addresses, government ids, payment card numbers (Luhn-check), IBANs, crypto seed phrases (12/24 BIP-39 words), passwords / API keys / tokens, IP addresses, exact geolocation, and full real names linked to a handle.
2. Replace with typed placeholders that keep meaning: `[EMAIL]`, `[PHONE]`, `[ADDRESS]`, `[CARD-****1234]`, `[SEED-PHRASE]`, `[SECRET]`.
3. Keep the original only in the access-controlled incident evidence store; everything downstream gets the redacted version.
4. If the message is doxxing another person, label it `harassment` with severity >= high, quarantine it, and notify the target privately.
5. If a member posts their own secret (seed phrase, password), hide the message immediately and DM them to rotate it — this is an account-safety emergency, not a violation.
6. Never echo the detected value back in any reply.

## Output format
```json
{ "redacted": "text with [PLACEHOLDERS]", "found": [{ "type": "email", "count": 1 }], "doxxing": false, "selfExposure": false }
```
