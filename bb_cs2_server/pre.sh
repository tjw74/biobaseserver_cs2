#!/bin/bash
# PRE HOOK (sourced by joedwards32/cs2 entrypoint after SteamCMD install).
# Extracts Metamod, CounterStrikeSharp (BiobasePosEmitter), and optionally CS2KZ (+ SQL_MM) into game/csgo.

bb_cs2_patch_gameinfo() {
	local gi="${STEAMAPPDIR}/game/csgo/gameinfo.gi"
	if [[ ! -f "$gi" ]]; then
		echo "bb_cs2_server: gameinfo.gi not found yet; skip Metamod search path"
		return 0
	fi
	if grep -qF 'csgo/addons/metamod' "$gi"; then
		return 0
	fi
	echo "bb_cs2_server: patching gameinfo.gi for Metamod (SearchPaths)"
	# Typical CS2 layout: first Game + csgo entry in SearchPaths (tabs between fields).
	if sed -i '0,/\t\t\tGame\tcsgo/s//\t\t\tGame\tcsgo\/addons\/metamod\n&/' "$gi" 2>/dev/null; then
		return 0
	fi
	if sed -i '0,/\t\tGame\tcsgo/s//\t\tGame\tcsgo\/addons\/metamod\n&/' "$gi" 2>/dev/null; then
		return 0
	fi
	echo "bb_cs2_server: WARN: automatic gameinfo.gi patch failed; add 'Game    csgo/addons/metamod' to SearchPaths (see CS2 Metamod docs)"
}

CSGO="${STEAMAPPDIR}/game/csgo"
PROFILE_RAW="${BB_CS2_SERVER_PROFILE:-play}"
PROFILE_NORM="$(printf '%s' "$PROFILE_RAW" | tr '[:upper:]' '[:lower:]')"
case "$PROFILE_NORM" in
	practice|kz)
		PROFILE_KZ=1
		;;
	play)
		PROFILE_KZ=0
		;;
	*)
		echo "bb_cs2_server: WARN: unknown BB_CS2_SERVER_PROFILE='${PROFILE_RAW}', using play"
		PROFILE_NORM="play"
		PROFILE_KZ=0
		;;
esac

if [[ $PROFILE_KZ -eq 1 ]]; then
	echo "bb_cs2_server: profile=${PROFILE_NORM} → CS2KZ + developer cfg (practice)"
else
	echo "bb_cs2_server: profile=${PROFILE_NORM} → combat defaults; CS2KZ layer skipped"
fi

MM_TAR="/opt/bb-cs2-plugins/mmsource-2.0.0-git1396-linux.tar.gz"
CSS_ZIP="/opt/bb-cs2-plugins/counterstrikesharp-with-runtime-linux-1.0.367.zip"
MATCHZY_ZIP="/opt/bb-cs2-plugins/MatchZy-0.8.14.zip"
MATCHZY_MARK="${CSGO}/addons/counterstrikesharp/plugins/MatchZy/MatchZy.dll"
KZ_TAR="/opt/bb-cs2-plugins/cs2kz-linux-master.tar.gz"
SQL_MM_TAR="/opt/bb-cs2-plugins/sql_mm-linux.tar.gz"
BIO_DLL="/opt/bb-cs2-plugins/biobase_pos_emitter/BiobasePosEmitter.dll"
PLUGIN_ROOT="/opt/bb-cs2-plugins"

# When SteamCMD finishes a first-time install in the same container lifetime, this hook may have
# run once before gameinfo.gi existed (so plugins were skipped). Every later invocation should
# install anything still missing.
if [[ ! -f "${CSGO}/gameinfo.gi" ]]; then
	echo "bb_cs2_server: ${CSGO}/gameinfo.gi missing — CS2 not installed yet, skip addon layer this start"
else

if [[ ! -f "${CSGO}/addons/metamod/bin/linuxsteamrt64/metamod.2.cs2.so" ]]; then
	echo "bb_cs2_server: extracting Metamod 2.0 (CS2)"
	tar -xzf "${MM_TAR}" -C "${CSGO}"
fi

if [[ -f "${CSS_ZIP}" ]] && [[ ! -f "${CSGO}/addons/counterstrikesharp/bin/linuxsteamrt64/counterstrikesharp.so" ]]; then
	echo "bb_cs2_server: extracting CounterStrikeSharp (+ Metamod bridge for .NET plugins)"
	unzip -qo "${CSS_ZIP}" -d "${CSGO}"
fi

bb_cs2_install_biobase_pos_plugin() {
	if [[ ! -f "${BIO_DLL}" ]] || [[ ! -d "${CSGO}/addons/counterstrikesharp/plugins" ]]; then
		return 0
	fi
	mkdir -p "${CSGO}/addons/counterstrikesharp/plugins/BiobasePosEmitter"
	if ! cmp -s "${BIO_DLL}" "${CSGO}/addons/counterstrikesharp/plugins/BiobasePosEmitter/BiobasePosEmitter.dll" 2>/dev/null; then
		cp -f "${BIO_DLL}" "${CSGO}/addons/counterstrikesharp/plugins/BiobasePosEmitter/"
		echo "bb_cs2_server: installed BiobasePosEmitter CounterStrikeSharp plugin → plugins/BiobasePosEmitter/"
	fi
}
bb_cs2_install_biobase_pos_plugin

# MatchZy (CounterStrikeSharp): optional but default-enabled for production-ish stacks (`BB_CS2_ENABLE_MATCHZY`).
bb_cs2_enable_matchzy=1
case "$(printf '%s' "${BB_CS2_ENABLE_MATCHZY:-1}" | tr '[:upper:]' '[:lower:]')" in
	0|false|no|off|disabled) bb_cs2_enable_matchzy=0 ;;
esac

if [[ $bb_cs2_enable_matchzy -eq 1 ]] && [[ -f "${MATCHZY_ZIP}" ]]; then
	if [[ ! -f "${MATCHZY_MARK}" ]]; then
		if [[ ! -d "${CSGO}/addons/counterstrikesharp/plugins" ]]; then
			echo "bb_cs2_server: WARN: MatchZy zip present but CounterStrikeSharp plugins dir missing — install CSS first"
		else
			echo "bb_cs2_server: extracting MatchZy (CounterStrikeSharp plugin)"
			unzip -qo "${MATCHZY_ZIP}" -d "${CSGO}"
		fi
	else
		:
	fi
elif [[ $bb_cs2_enable_matchzy -eq 0 ]]; then
	echo "bb_cs2_server: MatchZy install skipped (BB_CS2_ENABLE_MATCHZY off)"
fi

if [[ $PROFILE_KZ -eq 1 ]]; then
	if [[ ! -f "${CSGO}/addons/sql_mm/bin/linuxsteamrt64/sql_mm.so" ]] && [[ -f "${SQL_MM_TAR}" ]]; then
		echo "bb_cs2_server: extracting SQL_MM (CS2KZ local SQLite / MySQL)"
		# Release asset is a POSIX tar (not gzip) despite .tar.gz name.
		tar -xf "${SQL_MM_TAR}" -C "${CSGO}"
	fi

	if [[ ! -f "${CSGO}/addons/cs2kz/bin/linuxsteamrt64/cs2kz.so" ]]; then
		echo "bb_cs2_server: extracting CS2KZ (KZGlobalTeam release)"
		tar -xzf "${KZ_TAR}" -C "${CSGO}"
	fi
fi

bb_cs2_patch_gameinfo

if [[ $PROFILE_KZ -eq 1 ]]; then
	# Always overlay CS2KZ server config so default mode stays Vanilla (VNL); must run after tarball extract.
	# https://docs.cs2kz.org/systems/modes
	BIOBASE_KZCFG="/opt/bb-cs2-plugins/cs2kz-server-config.biobase.txt"
	KZCFG_DEST="${CSGO}/cfg/cs2kz-server-config.txt"
	if [[ -f "${BIOBASE_KZCFG}" ]]; then
		mkdir -p "${CSGO}/cfg"
		cp -f "${BIOBASE_KZCFG}" "${KZCFG_DEST}"
		echo "bb_cs2_server: applied Biobase CS2KZ config -> ${KZCFG_DEST} (defaultMode Vanilla)"
	else
		echo "bb_cs2_server: WARN: missing ${BIOBASE_KZCFG}; CS2KZ uses stock config from tarball"
	fi

	# CS2KZ creates this dir mode 750; bb_data_collection (non-steam user) needs +rx to read SQLite for ingest.
	mkdir -p "${CSGO}/addons/cs2kz/data"
	chmod a+rX "${CSGO}/addons/cs2kz/data" 2>/dev/null || true
	find "${CSGO}/addons/cs2kz/data" -maxdepth 1 -type f -exec chmod a+r {} \; 2>/dev/null || true
	echo "bb_cs2_server: pre-hook addon layer done (Metamod + CounterStrikeSharp + CS2KZ)"
else
	echo "bb_cs2_server: pre-hook addon layer done (Metamod + CounterStrikeSharp + MatchZy if enabled; CS2KZ skipped)"
fi
fi

mkdir -p "${CSGO}/cfg" 2>/dev/null || true

# Cfgs bundled in the image → data volume cfg/
BIOB_DEVCFG="${PLUGIN_ROOT}/biobase_dev.cfg"
if [[ -f "${BIOB_DEVCFG}" ]] && [[ -d "${CSGO}/cfg" ]]; then
	cp -f "${BIOB_DEVCFG}" "${CSGO}/cfg/biobase_dev.cfg"
	echo "bb_cs2_server: applied Biobase dev cfg -> ${CSGO}/cfg/biobase_dev.cfg"
fi
BIOB_PLAYCFG="${PLUGIN_ROOT}/biobase_play.cfg"
if [[ -f "${BIOB_PLAYCFG}" ]] && [[ -d "${CSGO}/cfg" ]]; then
	cp -f "${BIOB_PLAYCFG}" "${CSGO}/cfg/biobase_play.cfg"
	echo "bb_cs2_server: applied Biobase play cfg -> ${CSGO}/cfg/biobase_play.cfg"
fi
BIOB_AUTOSTART="${PLUGIN_ROOT}/biobase_autostart.cfg"
if [[ -f "${BIOB_AUTOSTART}" ]] && [[ -d "${CSGO}/cfg" ]]; then
	cp -f "${BIOB_AUTOSTART}" "${CSGO}/cfg/biobase_autostart.cfg"
	echo "bb_cs2_server: applied Biobase autostart cfg -> ${CSGO}/cfg/biobase_autostart.cfg"
fi

STARTUP_CFG="${CSGO}/cfg/biobase_startup.cfg"
if [[ $PROFILE_KZ -eq 1 ]]; then
	cat >"${STARTUP_CFG}" <<'EOF'
exec biobase_dev
EOF
else
	cat >"${STARTUP_CFG}" <<'EOF'
exec biobase_play
exec biobase_autostart
EOF
fi
echo "bb_cs2_server: wrote ${STARTUP_CFG} (profile=${PROFILE_NORM})"

SERVER_CFG="${CSGO}/cfg/server.cfg"
BOOT_LINE="exec biobase_startup"
if [[ -d "${CSGO}/cfg" ]]; then
	if [[ ! -f "${SERVER_CFG}" ]]; then
		echo "${BOOT_LINE}" >"${SERVER_CFG}"
		echo "bb_cs2_server: wrote server.cfg with '${BOOT_LINE}'"
	else
		sed -i '/^exec biobase_dev$/d;/^exec biobase_play$/d;/^exec biobase_autostart$/d;/^exec biobase_startup$/d' "${SERVER_CFG}" 2>/dev/null || true
		if ! grep -qxF "${BOOT_LINE}" "${SERVER_CFG}" 2>/dev/null; then
			echo "${BOOT_LINE}" >>"${SERVER_CFG}"
			echo "bb_cs2_server: appended '${BOOT_LINE}' to server.cfg (re-exec after map loads)"
		fi
	fi
else
	echo "bb_cs2_server: WARN: ${CSGO}/cfg missing — could not merge server.cfg"
fi

GMS_SRC="${PLUGIN_ROOT}/gamemode_competitive_server.biobase.cfg"
if [[ -f "${GMS_SRC}" ]] && [[ -d "${CSGO}/cfg" ]]; then
	cp -f "${GMS_SRC}" "${CSGO}/cfg/gamemode_competitive_server.cfg"
	echo "bb_cs2_server: applied gamemode_competitive_server.cfg (delegates exec biobase_startup)"
fi
