package main

import (
	"embed"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
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
		// SPE-125: Ctrl+mouse-wheel and trackpad pinch are the
		// webview's own page zoom, not the app's. They scale the whole
		// UI (menubar, sidebar, tab bar, terminal alike), they're
		// trivially hit by accident while scrolling scrollback with a
		// modifier still held, and there's no way back from one: wails
		// turns off the browser accelerator keys, so the usual Ctrl+0
		// browser reset is gone too, and the zoom sticks until a
		// restart. Xpecter has its own zoom that changes terminal font
		// size instead (Ctrl+= / Ctrl+- / Ctrl+0, rebindable), which is
		// what's actually wanted here, so the webview's is turned off.
		// ZoomFactor pins the level back at 100%, which also rescues a
		// profile an earlier build left zoomed in: WebView2 persists
		// the factor in its user data folder across restarts.
		// This block only does anything because Windows is non-nil at
		// all. wails skips every one of these settings when the option
		// struct is absent, which is why the webview's default (zoom
		// control on) applied before.
		Windows: &windows.Options{
			IsZoomControlEnabled: false,
			DisablePinchZoom:     true,
			ZoomFactor:           1.0,
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
