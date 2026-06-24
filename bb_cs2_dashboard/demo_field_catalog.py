"""
Machine-derived catalog of fields surfaced by the repo's chosen CS2 demo stack (awpy → demoparser2).

No invented game-event columns: raw game-event tables are listed by event name with dynamic columns.
Tick player prop names follow awpy's `fix_common_names` rules where applicable.
"""

from __future__ import annotations

import importlib.metadata
from dataclasses import dataclass
from typing import Any, TypedDict


class FieldRow(TypedDict):
    path: str
    brief_type: str
    group: str
    notes: str


@dataclass(frozen=True)
class CatalogMeta:
    extraction: str
    awpy_version: str | None
    demoparser2_version: str | None
    disclaimer: str


def _pkg_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _tick_col_after_fix_common_names(prop: str) -> str:
    """Match awpy.parsers.utils.fix_common_names renames (suffix rules)."""
    if prop.endswith("last_place_name"):
        return prop[: -len("last_place_name")] + "place"
    if prop.endswith("team_name"):
        return prop[: -len("team_name")] + "side"
    if prop.endswith("armor_value"):
        return prop[: -len("armor_value")] + "armor"
    return prop


def build_catalog() -> dict[str, Any]:
    """Return a JSON-serializable catalog; raises ImportError if awpy is unavailable."""
    from awpy.demo import DEFAULT_EVENT_LIST, DEFAULT_PLAYER_PROPS

    awpy_v = _pkg_version("awpy")
    dp_v = _pkg_version("demoparser2")

    meta = CatalogMeta(
        extraction="awpy.Demo + demoparser2.DemoParser (as wired by awpy 2.x)",
        awpy_version=awpy_v,
        demoparser2_version=dp_v,
        disclaimer=(
            "These fields reflect awpy/demoparser2 in this image/build; game updates may add entity "
            "props or game-event keys. Raw `events.<name>` column sets are demo- and build-dependent "
            "(use demoparser2 on a representative .dem for `list_game_events` / per-event DataFrame "
            "columns). Native demoparser2 helpers not invoked by `Demo.parse()` (e.g. parse_player_info, "
            "parse_item_drops, parse_skins, parse_voice) are listed separately as optional tables. "
            "Default `Demo.parse()` only requests a minimal player prop set plus any `player_props` you "
            "pass; rows for names taken from awpy `DEFAULT_PLAYER_PROPS` are included here as tick props "
            "you can request—not all are populated by an unmodified `parse()` call."
        ),
    )

    base_parse_player_props = ["last_place_name", "X", "Y", "Z", "health", "team_name"]
    extended_props = sorted(set(base_parse_player_props + list(DEFAULT_PLAYER_PROPS)))

    in_play_only_world_props = [
        "game_time",
        "is_bomb_planted",
        "which_bomb_zone",
        "is_freeze_period",
        "is_warmup_period",
        "is_terrorist_timeout",
        "is_ct_timeout",
        "is_technical_timeout",
        "is_waiting_for_resume",
        "is_match_started",
        "game_phase",
    ]

    fields: list[FieldRow] = []

    def add(path: str, brief_type: str, group: str, notes: str) -> None:
        fields.append(
            {
                "path": path,
                "brief_type": brief_type,
                "group": group,
                "notes": notes,
            }
        )

    # --- tick frame (Demo.ticks after default parse pipeline) ---
    add(
        "ticks.tick",
        "int",
        "tick_frame",
        "Per-player rows; from demoparser2.parse_ticks.",
    )
    add(
        "ticks.steamid",
        "uint64",
        "tick_frame",
        "Cast UInt64 by awpy.fix_common_names.",
    )
    add(
        "ticks.name",
        "string",
        "tick_frame",
        "Player name on tick rows.",
    )
    add(
        "ticks.round_num",
        "int",
        "tick_frame",
        "Added by awpy.parsers.rounds.apply_round_num after parse.",
    )

    for prop in extended_props:
        col = _tick_col_after_fix_common_names(prop)
        add(
            f"ticks.{col}",
            "mixed",
            "tick_frame",
            f"Requested via `wanted_props` (`{prop}`); brief_type is engine-dependent.",
        )

    # --- used only for in-play tick filtering in default Demo.parse (not columns on self.ticks) ---
    for prop in in_play_only_world_props:
        add(
            f"(in_play_filter_only).{prop}",
            "mixed",
            "tick_filter_aux",
            "Passed to parse_ticks for `in_play_ticks` only; not merged into `Demo.ticks` by default parse.",
        )

    # --- grenades (parse_grenades output after awpy renames/select) ---
    for col, bt in [
        ("thrower_steamid", "uint64|string"),
        ("thrower", "string"),
        ("grenade_type", "string"),
        ("tick", "int"),
        ("X", "float"),
        ("Y", "float"),
        ("Z", "float"),
        ("entity_id", "int"),
        ("round_num", "int"),
    ]:
        add(f"grenades.{col}", bt, "grenade_throw", "Post-parse filter + round_num join in Demo.parse.")

    # --- timed smoke / inferno derived frames ---
    for col in ["entity_id", "start_tick", "end_tick", "X", "Y", "Z", "round_num"]:
        add(
            f"infernos.{col}",
            "int|float",
            "derived_area",
            "From inferno_startburn/inferno_expire via parse_timed_grenade_entity; thrower_* cols pass through from start event.",
        )
        add(
            f"smokes.{col}",
            "int|float",
            "derived_area",
            "From smokegrenade_detonate/expired via parse_timed_grenade_entity; thrower_* cols pass through from start event.",
        )
    add(
        "infernos.thrower_*",
        "mixed",
        "derived_area",
        "All start-event columns renamed user_→thrower_ (see awpy parse_timed_grenade_entity).",
    )
    add(
        "smokes.thrower_*",
        "mixed",
        "derived_area",
        "Same as infernos.thrower_*",
    )

    # --- bomb aggregate ---
    for col, bt in [
        ("tick", "int"),
        ("event", "string"),
        ("X", "float"),
        ("Y", "float"),
        ("Z", "float"),
        ("steamid", "uint64|string"),
        ("name", "string"),
        ("bombsite", "string|null"),
        ("round_num", "int"),
    ]:
        add(f"bomb.{col}", bt, "derived_bomb", "awpy.parsers.bomb.parse_bomb output + round_num.")

    # --- rounds table ---
    for col in [
        "round_num",
        "start",
        "freeze_end",
        "end",
        "official_end",
        "winner",
        "reason",
        "bomb_plant",
        "bomb_site",
    ]:
        add(f"rounds.{col}", "mixed", "derived_rounds", "awpy.parsers.rounds.create_round_df (+ bomb plant info).")

    # --- derived combat / audio tables ---
    add(
        "kills.*",
        "mixed",
        "derived_event",
        "player_death rows after awpy.parsers.events.parse_kills (user_→victim_, hitgroup mapped).",
    )
    add(
        "damages.*",
        "mixed",
        "derived_event",
        "player_hurt after parse_damages; includes computed dmg_health_real.",
    )
    add(
        "shots.*",
        "mixed",
        "derived_event",
        "weapon_fire after parse_shots (user_→player_).",
    )
    add(
        "footsteps.*",
        "mixed",
        "derived_event",
        "player_sound after parse_footsteps (user_→player_).",
    )

    add(
        "server_cvars.*",
        "mixed",
        "parser_native_table",
        "demoparser2.parse_event('server_cvar') via awpy.Demo.server_cvars cached property.",
    )

    add(
        "player_round_totals.name",
        "string",
        "derived_aggregate",
        "Unique name/steamid/side per round tallies.",
    )
    add(
        "player_round_totals.steamid",
        "string",
        "derived_aggregate",
        "",
    )
    add(
        "player_round_totals.side",
        "string",
        "derived_aggregate",
        'ct | t | "all".',
    )
    add(
        "player_round_totals.n_rounds",
        "int",
        "derived_aggregate",
        "",
    )

    # --- raw game events (keys = DEFAULT_EVENT_LIST / Demo.default_events) ---
    for ev_name in DEFAULT_EVENT_LIST:
        add(
            f"events.{ev_name}.*",
            "mixed",
            "game_event_raw",
            "Columns from demoparser2 for this game event; varies by demo and CS2 build.",
        )

    # --- demoparser2 surfaces not called by Demo.parse ---
    for fn, hint in [
        ("parse_header", "dict[str, str] keys vary by demo"),
        ("parse_player_info", "DataFrame columns demo-dependent"),
        ("parse_item_drops", "DataFrame columns demo-dependent"),
        ("parse_skins", "DataFrame columns demo-dependent"),
        ("parse_voice", "list[{tick, steamid, bytes}] per stubs"),
    ]:
        add(
            f"demoparser2.{fn}",
            "table|dict",
            "parser_native_optional",
            hint,
        )

    add(
        "demoparser2.list_game_events()",
        "list[str]",
        "parser_native_meta",
        "Per-demo; requires DemoParser(path) on a .dem file.",
    )
    add(
        "demoparser2.list_updated_fields()",
        "list[str]",
        "parser_native_meta",
        "Per-demo entity/prop names; requires DemoParser(path).",
    )

    fields.sort(key=lambda r: (r["group"], r["path"]))

    return {
        "meta": {
            "extraction": meta.extraction,
            "awpy_version": meta.awpy_version,
            "demoparser2_version": meta.demoparser2_version,
            "disclaimer": meta.disclaimer,
        },
        "fields": fields,
    }
