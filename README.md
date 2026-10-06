# Wardogs Tactical Radar (BYOM)

Browser map + C++ provider. Plug your read into `IMemory`, it walks the game and feeds the map.

**Forum paste:** copy `FORUM_POST.txt` (BBCode). Do not paste this README into phpBB.

## Maps

Tiles are not in the zip. Extract them from your own Paks first (Python 3.10+ and .NET SDK):

```
python extract_maps.py --paks "E:\SteamLibrary\steamapps\common\Wardogs\Wardogs\Content\Paks" --usmap "C:\path\to\507_Wardogs_release.usmap"
```

Writes `public/maps` + `public/icons`. Defaults and AES are in the script.

## Map UI

```
cd wardogs-radar-byom
npm install
npm run dev
```

http://127.0.0.1:3000 or `START_MAP_FAST.bat`

## Provider

x64 VS prompt:

```
cd provider
build.bat
build\wardogs-provider.exe
```

Basic RPM backend included. Swap it in `main.cpp`.

## Your backend

```
bool read(u64 address, void* dst, size_t size);
u64 module_base(const char* module_name);
```

Stub: `provider/backends/YOUR_BACKEND.cpp.example`

## Already does

- UWorld -> GameState -> PlayerArray
- name / pawn / world pos / faction / squad / HP
- isSelf from local controller
- POST ~20Hz to /api/ingest

Vehicles / FOBs / hotzone offsets in `offsets.hpp`. Extend `discovery.cpp` when you want.

Patch? Update `provider/include/offsets.hpp`.

JSON only? See `INGEST.md`.
