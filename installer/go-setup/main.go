package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/rand"
	_ "embed"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

//go:embed server.zip
var serverZip []byte

var stdin = bufio.NewReader(os.Stdin)

func main() {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("\n  [ERROR] %v\n", r)
		}
		fmt.Println("\n  Press Enter to close.")
		stdin.ReadString('\n')
	}()

	fmt.Println()
	fmt.Println("  =============================================")
	fmt.Println("       BioBase CS2 Server — Installing")
	fmt.Println("  =============================================")
	fmt.Println()

	installDir := defaultInstallDir()
	rconPw := randomPassword()
	dashPw := randomPassword()

	// Extract
	step("Extracting server files to %s", installDir)
	if err := extractZip(serverZip, installDir); err != nil {
		fail("Extract failed: %v", err)
		return
	}
	done()

	// Config
	step("Generating configuration")
	envPath := filepath.Join(installDir, "bb_cs2_server", ".env")
	if _, err := os.Stat(envPath); err == nil {
		fmt.Println("       (existing .env found — keeping it)")
	} else {
		writeEnv(envPath, rconPw, dashPw)
	}
	os.MkdirAll(filepath.Join(installDir, "data", "clips"), 0o755)
	done()

	// Docker
	step("Checking Docker")
	if !dockerAvailable() {
		fmt.Println()
		fmt.Println("       Docker Desktop is required but not installed.")
		fmt.Println("       Downloading Docker Desktop installer...")
		fmt.Println()
		if err := installDocker(); err != nil {
			fmt.Println("       Automatic install failed. Please install manually:")
			fmt.Println("       https://www.docker.com/products/docker-desktop/")
			fmt.Println()
			fmt.Println("       After installing Docker Desktop, run this setup again.")
			return
		}
		fmt.Println("       Docker Desktop installed. It may require a restart.")
	}

	if !dockerRunning() {
		fmt.Println("       Waiting for Docker engine to start...")
		if !waitForDocker(180) {
			fmt.Println("       Docker engine did not start.")
			fmt.Println("       Open Docker Desktop, then run this setup again.")
			return
		}
	}
	done()

	// Build and start containers
	fmt.Println()
	step("Building and starting containers")
	fmt.Println("       First run downloads ~30 GB of CS2 server files.")
	fmt.Println("       This will take a while. Do not close this window.")
	fmt.Println()

	composeFile := filepath.Join(installDir, "bb_cs2_server", "docker-compose.yml")
	cmd := exec.Command("docker", "compose", "-f", composeFile, "up", "-d", "--build")
	cmd.Dir = filepath.Join(installDir, "bb_cs2_server")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = append(os.Environ(), "BB_CLIPS_HOST_DIR="+filepath.Join(installDir, "data", "clips"))
	if err := cmd.Run(); err != nil {
		fail("Container build failed: %v", err)
		fmt.Println("       Make sure Docker Desktop is running and try again.")
		return
	}
	done()

	// Health check
	step("Waiting for CS2 server")
	ready := waitForPort("127.0.0.1:27015", 600)
	if ready {
		done()
	} else {
		fmt.Println("       (server may still be downloading CS2 files)")
	}

	// Success
	fmt.Println()
	fmt.Println("  =============================================")
	fmt.Println("       BioBase CS2 Server is running!")
	fmt.Println("  =============================================")
	fmt.Println()
	fmt.Println("    Game server      localhost:27015")
	fmt.Println("    Dashboard        http://localhost:8780/admin")
	fmt.Printf("    RCON password    %s\n", rconPw)
	fmt.Printf("    Dashboard pass   %s\n", dashPw)
	fmt.Println()
	fmt.Printf("    Install dir      %s\n", installDir)
	fmt.Printf("    Config file      %s\n", filepath.Join(installDir, "bb_cs2_server", ".env"))
	fmt.Println()
	fmt.Println("    Edit .env to change server name, map, passwords, etc.")
	fmt.Println("    Then restart:  docker compose -f <compose-path> up -d")
}

func defaultInstallDir() string {
	home, _ := os.UserHomeDir()
	if home == "" {
		home = `C:\`
	}
	return filepath.Join(home, "BioBase", "CS2Server")
}

func randomPassword() string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, 16)
	for i := range b {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(chars))))
		if err != nil {
			b[i] = chars[i%len(chars)]
			continue
		}
		b[i] = chars[n.Int64()]
	}
	return string(b)
}

func writeEnv(path, rconPw, dashPw string) {
	content := fmt.Sprintf(`# BioBase CS2 Server — auto-generated
CS2_SERVERNAME=BioBase CS2
CS2_RCONPW=%s
CS2_STARTMAP=de_mirage
CS2_MAXPLAYERS=16
CS2_LAN=0
CS2_CHEATS=0
CS2_BOT_QUOTA=10
CS2_BOT_QUOTA_MODE=fill
CS2_BOT_DIFFICULTY=1
BB_CS2_SERVER_PROFILE=play
BB_CS2_ENABLE_MATCHZY=1
BB_CS2_DASHBOARD_TOKEN=%s
BB_DASHBOARD_ROOT_PATH=/admin
BB_DASHBOARD_COOKIE_SECURE=0
BB_CLIPS_HOST_DIR=./data/clips
BB_CS2_CONNECT_HOST=localhost
BB_CS2_CONNECT_PORT=27015
BB_CLIENT_PAIRING_CODE=BIOBASE-TRY
`, rconPw, dashPw)
	os.MkdirAll(filepath.Dir(path), 0o755)
	os.WriteFile(path, []byte(content), 0o644)
}

func extractZip(data []byte, dest string) error {
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	for _, f := range r.File {
		target := filepath.Join(dest, f.Name)
		if !strings.HasPrefix(filepath.Clean(target), filepath.Clean(dest)) {
			continue
		}
		if f.FileInfo().IsDir() {
			os.MkdirAll(target, 0o755)
			continue
		}
		os.MkdirAll(filepath.Dir(target), 0o755)
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, f.Mode())
		if err != nil {
			rc.Close()
			return err
		}
		io.Copy(out, rc)
		out.Close()
		rc.Close()
	}
	return nil
}

func dockerAvailable() bool {
	cmd := exec.Command("docker", "version")
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	return cmd.Run() == nil
}

func dockerRunning() bool {
	cmd := exec.Command("docker", "info")
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	return cmd.Run() == nil
}

func installDocker() error {
	if runtime.GOOS != "windows" {
		return fmt.Errorf("auto-install only supported on Windows")
	}
	ps := `
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$url = 'https://desktop.docker.com/win/main/amd64/Docker Desktop Installer.exe'
$out = Join-Path $env:TEMP 'DockerDesktopInstaller.exe'
Write-Host '       Downloading... (this may take a few minutes)'
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
Write-Host '       Installing...'
Start-Process -FilePath $out -ArgumentList 'install','--quiet','--accept-license' -Wait
Remove-Item $out -Force -ErrorAction SilentlyContinue
`
	cmd := exec.Command("powershell", "-ExecutionPolicy", "Bypass", "-Command", ps)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func waitForDocker(timeoutSec int) bool {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		if dockerRunning() {
			return true
		}
		time.Sleep(5 * time.Second)
		fmt.Print(".")
	}
	fmt.Println()
	return false
}

func waitForPort(addr string, timeoutSec int) bool {
	deadline := time.Now().Add(time.Duration(timeoutSec) * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err == nil {
			conn.Close()
			return true
		}
		time.Sleep(5 * time.Second)
	}
	return false
}

func step(format string, args ...any) {
	fmt.Printf("  [..] "+format+"\n", args...)
}

func done() {
	fmt.Println("  [OK]")
}

func fail(format string, args ...any) {
	fmt.Printf("  [FAIL] "+format+"\n", args...)
}
