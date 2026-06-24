// Command demoinfocs-summary parses a CS2/CSGO .dem and prints a small JSON summary to stdout.
package main

import (
	"encoding/json"
	"fmt"
	"os"

	demoinfocs "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs"
	events "github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/events"
	"github.com/markus-wa/demoinfocs-golang/v5/pkg/demoinfocs/msg"
)

// Matches go.mod; shown by `demoinfocs-summary --version` for dashboard probes.
const demoinfocsLibVersion = "v5.0.3"

type summary struct {
	MapName        string `json:"map_name"`
	KillEvents     int    `json:"kill_events"`
	RoundEndEvents int    `json:"round_end_events"`
}

func main() {
	if len(os.Args) >= 2 {
		arg := os.Args[1]
		if arg == "--version" || arg == "-version" {
			fmt.Printf("demoinfocs-summary biobase-tools demoinfocs-golang@%s\n", demoinfocsLibVersion)
			os.Exit(0)
		}
	}
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: demoinfocs-summary <demo.dem>")
		os.Exit(2)
	}
	path := os.Args[1]
	f, err := os.Open(path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open: %v\n", err)
		os.Exit(1)
	}
	defer f.Close()

	p := demoinfocs.NewParser(f)
	defer p.Close()

	var s summary

	p.RegisterNetMessageHandler(func(m *msg.CSVCMsg_ServerInfo) {
		if s.MapName == "" && m.GetMapName() != "" {
			s.MapName = m.GetMapName()
		}
	})

	p.RegisterEventHandler(func(events.Kill) {
		s.KillEvents++
	})

	p.RegisterEventHandler(func(events.RoundEnd) {
		s.RoundEndEvents++
	})

	err = p.ParseToEnd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "parse: %v\n", err)
		os.Exit(1)
	}

	gs := p.GameState()
	out := map[string]any{
		"parser":  "demoinfocs-golang",
		"library": "github.com/markus-wa/demoinfocs-golang/v5",
		"ok":      true,
		"summary": map[string]any{
			"map_name":         s.MapName,
			"kill_events":      s.KillEvents,
			"round_end_events": s.RoundEndEvents,
			"team_t_score":     gs.TeamTerrorists().Score(),
			"team_ct_score":    gs.TeamCounterTerrorists().Score(),
		},
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(out); err != nil {
		fmt.Fprintf(os.Stderr, "json: %v\n", err)
		os.Exit(1)
	}
}
