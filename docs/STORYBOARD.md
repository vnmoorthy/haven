# Haven: 3-minute pitch storyboard

**Format:** 10 slides (`deck/Haven-Pitch.pptx`, or `deck/index.html` for the scrolling motion version) with a 60–75 s live demo in the middle.
**Total:** 3:00. Timings are cumulative. Lines in quotes are what you say. *Italics* are stage directions.

**Before you go on stage**
- `npm run demo` is running.
- Browser tab 1 is the deck. Tab 2 is Haven HQ (Mission Control) with **voices ON**.
- Community traffic is running.
- Hit **Threat Lab → Phishing link** once beforehand so the Chromium sandbox is warm.

---

| # | Time | Slide / screen | What you say (≈ words) | On-screen motion / action |
|---|---|---|---|---|
| 1 | **0:00–0:15** | **Title**: *Haven: the AI Trust & Safety team every community deserves* | "Thirty million online communities are kept safe by volunteers who sleep. Scammers don't. We built **Haven**, a company where AI employees do Trust & Safety around the clock and a human founder makes the calls that matter." | Logo shield draws in. The 8 avatars fade in one by one along an arc. |
| 2 | **0:15–0:30** | **Problem** | "Phishing links, wallet-drainer airdrops, raids, harassment, and sometimes a member in crisis at 3 a.m. Human moderation costs about **$4.20 per incident**, and moderators burn out." | Stat counters tick up: 30M+ communities, $4.20 per incident, 3 a.m. |
| 3 | **0:30–0:45** | **Solution** | "Haven detects in under a second, investigates with real evidence, and cares for people. It's not a chatbot. It's a company: eight employees with jobs, a boss, and a paper trail." | The three pillars slide in: *Detect < 1s · Investigate with evidence · Care for humans*. |
| 4 | **0:45–1:00** | **Meet the team** (org chart) | "Aria is Chief of Staff and routes everything over **BAND**. Nova triages every message with a **RocketRide** pipeline. Rex detonates links in **Celesto** sandboxes using **AdaL**. Mira handles crises with a real face and voice from **Masky**. Kai audits bots with **Snyk**, **Tenki** and **Prelint**. Iris answers data questions with **PromptQL**. Juno owns policy. Leo runs growth on **n8n**." | Particles flow down the org-chart edges from Founder to Aria to the specialists. Sponsor chips pop next to each name. |
| 5 | **1:00–2:05** | **LIVE DEMO** *(switch to Haven HQ)* | "Let me show you. A scammer just posted a free-Premium link…" *Click Threat Lab → Phishing link.* "…Nova scored it and **quarantined it in under a second**. Watch the org chart: Nova reports to Aria, and Aria hands it to Rex over BAND. Rex is opening it in an isolated computer right now…" *Open the incident.* "…here's the actual credential-harvesting page he captured: password and 2FA fields posting to an outside host. Rex warns the channel out loud, and Juno adds the domain to our shared blocklist so next time it's caught in a millisecond. One thing the AI won't do on its own is ban a person. That's my call." *Click **Approve ban**.* "Done, and n8n logs it." *Back to Threat Lab → Member in crisis.* "And when someone is hurting…" *(Mira replies and speaks within seconds, with 988 and findahelpline)* "…Mira responds instantly, pages a human, and **never hides the message**." | Live: the constellation lights up, the BAND wire scrolls, the RocketRide stages tick green, the sandbox screenshot appears, and Rex's and Mira's voices play. *If Wi-Fi fails, play `deck/index.html` slide 6 (timeline animation) instead.* |
| 6 | **2:05–2:20** | **Safety & trust by design** | "Safety is designed in. Crisis messages are never auto-removed. Bans need a human. PII is redacted before any model sees it. These rules live in specs that **Prelint** checks on every PR, and CI runs on **Tenki** runners behind a **Snyk** gate. Kai even graded a sketchy bot **F**: critical CVEs, admin permissions, `eval` on user input." | Shield icons check off one by one. A flash of the Bot Audit grade **F**. |
| 7 | **2:20–2:35** | **Sponsor stack (14 tools)** | "Fourteen sponsor tools, each doing a real job. **Flatkey** gives every employee the right model tier with failover and per-call cost. **Paritok** compresses long memories. **Finch** skills make each employee better at its job. **Kylon** defines the workforce." | A 14-tile grid lights up in sequence along a moving loop path. |
| 8 | **2:35–2:48** | **Business** | "Starter is $49 a month, Growth $299, Enterprise custom. Our cost is about **one cent per incident versus $4.20** for a human. It's a $15-billion trust & safety market, and nearly every community is underserved." | The unit-economics bar shrinks from $4.20 to ~$0.01. The MRR curve draws itself. |
| 9 | **2:48–2:56** | **Vision** | "Every community deserves a Trust & Safety team that never sleeps and always cares. That's Haven." | The aurora background swells and the eight avatars line up. |
| 10 | **2:56–3:00** | **Ask / CTA** | "It's open source. Star it at **github.com/vnmoorthy/haven**. Thank you!" | QR code / GitHub URL. Applause. |

---

## Backup lines for Q&A

- **"Is this real or mocked?"** It's real. Every arrow is a code path. The sandbox screenshot comes from an actual headless Chromium run. Audits run real dependency scans (Snyk, or the OSV.dev fallback) and really execute the bot's tests in a sandbox. Each tool shows *live* or *local engine* on the Sponsor Stack page with a **Test connection** button.
- **"What if the AI is wrong?"** It recommends and the human decides. The founder can **dismiss**, which restores the message and sends Juno a request to tune the policy.
- **"Why BAND?"** Our employees are built with different tools: LLM agents, n8n workflows, RocketRide pipelines, an AdaL browser agent. BAND lets them delegate and report in one shared room, and with a key all 8 are registered on band.ai.
- **"Cost?"** Each Flatkey call is logged with tokens, model and dollars. Live numbers are on Mission Control and the Founder Briefing.
- **"Privacy?"** The RocketRide `anonymize_text` stage redacts emails, phones, cards and IPs before anything leaves the box.

## 10-minute extended demo (if you get the floor longer)

1. Mission Control tour (1:00)
2. Phishing takedown, incident room, approve (2:00)
3. Crisis, with Mira's voice and the human page (1:30)
4. Raid wave, then batch ban (0:45)
5. Bot Audits on RaidShield Pro: Snyk → Tenki → Prelint gives F (1:30)
6. Ask Haven: "Which kind of incident is most common?", then edit the wiki (1:00)
7. AI Workforce: chat with Kai, toggle a Finch skill, Paritok *Compress now* (1:00)
8. Pipelines & Flows: run the `message-triage.pipe` DAG live, then the n8n workflows (0:45)
9. Founder Briefing: Aria speaks and the investor metrics come up (0:30)
