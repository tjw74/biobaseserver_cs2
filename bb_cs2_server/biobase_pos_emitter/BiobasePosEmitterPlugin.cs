using System.Text.Json;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes;
using CounterStrikeSharp.API.Modules.Entities;
using CounterStrikeSharp.API.Modules.Timers;
using CounterStrikeSharp.API.Modules.Utils;

namespace BiobasePosEmitter;

/// <summary>
/// Prints BIOBASE_POS_JSON lines to the dedicated server console on a fixed interval so host-side
/// tools (docker logs, test_map_position.py, Loki) can sample world positions without combat events.
/// </summary>
[MinimumApiVersion(80)]
public class BiobasePosEmitterPlugin : BasePlugin
{
    public override string ModuleName => "BiobasePosEmitter";
    public override string ModuleVersion => "0.1.1";
    public override string ModuleAuthor => "biobase";
    public override string ModuleDescription =>
        "Emit BIOBASE_POS_JSON for all connected players at 100ms (see biobase log_parser).";

    private CounterStrikeSharp.API.Modules.Timers.Timer? _timer;

    public override void Load(bool hotReload)
    {
        _timer = AddTimer(0.1f, EmitAll, TimerFlags.REPEAT);
        // Logger/ILogger often goes to Serilog sinks, not docker stdout; Console matches CSS hello-world / issue #25.
        Console.WriteLine("[BiobasePosEmitter] 100ms BIOBASE_POS_JSON sampling active");
    }

    public override void Unload(bool hotReload)
    {
        _timer?.Kill();
        _timer = null;
    }

    private void EmitAll()
    {
        foreach (var controller in Utilities.FindAllEntitiesByDesignerName<CCSPlayerController>(
                     "cs_player_controller"))
        {
            if (controller is null || !controller.IsValid)
            {
                continue;
            }

            var pawn = controller.PlayerPawn.Value;
            if (pawn is null || !pawn.IsValid)
            {
                continue;
            }

            var sceneOrigin = pawn.CBodyComponent?.SceneNode?.AbsOrigin;
            Vector abs = sceneOrigin ?? pawn.AbsOrigin;
            var vel = pawn.AbsVelocity;
            var eye = pawn.EyeAngles;

            bool onGround =
                pawn.GroundEntity.Value is { IsValid: true };
            string steam = controller.IsBot ? "BOT" : controller.SteamID.ToString();
            string name = (controller.PlayerName ?? "").Trim();

            var payload = new Dictionary<string, object?>
            {
                ["player"] = name,
                ["steamid"] = steam,
                ["tick"] = Server.TickCount,
                ["pos"] = new[] { abs.X, abs.Y, abs.Z },
                ["vel"] = new[] { vel.X, vel.Y, vel.Z },
                ["speed"] = Math.Sqrt(vel.X * vel.X + vel.Y * vel.Y + vel.Z * vel.Z),
                ["yaw"] = eye.Y,
                ["pitch"] = eye.X,
                ["on_ground"] = onGround,
            };

            string json = JsonSerializer.Serialize(payload);
            string line = "BIOBASE_POS_JSON " + json;
            Console.WriteLine(line);
        }
    }
}
