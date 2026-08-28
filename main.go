package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// startupDirFromArgs looks for a directory path among the launch
// arguments (SPE-86): Windows Explorer's "Open in Xpecter" context
// menu invokes the exe as `xpecter.exe "C:\the\clicked\folder"`, one
// quoted path argument, no flags. Checked against the real filesystem
// (os.Stat + IsDir) rather than assumed, so a future flag/argument
// added for something else doesn't get misread as a directory to open.
// Returns "" if no argument is a real, existing directory.
func startupDirFromArgs(args []string) string {
	for _, arg := range args {
		info, err := os.Stat(arg)
		if err == nil && info.IsDir() {
			return arg
		}
	}
	return ""
}

func main() {
	app := NewApp(startupDirFromArgs(os.Args[1:]))

	err := wails.Run(&options.App{
		Title:  "Xpecter",
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
