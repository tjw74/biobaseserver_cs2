# Biobase CS2 dedicated server: joedwards32/cs2 + Metamod:Source 2 (CS2) + CounterStrikeSharp
# (+ optional CS2KZ when BB_CS2_SERVER_PROFILE is practice|kz). BiobasePosEmitter prints BIOBASE_POS_JSON.

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS biobase_pos_plugin_build
WORKDIR /work
COPY biobase_pos_emitter/ ./
RUN dotnet publish BiobasePosEmitter.csproj -c Release -o /plugin_out

FROM joedwards32/cs2:latest

USER root

ARG METAMOD_TAG=2.0.0.1396
ARG METAMOD_FILE=mmsource-2.0.0-git1396-linux.tar.gz
ARG METAMOD_SHA256=22a6b00932b9d14f014ad09754e28d6ad54a9d81649584c772e7cd2213b0c3ef

ARG CSSHARP_TAG=v1.0.367
ARG CSSHARP_ZIP=counterstrikesharp-with-runtime-linux-1.0.367.zip
ARG CSSHARP_SHA256=05047d980999854c3c4531fd6be9630c1df151d81d114fbcb0e7f54c0a5b8a57

ARG CS2KZ_TAG=v0.0.125
ARG CS2KZ_FILE=cs2kz-linux-master.tar.gz
ARG CS2KZ_SHA256=e221676f60bcd907dbb8117fefad5768f3843cddd8b384c4e8e101eacde46ffd

# Optional for upstream CS2KZ but required for local SQLite gameplay DB (times, jumpstats, players).
# https://github.com/zer0k-z/sql_mm — CS2KZ README: SQL_MM v1.3.4.2+
ARG SQL_MM_TAG=1.3.4.2
ARG SQL_MM_FILE=package-linux.tar.gz
ARG SQL_MM_SHA256=e0587e682994e99ccb801c124afd2f53d175f7e73fc81568bf9ed2f966333fd5

ARG MATCHZY_TAG=0.8.14
ARG MATCHZY_ZIP=MatchZy-0.8.14.zip
ARG MATCHZY_SHA256=b8f409f6286efe541c8257f5e15973c99ee6d01908d175bdd84abaaa6a5528d8

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl unzip \
	&& rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/bb-cs2-plugins/biobase_pos_emitter \
	&& curl -fsSL "https://github.com/roflmuffin/CounterStrikeSharp/releases/download/${CSSHARP_TAG}/${CSSHARP_ZIP}" \
		-o "/opt/bb-cs2-plugins/${CSSHARP_ZIP}" \
	&& echo "${CSSHARP_SHA256}  /opt/bb-cs2-plugins/${CSSHARP_ZIP}" | sha256sum -c - \
	&& curl -fsSL "https://github.com/alliedmodders/metamod-source/releases/download/${METAMOD_TAG}/${METAMOD_FILE}" -o "/opt/bb-cs2-plugins/${METAMOD_FILE}" \
	&& echo "${METAMOD_SHA256}  /opt/bb-cs2-plugins/${METAMOD_FILE}" | sha256sum -c - \
	&& curl -fsSL "https://github.com/KZGlobalTeam/cs2kz-metamod/releases/download/${CS2KZ_TAG}/${CS2KZ_FILE}" -o "/opt/bb-cs2-plugins/${CS2KZ_FILE}" \
	&& echo "${CS2KZ_SHA256}  /opt/bb-cs2-plugins/${CS2KZ_FILE}" | sha256sum -c - \
	&& curl -fsSL "https://github.com/zer0k-z/sql_mm/releases/download/${SQL_MM_TAG}/${SQL_MM_FILE}" \
		-o "/opt/bb-cs2-plugins/sql_mm-linux.tar.gz" \
	&& echo "${SQL_MM_SHA256}  /opt/bb-cs2-plugins/sql_mm-linux.tar.gz" | sha256sum -c - \
	&& curl -fsSL "https://github.com/shobhit-pathak/MatchZy/releases/download/${MATCHZY_TAG}/${MATCHZY_ZIP}" \
		-o "/opt/bb-cs2-plugins/${MATCHZY_ZIP}" \
	&& echo "${MATCHZY_SHA256}  /opt/bb-cs2-plugins/${MATCHZY_ZIP}" | sha256sum -c - \
	&& chown -R 1000:1000 /opt/bb-cs2-plugins

COPY --from=biobase_pos_plugin_build /plugin_out/BiobasePosEmitter.dll /opt/bb-cs2-plugins/biobase_pos_emitter/

COPY cfg/cs2kz-server-config.biobase.txt /opt/bb-cs2-plugins/cs2kz-server-config.biobase.txt
COPY cfg/biobase_dev.cfg /opt/bb-cs2-plugins/biobase_dev.cfg
COPY cfg/biobase_play.cfg /opt/bb-cs2-plugins/biobase_play.cfg
COPY cfg/biobase_autostart.cfg /opt/bb-cs2-plugins/biobase_autostart.cfg
COPY cfg/gamemode_competitive_server.biobase.cfg /opt/bb-cs2-plugins/gamemode_competitive_server.biobase.cfg

COPY pre.sh /etc/pre.sh
RUN chmod 755 /etc/pre.sh

USER 1000:1000
