#pragma once
#include "memory.hpp"
#include <string>
#include <vector>

namespace byom {

enum class Faction : int { Unknown = 0, Lonestar = 1, Valkyra = 2, Manticore = 3 };
enum class LifeState : int { Unknown = 0, Alive = 1, Downed = 2, Dead = 3 };

struct RadarEntity {
  std::string id;
  std::string type; // player | vehicle | fob | control_zone | hotzone | ...
  Vec3 world{};
  double yaw = 0;
  bool position_known = true;
  int faction_enum = 0;
  int generic_team_id = 0xff;
  int squad_id = -1;
  bool is_self = false;
  bool is_squad = false;
  std::string life_state = "unknown";
  float hp = -1.f;
  float max_hp = -1.f;
  std::string name;
  std::string vehicle_name;
  std::string occupants;
  std::string possession;
  float radius_cm = 0.f;
};

struct RadarSnapshot {
  std::string local_faction = "unknown";
  std::vector<RadarEntity> entities;
};

/** Walk UWorld -> GameState -> PlayerArray and fill a radar snapshot. */
bool sample_roster(IMemory& mem, u64 module_base, RadarSnapshot& out);

/** POST snapshot JSON to the map ingest URL. */
bool post_ingest(const char* ingest_url, const RadarSnapshot& snap);

} // namespace byom
