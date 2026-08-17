#!/usr/bin/env bash
# Run from the root of your Specter repo.
set -euo pipefail

cat > ".github/workflows/release.yml" << 'SPECTER_EOF_RELEASEYML'
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

      # NSIS ships pre-installed on windows-latest runners, but versions
      # drift over time and we've seen reports of that breaking `wails
      # build -nsis` for other projects. Installing explicitly via choco
      # (always present on GitHub-hosted Windows runners) makes this
      # deterministic instead of depending on whatever happens to be on
      # the image today.
      - name: Install NSIS (Windows)
        if: matrix.platform == 'windows'
        run: choco install nsis -y
        shell: pwsh

      - name: Install frontend dependencies
        working-directory: frontend
        run: npm ci

      - name: Build (Linux)
        if: matrix.platform == 'linux'
        run: |
          wails build -platform linux/amd64 -tags webkit2_41 -ldflags "-X main.Version=${{ github.ref_name }}"
          tar -czf ${{ matrix.artifact }} -C build/bin .

      - name: Build (Windows)
        if: matrix.platform == 'windows'
        run: |
          wails build -platform windows/amd64 -ldflags "-X main.Version=${{ github.ref_name }}"
          Compress-Archive -Path build/bin/* -DestinationPath ${{ matrix.artifact }}
        shell: pwsh

      # Separate, redundant build rather than folding -nsis into the step
      # above: if NSIS ever breaks (it has, across Wails versions, per
      # upstream issues), continue-on-error here means the release still
      # ships with the portable .exe/.zip above either way, this is
      # purely additive, never a release blocker.
      - name: Build Windows installer (NSIS)
        if: matrix.platform == 'windows'
        continue-on-error: true
        run: wails build -platform windows/amd64 -nsis -ldflags "-X main.Version=${{ github.ref_name }}"
        shell: pwsh

      - name: Upload Windows installer (NSIS)
        if: matrix.platform == 'windows'
        continue-on-error: true
        uses: actions/upload-artifact@v4
        with:
          name: specter-windows-installer.exe
          path: build/bin/specter-amd64-installer.exe
          retention-days: 7

      - name: Build (macOS)
        if: matrix.platform == 'darwin'
        run: |
          wails build -platform darwin/universal -ldflags "-X main.Version=${{ github.ref_name }}"
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

      - name: Publish release (Specter repo, private)
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
          generate_release_notes: true

      # Public-facing distribution: the Specter repo itself stays
      # private, but builds still need somewhere the public can
      # download from. DAWNRAIL_TOKEN is a fine-grained PAT scoped to
      # just the Dawnrail repo with Contents: Read and write, the
      # default GITHUB_TOKEN only has permission inside the repo the
      # workflow runs in, it can't create a release anywhere else.
      - name: Publish release (Dawnrail repo, public)
        uses: softprops/action-gh-release@v2
        with:
          files: artifacts/*
          generate_release_notes: true
          repository: Dawnrail/Dawnrail
          token: ${{ secrets.DAWNRAIL_TOKEN }}
SPECTER_EOF_RELEASEYML

