# RaidShield Pro (DEMO SAMPLE — intentionally insecure)

A deliberately risky third-party community bot used by Haven's **Kai** (Security Engineer) to demo the
bot-audit flow: Snyk dependency + code scan → Tenki sandbox test run → Prelint spec check → grade.

Do **not** deploy this. It pins known-vulnerable dependencies, requests `ADMINISTRATOR`, evals user input,
shells out with user input, hardcodes and logs a (fake) token, and ships telemetry over plain HTTP.
