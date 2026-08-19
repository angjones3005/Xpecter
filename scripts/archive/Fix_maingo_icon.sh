#!/usr/bin/env bash
# Run from the root of your Specter repo.
set -euo pipefail

cat > "main.go" << 'SPECTER_EOF_MAINGO'
package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Specter",
		Width:  1280,
		Height: 800,
		// Frameless: no OS window decorations, #menubar in index.html
		// draws its own title bar instead (brand + real window
		// controls wired to WindowMinimise/WindowToggleMaximise/Quit),
		// so it can actually match the app's dark theme instead of
		// whatever the desktop environment's default GTK title bar
		// theme happens to be. The packaged app icon itself comes from
		// build/appicon.png automatically at build time, no separate
		// runtime option needed for that.
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
SPECTER_EOF_MAINGO

