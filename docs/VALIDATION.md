# Validation status / Estado de validación

Last reviewed / Última revisión: 2026-09-25.

## Verified locally / Verificado localmente

| Area | Evidence | Result |
| --- | --- | --- |
| Room isolation | In-memory Convex test with 3 and 10 interleaved rooms and EN/ES/PT feeds | Pass |
| Console ownership | Wrong password and stale console writes are rejected after takeover | Pass |
| Final/partial behavior | Final lines stay unchanged; partial lines are replaced and cleared | Pass |
| Glossary isolation | Global, conference, and session terms are scoped in backend tests | Pass |
| Reconnect lifecycle | Ten `LiveTranslateStream` instances with a mocked transport, virtual 30 minutes, five forced drops per room | Pass |
| Reconnect buffer | Only the latest 5 seconds of audio survive a drop | Pass |
| Overlay parameters | Language, lines, font size, background, and color are bounded | Pass |
| Static checks | ESLint, TypeScript, Next.js production build | Pass, with one non-blocking pre-existing hook warning |

These deterministic tests do not contact Gemini or a Convex deployment.

## Verified with real services / Verificado con servicios reales

| Acceptance item | Evidence | Result |
| --- | --- | --- |
| English audio → EN, ES, PT | WAV simulator and live talk audio against Gemini (`gemini-3.5-live-translate-preview`) | Pass: ~1.1 s for the original and ~2.5 s for the translation after each sentence ends |
| Spanish audio → ES, EN | WAV simulator and a live Spanish talk captured from a browser tab | Pass |
| Portuguese output | ES → PT and PT → EN rooms in the 30-minute run | Pass |
| Glossary effectiveness | Same recording before/after adding terms; 30-minute run | Partial: "Nerdearla" fixed by the glossary; isolated misrecognitions remain (`Conve`, `Google Aires`) |
| 3 simultaneous rooms, 30 minutes | [real-3-room-30m-2026-09-25.md](../test-results/real-3-room-30m-2026-09-25.md): 1,088 source and 1,156 translated segments, 18 forced reconnections, 0 quota errors | Pass |
| Room isolation (real deployment) | Transcripts queried per session and language after the run; no cross-room or unexpected-language records | Pass |
| Automatic reconnection | Forced drops in the simulator and Gemini's own ~10-minute session closes during a real talk; captions continued after each reconnect | Pass |
| 10 simultaneous rooms | [real-load-2026-09-25.json](../test-results/real-load-2026-09-25.json): rooms created and isolated, but Gemini rejected part of the concurrent connections (WebSocket 1011) | Blocked by the Gemini project's concurrent-session quota |
| SRT export | Export from a real session opened in VLC | Pass |
| Production deploy | Vercel + Convex Cloud; QR → join popup on a simulated phone (4G, 4× CPU throttle) | Pass: 2.3–2.6 s (warm) |

## Cost boundary / Límite de costo

The simulator uses real Gemini and Convex resources and is never part of `npm test`. At the documented Gemini rate on 2026-09-25, a 30-minute test costs roughly USD 1.10 per target language per room before other services and taxes. Confirm current pricing and the room/language matrix before running it.
