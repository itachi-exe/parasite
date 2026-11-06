# Current public release

The public demo uses simulated, server-managed roles. The separate Inco integration is not active in this release.

## Included

- Three.js outpost and crew, directional sight, bot-filled solo rounds, meetings, voting and simulated infection transfer.
- Static-export frontend with mobile Play-button layout correction.
- Reduced gameplay postprocessing, pixel ratio 1, disabled gameplay shadow maps and a nearest-four room-light budget. Cinematic previews retain their separate defaults.
- Engine preload after joining the waiting room.
- Backend room, packet-size and application-packet limits, with production-origin checks.

## Verification scope

The launch evidence records 192 passing tests, a clean typecheck and production build, plus 600 seconds of automated socket play. The later performance release records 194 passing tests and successful public mobile-sized and desktop browser gameplay probes. These automated checks do not establish real-phone performance, artistic approval or the optional Inco path's confidentiality.

## Publication

Source publication was authorized on November 6, 2026. Internal infrastructure configurations, raw operational logs and backup files are not included in the release commit. This publication does not deploy contracts, change the live website or submit a hackathon entry.
