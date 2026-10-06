#include "radar.hpp"
#include "offsets.hpp"
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <sstream>
#include <vector>

namespace byom {
namespace {

using i32 = std::int32_t;

struct TArray {
  u64 data = 0;
  i32 count = 0;
  i32 capacity = 0;
};

bool finite_world(const Vec3& v) {
  if (!std::isfinite(v.x) || !std::isfinite(v.y) || !std::isfinite(v.z)) return false;
  return std::abs(v.x) + std::abs(v.y) > 100.0;
}

const char* faction_slug(Faction f) {
  switch (f) {
    case Faction::Lonestar: return "lonestar";
    case Faction::Valkyra: return "valkyra";
    case Faction::Manticore: return "manticore";
    default: return "unknown";
  }
}

Faction faction_from_team(u8 team) {
  if (team == 0) return Faction::Lonestar;
  if (team == 1) return Faction::Valkyra;
  if (team == 2) return Faction::Manticore;
  return Faction::Unknown;
}

std::string hex_id(u64 p) {
  char buf[32];
  std::snprintf(buf, sizeof(buf), "0x%llX", static_cast<unsigned long long>(p));
  return buf;
}

bool read_fstring_narrow(IMemory& mem, u64 fstring_addr, std::string& out) {
  // FString: TArray<TCHAR> — data*, count, capacity
  TArray hdr{};
  if (!mem.read_t(fstring_addr, hdr)) return false;
  if (!user_ptr(hdr.data) || hdr.count <= 0 || hdr.count > 64) return false;
  std::vector<wchar_t> tmp(static_cast<std::size_t>(hdr.count) + 1, 0);
  if (!mem.read(hdr.data, tmp.data(), static_cast<std::size_t>(hdr.count) * sizeof(wchar_t))) return false;
  out.clear();
  for (int i = 0; i < hdr.count && tmp[static_cast<std::size_t>(i)]; ++i) {
    const wchar_t ch = tmp[static_cast<std::size_t>(i)];
    out.push_back(ch < 128 ? static_cast<char>(ch) : '?');
  }
  return !out.empty();
}

} // namespace

bool sample_roster(IMemory& mem, u64 module_base, RadarSnapshot& out) {
  out = {};
  if (!module_base) return false;

  u64 uworld = 0;
  if (!mem.read_ptr(module_base + offsets::RVA_WORLD, uworld) || !user_ptr(uworld)) return false;

  u64 game_state = 0;
  if (!mem.read_ptr(uworld + offsets::UWorld_GameState, game_state) || !user_ptr(game_state)) return false;

  TArray players{};
  if (!mem.read_t(game_state + offsets::GameState_PlayerArray, players)) return false;
  if (!user_ptr(players.data) || players.count <= 0 || players.count > 256) return false;

  // Local player pawn (best effort)
  u64 local_pawn = 0;
  u64 game_instance = 0;
  if (mem.read_ptr(uworld + offsets::UWorld_GameInstance, game_instance) && user_ptr(game_instance)) {
    TArray local_players{};
    if (mem.read_t(game_instance + offsets::GameInstance_LocalPlayers, local_players) &&
        user_ptr(local_players.data) && local_players.count > 0) {
      u64 lp = 0;
      if (mem.read_ptr(local_players.data, lp) && user_ptr(lp)) {
        u64 pc = 0;
        if (mem.read_ptr(lp + offsets::LocalPlayer_Controller, pc) && user_ptr(pc)) {
          mem.read_ptr(pc + offsets::Controller_Pawn, local_pawn);
        }
      }
    }
  }

  out.entities.reserve(static_cast<std::size_t>(players.count));
  for (i32 i = 0; i < players.count; ++i) {
    u64 ps = 0;
    if (!mem.read_ptr(players.data + static_cast<u64>(i) * 8, ps) || !user_ptr(ps)) continue;

    RadarEntity e{};
    e.type = "player";
    e.id = hex_id(ps);
    e.position_known = false;

    read_fstring_narrow(mem, ps + offsets::PlayerState_Name, e.name);

    u64 pawn = 0;
    mem.read_ptr(ps + offsets::PlayerState_PawnPrivate, pawn);
    if (user_ptr(pawn)) {
      e.id = hex_id(pawn);
      e.is_self = (pawn == local_pawn && user_ptr(local_pawn));

      u64 root = 0;
      if (mem.read_ptr(pawn + offsets::Actor_Root, root) && user_ptr(root)) {
        Vec3 loc{};
        // Prefer ComponentToWorld translation (world space).
        if (mem.read_t(root + offsets::Root_ComponentToWorld + offsets::Transform_Translation, loc) &&
            finite_world(loc)) {
          e.world = loc;
          e.position_known = true;
        } else if (mem.read_t(root + offsets::Root_Location, loc) && finite_world(loc)) {
          e.world = loc;
          e.position_known = true;
        }
      }

      // Live HP: CurrentBaseHealth (not catalog BaseHealth @ +0x130).
      u64 vit = 0;
      if (mem.read_ptr(pawn + offsets::Pawn_VitalityComponent, vit) && user_ptr(vit)) {
        float cur = -1.f, mx = -1.f;
        mem.read_t(vit + offsets::VitalityComponent_CurrentBaseHealth, cur);
        mem.read_t(vit + offsets::VitalityComponent_MaxHealth, mx);
        if (std::isfinite(cur) && std::isfinite(mx) && mx > 0.5f && cur >= 0.f) {
          e.hp = cur;
          e.max_hp = mx;
        }
      }

      u8 bleed = 0;
      mem.read_t(pawn + offsets::Pawn_VitalityState + offsets::VitalityState_Bleedout, bleed);
      if (bleed == 1 || bleed == 2) e.life_state = "downed";
      else if (e.hp >= 0.f && e.hp <= 0.01f) e.life_state = "dead";
      else if (e.hp > 0.01f) e.life_state = "alive";
    }

    // Faction via GenericTeamId on faction data when present.
    u64 fac_comp = 0;
    if (mem.read_ptr(ps + offsets::PlayerState_FactionComponent, fac_comp) && user_ptr(fac_comp)) {
      u64 fac_actor = 0;
      if (mem.read_ptr(fac_comp + offsets::FactionComponent_FactionActor, fac_actor) && user_ptr(fac_actor)) {
        u64 fac_data = 0;
        if (mem.read_ptr(fac_actor + offsets::FactionActor_Data, fac_data) && user_ptr(fac_data)) {
          u8 team = 0xff;
          mem.read_t(fac_data + offsets::FactionData_GenericTeamId, team);
          const Faction f = faction_from_team(team);
          e.faction_enum = static_cast<int>(f);
          e.generic_team_id = team;
          if (e.is_self) out.local_faction = faction_slug(f);
        }
      }
    }

    u64 squad = 0;
    if (mem.read_ptr(ps + offsets::PlayerState_SquadComponent, squad) && user_ptr(squad)) {
      i32 sid = -1;
      if (mem.read_t(squad + offsets::SquadComponent_Id, sid) && sid >= 0) e.squad_id = sid;
    }

    out.entities.push_back(std::move(e));
  }

  // Mark squad mates relative to self.
  int self_squad = -1;
  for (const auto& e : out.entities) {
    if (e.is_self) { self_squad = e.squad_id; break; }
  }
  if (self_squad >= 0) {
    for (auto& e : out.entities) {
      if (!e.is_self && e.squad_id == self_squad) e.is_squad = true;
    }
  }

  return !out.entities.empty();
}

} // namespace byom
