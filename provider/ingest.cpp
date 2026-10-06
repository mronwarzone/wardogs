#include "radar.hpp"
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <Windows.h>
#include <winhttp.h>
#pragma comment(lib, "winhttp.lib")

#include <sstream>
#include <chrono>

namespace byom {
namespace {

std::string json_escape(const std::string& s) {
  std::string o;
  o.reserve(s.size() + 8);
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { o.push_back('\\'); o.push_back(static_cast<char>(c)); }
    else if (c < 0x20) { /* skip control */ }
    else o.push_back(static_cast<char>(c));
  }
  return o;
}

std::string build_json(const RadarSnapshot& snap) {
  const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
                       std::chrono::system_clock::now().time_since_epoch())
                       .count();
  std::ostringstream o;
  o << "{\"type\":\"snapshot\",\"localFaction\":\"" << json_escape(snap.local_faction) << "\",\"entities\":[";
  bool first = true;
  for (const auto& e : snap.entities) {
    if (!first) o << ',';
    first = false;
    o << "{\"id\":\"" << json_escape(e.id) << "\",\"type\":\"" << json_escape(e.type) << "\"";
    if (e.position_known) {
      o << ",\"world\":{\"x\":" << e.world.x << ",\"y\":" << e.world.y << ",\"z\":" << e.world.z << "}";
      o << ",\"yaw\":" << e.yaw;
    } else {
      o << ",\"positionKnown\":false";
    }
    o << ",\"factionEnum\":" << e.faction_enum;
    o << ",\"genericTeamId\":" << e.generic_team_id;
    if (e.squad_id >= 0) o << ",\"squadId\":" << e.squad_id;
    if (e.is_self) o << ",\"isSelf\":true";
    if (e.is_squad) o << ",\"isSquad\":true";
    o << ",\"lifeState\":\"" << json_escape(e.life_state) << "\"";
    if (e.hp >= 0.f && e.max_hp > 0.5f) o << ",\"hp\":" << e.hp << ",\"maxHp\":" << e.max_hp;
    if (!e.name.empty()) o << ",\"name\":\"" << json_escape(e.name) << "\"";
    if (!e.vehicle_name.empty()) o << ",\"vehicleName\":\"" << json_escape(e.vehicle_name) << "\"";
    if (!e.occupants.empty()) o << ",\"occupants\":\"" << json_escape(e.occupants) << "\"";
    if (!e.possession.empty()) o << ",\"possession\":\"" << json_escape(e.possession) << "\"";
    if (e.radius_cm > 0.f) o << ",\"radiusCm\":" << e.radius_cm;
    o << ",\"updatedAt\":" << now << '}';
  }
  o << "]}";
  return o.str();
}

bool http_post_json(const wchar_t* host, INTERNET_PORT port, const wchar_t* path, const std::string& body) {
  HINTERNET ses = WinHttpOpen(L"wardogs-radar-byom/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                              WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!ses) return false;
  HINTERNET con = WinHttpConnect(ses, host, port, 0);
  if (!con) { WinHttpCloseHandle(ses); return false; }
  HINTERNET req = WinHttpOpenRequest(con, L"POST", path, nullptr, WINHTTP_NO_REFERER,
                                     WINHTTP_DEFAULT_ACCEPT_TYPES, 0);
  if (!req) { WinHttpCloseHandle(con); WinHttpCloseHandle(ses); return false; }
  const wchar_t* headers = L"Content-Type: application/json\r\n";
  BOOL ok = WinHttpSendRequest(req, headers, (DWORD)-1L, (LPVOID)body.data(),
                               (DWORD)body.size(), (DWORD)body.size(), 0);
  if (ok) ok = WinHttpReceiveResponse(req, nullptr);
  WinHttpCloseHandle(req);
  WinHttpCloseHandle(con);
  WinHttpCloseHandle(ses);
  return ok == TRUE;
}

} // namespace

bool post_ingest(const char* ingest_url, const RadarSnapshot& snap) {
  // Default: http://127.0.0.1:3000/api/ingest
  const char* url = ingest_url && *ingest_url ? ingest_url : "http://127.0.0.1:3000/api/ingest";
  std::string u = url;
  // Tiny parse for http://host:port/path
  if (u.rfind("http://", 0) != 0) return false;
  u = u.substr(7);
  const auto slash = u.find('/');
  std::string hostport = slash == std::string::npos ? u : u.substr(0, slash);
  std::string path = slash == std::string::npos ? "/api/ingest" : u.substr(slash);
  INTERNET_PORT port = 80;
  std::string host = hostport;
  const auto colon = hostport.find(':');
  if (colon != std::string::npos) {
    host = hostport.substr(0, colon);
    port = static_cast<INTERNET_PORT>(std::atoi(hostport.c_str() + colon + 1));
  }
  wchar_t whost[256]{};
  wchar_t wpath[512]{};
  MultiByteToWideChar(CP_UTF8, 0, host.c_str(), -1, whost, 256);
  MultiByteToWideChar(CP_UTF8, 0, path.c_str(), -1, wpath, 512);
  const std::string body = build_json(snap);
  return http_post_json(whost, port, wpath, body);
}

} // namespace byom
