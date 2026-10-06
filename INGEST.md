# Ingest API

Your provider POSTs JSON. The map draws it. That is the whole contract.

Base URL (dev): `http://127.0.0.1:3000`

| Method | Path | Who |
|--------|------|-----|
| `POST` | `/api/ingest` | your reader / provider |
| `GET` | `/api/live` | browser SSE |
| `GET` | `/api/entities` | poll fallback |

## Snapshot (full replace)

```json
{
  "type": "snapshot",
  "localFaction": "lonestar",
  "entities": [ /* LiveEntity[] */ ]
}
```

Post at ~10 to 20 Hz. World XY = Unreal cm.

## Delta

```json
{
  "type": "delta",
  "upsert": [ /* entities to add/update */ ],
  "remove": [ "id1", "id2" ]
}
```

## Example player

```json
{
  "id": "0xPAWN...",
  "type": "player",
  "world": { "x": -800000, "y": -1200000, "z": 200 },
  "yaw": 90,
  "factionEnum": 1,
  "genericTeamId": 0,
  "factionColorBGRA": [255, 150, 55, 255],
  "squadId": 42,
  "isSelf": false,
  "isSquad": true,
  "lifeState": "alive",
  "hp": 100,
  "maxHp": 100,
  "name": "Alpha",
  "updatedAt": 1710000000000
}
```

`factionEnum`: `0` unknown, `1` lonestar, `2` valkyra, `3` manticore.

## Faction colours (defaults)

| Faction | Hex |
|---------|-----|
| Lonestar | `#3796FF` |
| Valkyra | `#FF4141` |
| Manticore | `#3CE669` |
| Unknown | `#C7C7C7` |

Prefer live `factionColorBGRA` when you have it.

## Other entity types

`vehicle`, `grenade`, `mine`, `deployable`, `fob`, `control_zone`, `hotzone`, `corpse`, etc.

FOB / control zone: send `possession` + `radiusCm` when you have them.

Vehicles: `vehicleName`, optional `occupants` string.

Full schema: `src/lib/protocol.ts`.

## Telemetry / match ops (optional)

Same `POST /api/ingest`:

```json
{
  "type": "telemetry",
  "matchId": "raid-01",
  "events": [
    {
      "id": "k1",
      "kind": "kill",
      "t": 1710000000000,
      "actorId": "0xA",
      "actorName": "Alpha",
      "actorFaction": "lonestar",
      "targetId": "0xB",
      "targetName": "Bravo",
      "targetFaction": "valkyra",
      "weapon": "AS Val",
      "rangeM": 87
    }
  ]
}
```

Or attach `events` on a normal `snapshot` / `delta`.

`kind`: `kill` | `down` | `revive` | `vehicle_claim` | `vehicle_destroy` | `join` | `leave` | `ping` | `note`

If you send no events, the web still infers join/leave/down/kill/revive from `lifeState` flips so OPS is not empty.

## Provider checklist

1. Every roster pawn -> one `type:"player"` entity. Set `positionKnown:false` if you have no world root yet. Do not filter by overlay distance.
2. Vehicles -> `type:"vehicle"`.
3. `isSelf` from your local pawn. `isSquad` from matching squad id.
4. POST snapshot or delta. Done.
