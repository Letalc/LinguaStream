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

These deterministic tests do not contact Gemini, a Convex deployment, OBS, VLC, or a streaming platform.

## Requires real-service validation / Requiere validación con servicios reales

| Acceptance item | Required evidence | Status |
| --- | --- | --- |
| English audio → EN and ES under 5 s | Timestamped microphone/WAV run against Gemini | Pending |
| Spanish audio → ES and EN | Timestamped microphone/WAV run against Gemini | Pending |
| Portuguese and glossary effectiveness | Before/after sample using the same recording | Pending |
| 3–10 simultaneous real rooms | Finite paid run with isolated transcripts and quota log | Pending budget approval |
| Continuous 30-minute session | Real-clock run with forced network drop | Pending budget approval |
| OBS/vMix overlay | Browser Source recording showing transparency | Pending local app |
| SRT/VTT in VLC | Export from a real session opened over matching video | Pending local app |
| Large audience | Load scenario matching simultaneous web viewers and Convex plan | Pending plan and concurrency estimate |

## Cost boundary / Límite de costo

The simulator uses real Gemini and Convex resources and is never part of `npm test`. At the documented Gemini rate on 2026-09-25, a 30-minute test costs roughly USD 1.10 per target language per room before other services and taxes. Confirm current pricing and the room/language matrix before running it.
