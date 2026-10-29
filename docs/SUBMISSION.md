# Warden: hackathon submission kit

Track: **Indie** · Problem statement: **Push the Frontier** (agent security), with a "Build for Your World" angle (every assistant that reads your inbox needs this).

> Numbers marked ⟨…⟩ are filled in from `npm run bench` output. Never hand-type them.

## One-liner
Warden is a self-hardening firewall for AI agents. It sits between a tool-using Muse Spark agent and the world, stops prompt injections hidden in email, web pages, images and voicemail, and runs a red-team vs blue-team loop that writes and *replay-proves* its own new defenses.

## Submission description (≈150 words)
AI agents now read our email, browse the web and act with real tools, and a single hidden sentence in any of those inputs can hijack them (OWASP LLM01). Warden is a drop-in firewall for tool-using agents. Every untrusted input passes an ingress pipeline: heuristics, a guard model on **Muse Spark Open** (open weights, via Baseten), **Muse Spark** vision for text hidden in images, **SAM 3.1** to localize the payload, and **Muse Voice Transcribe** for voicemail. Every side-effecting tool call passes an egress pipeline: DLP with canary taint tracking plus a **Muse Spark** judge that checks the call against what the user actually asked for. Warden then attacks itself: a red-team agent invents new injections (including images it renders with **Muse Image**), and a blue-team agent proposes rules that ship only if replaying the whole corpus shows the bypass is blocked and zero benign tasks regress. On our 28-scenario benchmark, attack success drops from ⟨off ASR⟩ to ⟨enforce ASR⟩ at ⟨utility⟩ benign utility.

## Meta tooling map (rubric: 25%)
| Model | Role in Warden |
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
| 0:15–0:45 | **Live intercept** → image-receipt scenario → *Unprotected vs Warden*. Left pane turns red: `DATA LEFT THE BUILDING`, canary highlighted | "Faint text in the receipt tells the agent to mail out the API keys. Unprotected, it does, silently." |
| 0:45–1:15 | Right pane: ingress card, Muse Spark vision finding, SAM 3.1 box drawn on the image, ATTACK STOPPED, task still completed | "Behind Warden, the same agent and the same image: vision reads the hidden line, SAM localizes it, and the content is sanitized before the agent ever sees it. The user's task still gets done." |
| 1:15–1:40 | Voicemail scenario, then the payment-redirect scenario held for human approval, click **Deny** | "It isn't just images. Voicemail goes through Muse Voice Transcribe. A payment to an account the user never mentioned is held for a human." |
| 1:40–2:25 | **Red vs Blue** tab → Run 3 rounds. Red log generates attacks, some bypass, blue proposes a rule, `shipped` / `rejected` badges, ASR curve drops | "Static filters lose. So Warden attacks itself: the red team invents new injections, the blue team writes a rule, and the rule ships only if replaying every attack and every benign task proves it works. Rejected rules never ship." |
| 2:25–2:50 | **Benchmark** tab: big numbers | "Across 28 scenarios and 6 vectors, attack success drops from ⟨off⟩ to ⟨enforce⟩ with ⟨utility⟩ of benign tasks untouched, at ⟨latency⟩ median overhead." |
| 2:50–3:00 | Logo + repo URL | "Warden. Open source, built on Meta's models. Put it in front of your agent." |

Recording tips: 1440×900 browser window, zoom 110%, run the off and enforce benchmarks once beforehand so the Benchmark tab is populated.

## X posts (viral bonus)
1. I hid one faint line of text in a receipt image. A Muse Spark agent read it and emailed out our API keys. Then I put Warden in front of it 🧵👇 [video]
2. Prompt injection is OWASP's #1 LLM risk, and agents that read email and images are wide open. Warden: an open-source firewall that red-teams itself and only ships defenses it can prove. Built with @AIatMeta Muse Spark, SAM 3.1 and Muse Spark Open. [repo]
3. My favourite part: the blue-team agent proposes a new rule, and Warden *rejects* it because replay showed it broke a benign task. Self-improving security that refuses to regress. [gif of Red vs Blue tab]
