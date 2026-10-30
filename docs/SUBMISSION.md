# Scylla: hackathon submission kit

Track: **Indie** · Problem statement: **Push the Frontier** (agent security), with a "Build for Your World" angle (every assistant that reads your inbox needs this).

> Live numbers: see docs/LIVE_RESULTS.md. Mock numbers come from the deterministic offline benchmark (npm run bench, SCYLLA_PROVIDER=mock).

## One-liner
Scylla is a self-hardening firewall for AI agents. It sits between a tool-using Muse Spark agent and the world, stops prompt injections hidden in email, web pages, images and voicemail, and runs a red-team vs blue-team loop that writes and *replay-proves* its own new defenses.

## Submission description (≈150 words)
AI agents now read our email, browse the web and act with real tools, and a single hidden sentence in any of those inputs can hijack them (OWASP LLM01). Scylla is a drop-in firewall for tool-using agents. Every untrusted input passes an ingress pipeline: heuristics, a guard model (Muse Spark, or open-weights **Muse Spark Open** via Baseten when a Baseten key is set), **Muse Spark** vision for text hidden in images, **SAM 3.1** to localize the payload, and **Muse Voice Transcribe** for voicemail. Every side-effecting tool call passes an egress pipeline: DLP with canary taint tracking plus a **Muse Spark** judge that checks the call against what the user actually asked for. Scylla then attacks itself: a red-team agent invents new injections (including images it renders with **Muse Image**), and a blue-team agent proposes rules that ship only if replaying the whole corpus shows the bypass is blocked and zero benign tasks regress. Live on Muse Spark (contributor tier), Scylla caught 17 of 18 corpus attacks at ingress with zero flags on 10 benign tasks and zero false positives. Muse Spark itself turned out to be robust (0/18 attacks succeeded even unprotected), so Scylla is defense in depth: it stops injections before they reach the model and enforces egress policy that does not depend on the model refusing. Against a gullible agent model (our offline mock), attack success drops from 18/18 to 0/18 at 10/10 benign utility.

## Meta tooling map (rubric: 25%)
| Model | Role in Scylla |
|---|---|
| Muse Spark | the protected agent (tool calling), egress judge, red team, blue team (structured output) |
| Muse Spark (vision) | reads screenshots/receipts and flags instructions aimed at the AI, including faint and tiny text |
| SAM 3.1 | localizes the injected text region so the dashboard (and the redactor) can box it |
| Muse Voice Transcribe | voicemail → text before it reaches the agent |
| Muse Image | red team generates new image-borne attacks |
| Muse Spark Open (Baseten) | low-latency open-weights guard model on every ingress |

## 3-minute video script
| t | On screen | Voiceover |
|---|---|---|
| 0:00–0:15 | Inbox with "Q3 receipt.png" | "This is Atlas, a Muse Spark assistant with access to Dana's email, files and payments. Watch what one image does to it." |
| 0:15–0:45 | **Live intercept** → image-receipt scenario → *Unprotected vs Scylla* (mock agent: a deliberately gullible model). Left pane turns red: `DATA LEFT THE BUILDING`, canary highlighted | "Faint text in the receipt tells the agent to mail out the API keys. With a gullible agent and no firewall, it does, silently." |
| 0:45–1:15 | Right pane: ingress card, Muse Spark vision finding, SAM 3.1 box drawn on the image, ATTACK STOPPED, task still completed | "Behind Scylla, the same agent and the same image: vision reads the hidden line, SAM localizes it, and the content is sanitized before the agent ever sees it. The user's task still gets done." |
| 1:15–1:40 | Voicemail scenario, then the payment-redirect scenario held for human approval, click **Deny** | "It isn't just images. Voicemail goes through Muse Voice Transcribe. A payment to an account the user never mentioned is held for a human." |
| 1:40–2:25 | **Red vs Blue** tab → Run 3 rounds. Red log generates attacks, some bypass, blue proposes a rule, `shipped` / `rejected` badges, ASR curve drops | "Static filters lose. So Scylla attacks itself: the red team invents new injections, the blue team writes a rule, and the rule ships only if replaying every attack and every benign task proves it works. Rejected rules never ship." |
| 2:25–2:50 | **Benchmark** tab: big numbers | "Offline, with a gullible agent, attack success drops from 18 of 18 to 0 of 18 with all 10 benign tasks intact. Live on Muse Spark, Scylla flags 17 of 18 attacks before the model ever sees them, with zero false alarms, and Muse Spark refuses the rest. That's defense in depth." |
| 2:50–3:00 | Logo + repo URL | "Scylla. Open source, built on Meta's models. Put it in front of your agent." |

Recording tips: 1440×900 browser window, zoom 110%, run the off and enforce benchmarks once beforehand so the Benchmark tab is populated.

## X posts (viral bonus)
1. Our offline mock is deliberately gullible: without Scylla, 18/18 attacks succeed; with Scylla, 0/18 do. Live Muse Spark resisted the corpus even unprotected, while Scylla caught 17/18 attacks at ingress with zero benign flags. Defense in depth 🧵👇 [video]
2. Prompt injection is OWASP's #1 LLM risk. Live Muse Spark refused the corpus unprotected; Scylla caught 17/18 before the model saw them, with 0/10 benign flags. Against our gullible offline mock, Scylla drops attack success from 18/18 to 0/18. [repo]
3. My favourite part: Scylla rejects a blue-team rule when replay shows it breaks a benign task. On live Muse Spark, Scylla caught 17/18 corpus attacks at ingress with zero benign flags; the model resisted them even unprotected. Against a gullible offline mock, attack success drops from 18/18 to 0/18. [gif of Red vs Blue tab]
