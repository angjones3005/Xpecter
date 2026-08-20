#!/usr/bin/env bash
# Run from the root of your Specter repo.
set -euo pipefail

mkdir -p ".github/workflows"
cat > ".github/workflows/release.yml" << 'SPECTER_EOF_0'
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

jobs:
  build:
    name: Build (${{ matrix.os }})
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-latest
            platform: linux
            artifact: specter-linux-amd64.tar.gz
          - os: windows-latest
            platform: windows
            artifact: specter-windows-amd64.zip
          - os: macos-latest
            platform: darwin
            artifact: specter-macos-universal.zip
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
          cache: true

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      # Wails needs GTK3 + WebKit2GTK on Linux to build/run the webview.
      # Windows and macOS runners already ship what's needed (WebView2 is
      # preinstalled on windows-latest; macOS uses the system WebKit).
      - name: Install Linux system dependencies
        if: matrix.platform == 'linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config

      - name: Install Wails CLI
        run: go install github.com/wailsapp/wails/v2/cmd/wails@latest

      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci

      - name: Build (Linux)
        if: matrix.platform == 'linux'
        run: |
          wails build -platform linux/amd64 -tags webkit2_41
          tar -czf ${{ matrix.artifact }} -C build/bin .

      - name: Build (Windows)
        if: matrix.platform == 'windows'
        run: |
          wails build -platform windows/amd64
          Compress-Archive -Path build/bin/* -DestinationPath ${{ matrix.artifact }}
        shell: pwsh

      - name: Build (macOS)
        if: matrix.platform == 'darwin'
        run: |
          wails build -platform darwin/universal
          cd build/bin
          zip -r ../../${{ matrix.artifact }} .

      - uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.artifact }}
          path: ${{ matrix.artifact }}
          retention-days: 7

  release:
    name: Publish GitHub Release
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Publish release with artifacts
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
          generate_release_notes: true
SPECTER_EOF_0

mkdir -p ".github/workflows"
cat > ".github/workflows/ci.yml" << 'SPECTER_EOF_1'
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  go-checks:
    name: Go checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
          cache: true

      - name: gofmt check
        run: |
          fmt_out=$(gofmt -l .)
          if [ -n "$fmt_out" ]; then
            echo "The following files are not gofmt'd:"
            echo "$fmt_out"
            exit 1
          fi

      - name: go vet
        run: go vet ./backend/...

      - name: golangci-lint
        uses: golangci/golangci-lint-action@v7
        with:
          version: v2.6.2
          args: ./backend/...

      - name: go build (non-GUI packages)
        # Skips the main Wails package here since it needs GTK/webkit system
        # deps to compile; those are only installed in the release workflow's
        # full cross-platform build. This still builds and type-checks
        # everything under backend/.
        run: go build ./backend/...

  frontend-checks:
    name: Frontend checks
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Type check
        run: npx tsc --noEmit

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build
SPECTER_EOF_1

