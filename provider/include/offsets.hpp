#pragma once
#include <cstdint>

namespace byom {
using u64 = std::uint64_t;
using u32 = std::uint32_t;
using u8 = std::uint8_t;
namespace offsets {
// Dump vintage: wardoggys/dump 2026-09-24 (Level Actors / FactionTag verified
// in Engine_classes.h + WDGame_classes.h). GEngine from patch note 0x0D0C8AD0→
// 0x0CE22FA (normalized to 0xCE22FA0 — trailing nibble was truncated in the note).
inline constexpr u64 RVA_WORLD      = 0xD0CB998;
inline constexpr u64 RVA_NAMES      = 0xCE6CA30;
inline constexpr u64 RVA_OBJECTS    = 0xCF3F260; // FUObjectArray.ObjObjects.Objects (FUObjectItem**)
inline constexpr u64 RVA_OBJECT_CNT = 0xCF3F274; // FUObjectArray.ObjObjects.NumElements
inline constexpr u64 RVA_ENGINE     = 0xCE22FA0;

// GUObjectArray / FChunkedFixedUObjectArray (Wardogs UE5)
inline constexpr u64 FUObjectItem_Object = 0x08;
inline constexpr u32 FUObjectItem_Stride = 0x18;
inline constexpr u32 GUObject_ChunkSize = 65536;
inline constexpr u64 UStruct_SuperStruct = 0x40;

// UPrimitiveComponent / USceneComponent native layout.
// ComponentToWorld matches Mesh_ComponentToWorld; Bounds sits immediately after.
// LastRenderTime / LastRenderTimeOnScreen — engine occlusion result used by
// WDUILineOfSightRules (bRequireRenderedComponent). Prefer OnScreen for ESP.
inline constexpr u64 Primitive_LastRenderTime = 0x358;
inline constexpr u64 Primitive_LastRenderTimeOnScreen = 0x35C;
inline constexpr u64 Primitive_BodyInstance = 0x3A8;
inline constexpr u64 Landscape_BodyInstance = 0x5C8; // ULandscapeHeightfieldCollisionComponent
inline constexpr u64 BodyInstance_CollisionEnabled = 0x17;
inline constexpr u64 BodyInstance_CollisionResponses = 0x68; // FCollisionResponse → container @ +0
inline constexpr u64 CollisionResponse_WorldStatic = 0x00;
inline constexpr u64 CollisionResponse_Visibility = 0x03;
inline constexpr u8 ECR_Block = 2;
inline constexpr u8 CollisionEnabled_NoCollision = 0;
inline constexpr u64 SceneComponent_Bounds = 0x270; // FBoxSphereBounds after ComponentToWorld

inline constexpr u64 UWorld_GameInstance = 0x228;
inline constexpr u64 UWorld_Level = 0x30;
inline constexpr u64 UWorld_GameState = 0x1B0;
inline constexpr u64 GameState_PlayerArray = 0x2D0;
inline constexpr u64 GameInstance_LocalPlayers = 0x38;

// Current SDK master list (2026-09-14 dump). Keep legacy fallbacks so a
// partially stale runtime does not break an otherwise working build.
inline constexpr u64 LocalPlayer_Controller = 0x30; // proven live v20 chain
inline constexpr u64 LocalPlayer_ControllerDump = 0xC0; // dump-only candidate; not used for primary discovery
inline constexpr u64 Controller_PlayerStateDump = 0x2C0; // dump-only candidate
inline constexpr u64 Controller_Pawn = 0x360; // proven live v20 chain
inline constexpr u64 Controller_PawnDump = 0x2F8; // dump-only candidate
inline constexpr u64 Controller_CameraManager = 0x370;
inline constexpr u64 Level_Actors = 0xD0; // ULevel::Actors (dump 2026-09-24)
inline constexpr u64 Level_ActorsAlt = 0xA0; // validated alternate; StepWorldScan dual-probes

inline constexpr u64 Actor_Id = 0x18;
inline constexpr u64 Actor_Root = 0x1C0;
inline constexpr u64 Actor_PlayerState = 0x2D8;

// Supplied dump: inherited BHMover mesh plus both player-specific mesh fields.
// Candidate offsets do not prove which component supplies a usable live pose.
inline constexpr u64 Actor_PlayerMeshA_Dump = 0xB98;
inline constexpr u64 Actor_PlayerMeshB_Dump = 0xBA0;
inline constexpr u64 Actor_MeshAlt = 0xB98;
inline constexpr u64 Actor_MeshPrimary = 0x390;
inline constexpr u64 PlayerMeshOffsets[] = {0x390,0xB98,0xBA0};
inline constexpr u64 Root_Location = 0x168;
inline constexpr u64 Root_ComponentToWorld = 0x210; // live CTW; 0x1E0 rejects ParseTransform
inline constexpr u64 Transform_Translation = 0x20;

// Wardogs vitality / GE health (SDK dump 2026-09 + BHGameplayEffects).
// UWDVitalityComponent: +0x130 is BaseHealth (catalog), NOT live current.
// Live character HP is replicated via Client_UpdateCurrentHealthValues →
// CurrentBase/Overheal/Decay on UWDCharacterVitalityComponent, and/or
// UBHGameplayEffectComponent Attributes tagged Attribute.Gameplay.Health(.Max).
inline constexpr u64 Pawn_GameplayEffectComponent = 0x730; // UBHGameplayEffectComponent*
inline constexpr u64 Pawn_VitalityComponent = 0x738;       // UWDCharacterVitalityComponent*
inline constexpr u64 VitalityComponent_BaseHealth = 0x130; // catalog / init — never treat as current
inline constexpr u64 VitalityComponent_MaxHealth = 0x134;
inline constexpr u64 VitalityComponent_Health = 0x130; // legacy alias → BaseHealth (do not use as live)
inline constexpr u64 VitalityComponent_StatusObject = 0x140; // inside MISSED pad; keep for status chase
// UWDCharacterVitalityComponent (extends Vitality @ 0x150)
inline constexpr u64 VitalityComponent_MaxDecayHealth = 0x160;
inline constexpr u64 VitalityComponent_CurrentBaseHealth = 0x16C;    // NewBaseHealth
inline constexpr u64 VitalityComponent_CurrentOverhealHealth = 0x170; // NewOverhealHealth
inline constexpr u64 VitalityComponent_CurrentDecayHealth = 0x174;   // NewDecayHealth
inline constexpr u64 VitalityComponent_CharHealthBlock = 0x160; // legacy 5-float window
inline constexpr u32 VitalityComponent_CharHealthBlockSize = 0x14;
// UBHGameplayEffectComponent +0x3D8 FBHGameplayAttributeRepContainer; Attributes @ +0x118
inline constexpr u64 GameplayEffect_Attributes = 0x4F0; // TArray<FBHGameplayAttributeRepData>
inline constexpr u64 GameplayAttribute_Tag = 0x0C;
inline constexpr u64 GameplayAttribute_BaseValue = 0x18;    // double
inline constexpr u64 GameplayAttribute_CurrentValue = 0x20; // double — live
inline constexpr u32 GameplayAttribute_Stride = 0x38;
inline constexpr u64 VitalityStatusObject_State = 0x20;
// AWDMoverCharacter.CurrentDeathState : FWDCharacterVitalityState @ +0x7F4
// CurrentBleedoutState is EWDBleedoutState : uint8 @ +0x1C (not int32).
inline constexpr u64 Pawn_VitalityState = 0x7F4;
inline constexpr u64 VitalityState_Controller = 0x00;
inline constexpr u64 VitalityState_Tag = 0x08;
inline constexpr u64 VitalityState_Health = 0x10;
inline constexpr u64 VitalityState_HealthMax = 0x14;
inline constexpr u64 VitalityState_HealthAlt = 0x18;
inline constexpr u64 VitalityState_Bleedout = 0x1C; // EWDBleedoutState uint8
inline constexpr u32 VitalityState_ReadSize = 0x28;
inline constexpr u64 Pawn_VitalityStatesActive = 0x990; // TArray of live state objects
inline constexpr u64 Pawn_VitalityStates = 0x9A0; // TArray of Alive/Critical/Dead class defs
inline constexpr u64 Pawn_CurrentVitalityState = 0x9B0; // dump: float, not a UObject*
inline constexpr u64 VitalityStateObject_Tag = 0x28; // FGameplayTag on UWDPlayerVitalityState
inline constexpr u64 VitalityStateObject_Input = 0x30;
inline constexpr u64 VitalityStateObject_Flag = 0x38;
inline constexpr u64 Pawn_LifeFlags = 0x7F0; // 4 packed bools immediately before vitality struct
// AWDPlayerStateSession (decrypts.txt 2026-09-23)
inline constexpr u64 PlayerState_MatchStats = 0x528;
inline constexpr u64 PlayerState_SanitizedName = 0x5C0; // bool
inline constexpr u64 PlayerState_IsDeveloper = 0x5C1;
inline constexpr u64 PlayerState_IsAdmin = 0x5C2;
inline constexpr u64 PlayerState_IsReadyForMatch = 0x5C3;
inline constexpr u64 PlayerState_VitalityTag = 0x5C4; // VitalityStateTag FGameplayTag
inline constexpr u64 PlayerState_IdentityTags = 0x5D0;
inline constexpr u64 PlayerState_AnonymousMode = 0x5F1; // bool
// AWDPlayerState
inline constexpr u64 PlayerState_ClanTag = 0x3F0; // PlayerClanTag
// ABHBaseVehiclePawn
inline constexpr u64 Vehicle_Config = 0xA28;
inline constexpr u64 Vehicle_IsDestroyed = 0x830; // bIsVehicleDestroyed
inline constexpr u64 Vehicle_IsEngineRunning = 0x841;
inline constexpr u64 VehicleConfig_VariantTag = 0xB0;
inline constexpr u64 Explosive_ThrowParams = 0x318;
inline constexpr u64 Explosive_ThrowVelocity = 0x320; // FWDThrowParams.FVector
inline constexpr u64 Explosive_EntityId = 0x4B8;
inline constexpr u64 Grenade_Tag = 0x618;
inline constexpr u64 Item_Extensions = 0x2D8; // ABHItem TMap of extension components
inline constexpr u64 Item_Fragments = 0x368; // AWDItem TArray<UBHItemExtensionDataFragment*>
inline constexpr u64 Extension_Data = 0xE0; // UBHItemExtensionComponent fragment*
inline constexpr u64 Throwable_ThrowActions = 0x70; // TMap<FGameplayTag,FWDThrowSettings>
inline constexpr u64 ThrowSettings_Size = 0x90;
inline constexpr u64 ThrowPair_Size = 0x98; // FGameplayTag + FWDThrowSettings
inline constexpr u64 ThrowAction_UseConsistentVelocity = 0x00;
inline constexpr u64 ThrowAction_ThrowVelocity = 0x04; // float cm/s
inline constexpr u64 ThrowAction_OwnerVerticalInfluence = 0x10;
inline constexpr u64 ThrowAction_OwnerHorizontalInfluence = 0x14;
inline constexpr u64 ThrowAction_SpawnOffset = 0x50; // FVector
inline constexpr u64 ThrowAction_ThrowTypeTag = 0x6C;
inline constexpr u64 SceneComponent_Velocity = 0x188;
inline constexpr u64 Pawn_Inventory = 0x748;
inline constexpr u64 Inventory_HeldSlot = 0x5A0; // slot tag: Primary / Secondary, not the gun
inline constexpr u64 Inventory_HeldTag = 0x5A0; // legacy alias
inline constexpr u64 Inventory_HeldItem = 0x8C8; // ABHItem* currently in hands
inline constexpr u64 Inventory_HeldItemAlt = 0xA78;
inline constexpr u64 Pawn_VehicleOperator = 0x758;
inline constexpr u64 VehicleOperator_CurrentSeat = 0x188; // UObject* seat (validated)
inline constexpr u64 VehicleOperator_SeatState = 0x198; // FMOperatorReplicatedState fallback
inline constexpr u64 VehicleOperator_ReplicatedState = 0x198; // alias
inline constexpr u64 Pawn_WeaponBehavior = 0x770;
inline constexpr u64 WeaponBehavior_Item = 0x42C; // packed ABHItem*
inline constexpr u64 Item_Tag = 0x328; // ABHItem gameplay tag
inline constexpr u64 UObject_Class = 0x10;
inline constexpr u64 UObject_Name = 0x18;
inline constexpr u64 UObject_Outer = 0x20;

inline constexpr u64 Mesh_SkeletalMesh = 0x5A8;
inline constexpr u64 Mesh_SkinnedAsset = 0x5B0;
inline constexpr u64 Mesh_ComponentToWorld = 0x210; // live CTW (Bounds @ 0x270); ref 0x1E0 is stale
inline constexpr u64 SkinnedAsset_RawRefBoneInfo = 0x2E0;
inline constexpr u32 MeshBoneInfoStride = 0x0C;

inline constexpr u64 PlayerState_PawnPrivate = 0x330;
inline constexpr u64 PlayerState_PlayerId = 0x2BC;
inline constexpr u64 PlayerState_Score = 0x2B8;
inline constexpr u64 PlayerState_CompressedPing = 0x2C0;
inline constexpr u64 PlayerState_Name = 0x350;
inline constexpr u64 PlayerState_FactionComponent = 0x4F0;
inline constexpr u64 PlayerState_SquadComponent = 0x4F8;
// UWDFactionComponent still has tags at 0x100 and 0x110. Dump names OnRep
// FactionTag @ 0x100; live team FNames currently classify from 0x110 — code
// reads both and picks the one that maps to a faction.
inline constexpr u64 FactionComponent_FactionTag = 0x100;
inline constexpr u64 FactionComponent_TagA = 0x100;
inline constexpr u64 FactionComponent_TagB = 0x110;
inline constexpr u64 FactionComponent_FactionActor = 0x128;
inline constexpr u64 FactionActor_Data = 0x2C8;
// AWDGameStateSession
inline constexpr u64 GameState_Factions = 0x448;
inline constexpr u64 GameState_WinningFaction = 0x4A0;
inline constexpr u64 GameState_MatchStateFlags = 0x4E8;
inline constexpr u64 FactionData_Tag = 0x30;
inline constexpr u64 FactionData_Color = 0x58; // UWDFactionData.FactionColor (was 0x5C guess)
inline constexpr u64 FactionData_GenericTeamId = 0x108;
inline constexpr u64 FactionData_TagA = 0x10C;
inline constexpr u64 FactionData_TagB = 0x114;
inline constexpr u64 SquadComponent_Id = 0x140;

// Control zone / FOB / hotzone (ControlZoneRuntime + BuildablesRuntime, dump 2026-09-24)
// AWDControlZone
inline constexpr u64 ControlZone_ControlZoneComponent = 0x320; // UWDZoneComponent*
inline constexpr u64 ControlZone_HotZoneComponent = 0x328;     // UWDZoneComponent*
inline constexpr u64 ControlZone_IsActive = 0x461;             // bool bIsActive
inline constexpr u64 ControlZone_ControlState = 0x6D0;         // FWDZoneControlStateData
// FWDZoneControlStateData: OwningFaction FGameplayTag @ +0, ControlledState @ +8
inline constexpr u64 ZoneControlState_OwningFaction = 0x0;
inline constexpr u64 ZoneControlState_ControlledState = 0x8;
// UWDZoneComponent (USceneComponent): dump called this ScaledExtents, but live
// memory is FBoxSphereBounds @ SceneComponent_Bounds (Origin+BoxExtent+SphereRadius).
// Reading Origin as a radius produced ~80–100km rings on the map.
inline constexpr u64 ZoneComponent_ScaledExtents = 0x270; // legacy alias → Bounds.Origin
inline constexpr u64 ZoneComponent_Bounds = 0x270;
inline constexpr u64 ZoneComponent_BoxExtent = 0x288;     // Bounds + 0x18 (FVector3d)
inline constexpr u64 ZoneComponent_SphereRadius = 0x2A0;  // Bounds + 0x30 (float)
inline constexpr u32 ZoneComponent_BoundsPackSize = 0x38;
// AWDBuildableSpawnedActor / AB_ForwardOperatingBase
inline constexpr u64 BuildableSpawned_BuildableComponent = 0x2D0; // UWDBuildableComponent*
inline constexpr u64 BuildableComponent_FactionComponent = 0x118;
inline constexpr u64 ForwardOperatingBase_FobComponent = 0x328; // UWDForwardOperatingBaseComponent*
inline constexpr u64 FobComponent_FactionTag0 = 0x1D0;          // first of four FGameplayTags
// AWDHotZoneMagnet
inline constexpr u64 HotZoneMagnet_FactionComponent = 0x2D8;
inline constexpr u64 HotZoneMagnet_CapturingFaction = 0x310; // FGameplayTag
// Defaults when extents unread (meters×100). Keep modest — capture rings, not km discs.
inline constexpr float DefaultFobRadiusCm = 10000.0f;          // 100m
inline constexpr float DefaultControlZoneRadiusCm = 12000.0f;  // 120m
inline constexpr float DefaultHotZoneRadiusCm = 8000.0f;       // 80m

inline constexpr u32 TransformStride = 0x60;
// Runtime layouts vary. Prefer live bone-space candidate first (draws); A18
// component-space is still probed as fallback when A08 is rejected.
inline constexpr u64 BoneArrayOffsets[] = {0xA08, 0xA18, 0x620, 0x630};
inline constexpr u64 CameraOffsets[] = {0x1560, 0x1E40};
// Cached view-projection is discovered at runtime (ULocalPlayer / FSceneViewState /
// FViewMatrices). There is no shipped pointer-shaped offset for it.
inline constexpr int MaxActors = 8192;

inline constexpr u64 NamePoolBlocksOffset = 0x10; // validated current FNamePool block table
inline constexpr u32 NameEntryStride = 0x08;
inline constexpr u32 NameEntryHeaderOffset = 0x08;
inline constexpr u32 NameEntryDataOffset = 0x0C;
inline constexpr u32 NameMask = 0xFFFF;
inline constexpr u32 NameChunkShift = 16;

struct BoneSpan { int first; int last; };
inline constexpr BoneSpan LiveBoneSpans[] = {
    {0, 12}, {22, 22}, {64, 66}, {76, 76}, {122, 124}, {145, 147}
};
}
} // namespace byom
