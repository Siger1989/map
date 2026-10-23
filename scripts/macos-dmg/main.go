package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/leaanthony/dmg/hfsplus"
	"github.com/leaanthony/dmg/icns"
	"github.com/leaanthony/dmg/udif"
)

const (
	volumeName      = "Shantu installer"
	maxPayloadBytes = 2 << 30
)

type manifest struct {
	Format        string            `json:"format"`
	FormatVersion int               `json:"formatVersion"`
	AppVersion    string            `json:"appVersion"`
	Visibility    string            `json:"visibility"`
	Platform      string            `json:"platform"`
	Architectures []string          `json:"architectures"`
	NodeVersion   string            `json:"nodeVersion"`
	Files         map[string]string `json:"files"`
}

type payload struct {
	manifest manifest
	files    map[string][]byte
}

func main() {
	input := flag.String("input", "", "portable macOS ZIP package")
	output := flag.String("output", "", "new DMG output path")
	iconPath := flag.String("icon", "", "PNG or JPEG app icon source")
	flag.Parse()
	if *input == "" || *output == "" || *iconPath == "" {
		fatalf("-input, -output, and -icon are required")
	}
	if !strings.EqualFold(filepath.Ext(*output), ".dmg") {
		fatalf("output path must end in .dmg")
	}
	if _, err := os.Stat(*output); err == nil {
		fatalf("output already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		fatalf("cannot inspect output path")
	}

	p, err := readPayload(*input)
	if err != nil {
		fatalf("input validation failed: %v", err)
	}
	iconBytes, err := makeIcon(*iconPath)
	if err != nil {
		fatalf("icon validation failed: %v", err)
	}
	children, err := makeVolumeTree(p, iconBytes)
	if err != nil {
		fatalf("cannot construct volume tree: %v", err)
	}

	img, err := hfsplus.Build(&hfsplus.Volume{Name: volumeName, CreatedAt: time.Now(), Children: children})
	if err != nil {
		fatalf("HFS+ build failed: %v", err)
	}
	outDir := filepath.Dir(*output)
	tmp, err := os.CreateTemp(outDir, ".shantu-dmg-*.tmp")
	if err != nil {
		fatalf("cannot create output temporary file")
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := udif.Build(tmp, img, "whole disk (Apple_HFS : 0)"); err != nil {
		tmp.Close()
		fatalf("UDIF/UDZO build failed: %v", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		fatalf("cannot flush output image")
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		tmp.Close()
		fatalf("cannot read output image")
	}
	h := sha256.New()
	bytesWritten, err := io.Copy(h, tmp)
	if err != nil {
		tmp.Close()
		fatalf("cannot hash output image")
	}
	if err := tmp.Close(); err != nil {
		fatalf("cannot close output image")
	}
	if err := os.Rename(tmpName, *output); err != nil {
		fatalf("cannot publish output image")
	}
	result := struct {
		Format        string   `json:"format"`
		Compression   string   `json:"compression"`
		Filesystem    string   `json:"filesystem"`
		Volume        string   `json:"volume"`
		AppVersion    string   `json:"appVersion"`
		Visibility    string   `json:"visibility"`
		FileCount     int      `json:"payloadFiles"`
		Architectures []string `json:"architectures"`
		Bytes         int64    `json:"bytes"`
		SHA256        string   `json:"sha256"`
	}{"UDIF", "UDZO", "HFS+", volumeName, p.manifest.AppVersion, p.manifest.Visibility, len(p.files), []string{"arm64", "x64"}, bytesWritten, hex.EncodeToString(h.Sum(nil))}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fatalf("cannot write build metadata")
	}
}

func readPayload(filename string) (*payload, error) {
	zr, err := zip.OpenReader(filename)
	if err != nil {
		return nil, errors.New("not a readable ZIP archive")
	}
	defer zr.Close()
	if len(zr.File) < 5 {
		return nil, errors.New("archive has too few entries")
	}
	seenPaths := map[string]bool{}
	var root string
	manifestPath := ""
	var total uint64
	for _, f := range zr.File {
		clean, err := checkedZipPath(f.Name)
		if err != nil {
			return nil, err
		}
		if seenPaths[clean] {
			return nil, errors.New("archive contains duplicate paths")
		}
		seenPaths[clean] = true
		parts := strings.Split(clean, "/")
		if root == "" {
			root = parts[0]
		} else if parts[0] != root {
			return nil, errors.New("archive must have exactly one top-level prefix")
		}
		if len(parts) == 2 && parts[1] == "manifest.json" && !strings.HasSuffix(f.Name, "/") {
			manifestPath = clean
		}
		mode := uint32(f.ExternalAttrs >> 16)
		if f.CreatorVersion>>8 == 3 {
			typeBits := mode & 0170000
			if typeBits == 0120000 || (typeBits != 0 && typeBits != 0100000 && typeBits != 0040000) {
				return nil, errors.New("archive contains a symlink or special file")
			}
		}
		if !strings.HasSuffix(f.Name, "/") {
			total += f.UncompressedSize64
			if total > maxPayloadBytes {
				return nil, errors.New("uncompressed payload exceeds the 2 GiB safety limit")
			}
		}
	}
	if root != "Shantu-0.2.132-test-macOS-public" && root != "Shantu-0.2.132-test-macOS-private" {
		return nil, errors.New("unexpected package prefix")
	}
	if manifestPath == "" {
		return nil, errors.New("manifest.json is missing from package root")
	}
	visibility := strings.TrimPrefix(root, "Shantu-0.2.132-test-macOS-")
	var m manifest
	var manifestBytes []byte
	for _, f := range zr.File {
		if f.Name != manifestPath {
			continue
		}
		r, err := f.Open()
		if err != nil {
			return nil, errors.New("manifest cannot be opened")
		}
		manifestBytes, err = io.ReadAll(io.LimitReader(r, 4<<20))
		r.Close()
		if err != nil {
			return nil, errors.New("manifest cannot be read")
		}
		if err = json.Unmarshal(manifestBytes, &m); err != nil {
			return nil, errors.New("manifest is invalid JSON")
		}
		break
	}
	if m.Format != "shantu-macos-portable" || m.FormatVersion != 1 || m.AppVersion != "0.2.132-test" || m.Platform != "macOS" || m.Visibility != visibility {
		return nil, errors.New("manifest metadata does not match the package prefix")
	}
	if len(m.Architectures) != 2 || m.Architectures[0] != "arm64" || m.Architectures[1] != "x64" {
		return nil, errors.New("manifest architecture list is unexpected")
	}
	wantFiles := 1932
	wantWebFiles := 1925
	if visibility == "private" {
		wantFiles, wantWebFiles = 1933, 1926
	}
	if len(m.Files) != wantFiles {
		return nil, errors.New("manifest has an unexpected file count")
	}

	files := make(map[string][]byte, len(m.Files)+1)
	rootPrefix := root + "/"
	actualWebFiles := 0
	listed := map[string]bool{}
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "/") {
			continue
		}
		rel := strings.TrimPrefix(f.Name, rootPrefix)
		if strings.HasPrefix(rel, "web/") {
			actualWebFiles++
		}
		if rel == "manifest.json" {
			continue
		}
		if _, exists := m.Files[rel]; !exists {
			return nil, errors.New("archive has a file not covered by the manifest")
		}
		listed[rel] = true
		r, err := f.Open()
		if err != nil {
			return nil, errors.New("payload file cannot be opened")
		}
		data, err := io.ReadAll(io.LimitReader(r, int64(f.UncompressedSize64)+1))
		r.Close()
		if err != nil || uint64(len(data)) != f.UncompressedSize64 {
			return nil, errors.New("payload file could not be read completely")
		}
		sum := sha256.Sum256(data)
		if !strings.EqualFold(hex.EncodeToString(sum[:]), m.Files[rel]) {
			return nil, errors.New("payload checksum does not match manifest")
		}
		files[rel] = data
	}
	if len(listed) != len(m.Files) || len(files) != len(m.Files) || actualWebFiles != wantWebFiles {
		return nil, errors.New("payload counts do not match the expected package")
	}
	files["manifest.json"] = manifestBytes
	for _, required := range []string{"README-Mac.md", "Start-Mac.command", "server.mjs", "runtime/LICENSE-node-arm64.txt", "runtime/LICENSE-node-x64.txt", "runtime/node-arm64", "runtime/node-x64"} {
		if _, ok := files[required]; !ok {
			return nil, errors.New("required package file is missing")
		}
	}
	if err := checkMachO(files["runtime/node-arm64"], 0x0100000c); err != nil {
		return nil, errors.New("arm64 Node executable has an unexpected Mach-O architecture")
	}
	if err := checkMachO(files["runtime/node-x64"], 0x01000007); err != nil {
		return nil, errors.New("x64 Node executable has an unexpected Mach-O architecture")
	}

	return &payload{manifest: m, files: files}, nil
}

func checkedZipPath(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "\\:\x00") || strings.HasPrefix(name, "/") {
		return "", errors.New("archive contains an unsafe path")
	}
	isDir := strings.HasSuffix(name, "/")
	trimmed := strings.TrimSuffix(name, "/")
	if trimmed == "" {
		return "", errors.New("archive contains an empty path")
	}
	for _, part := range strings.Split(trimmed, "/") {
		if part == "" || part == "." || part == ".." {
			return "", errors.New("archive contains a traversal or non-canonical path")
		}
	}
	for _, b := range []byte(trimmed) {
		if b >= 0x80 {
			return "", errors.New("archive contains a non-ASCII path unsupported by case-insensitive HFS+")
		}
	}
	if !isDir && name != trimmed {
		return "", errors.New("archive path has an invalid suffix")
	}
	return trimmed, nil
}

func checkMachO(data []byte, expectedCPU uint32) error {
	if len(data) < 8 {
		return errors.New("truncated Mach-O")
	}
	if binary.LittleEndian.Uint32(data[:4]) != 0xfeedfacf {
		return errors.New("unrecognized Mach-O magic")
	}
	if binary.LittleEndian.Uint32(data[4:8]) != expectedCPU {
		return errors.New("wrong CPU type")
	}
	return nil
}

func insertFile(root *hfsplus.Entry, name string, data []byte) error {
	fullPath := name
	parts := strings.Split(name, "/")
	cur := root
	for _, part := range parts[:len(parts)-1] {
		child := findChild(cur, part)
		if child == nil {
			child = &hfsplus.Entry{Name: part, Kind: hfsplus.KindDir, Mode: 0755}
			cur.Children = append(cur.Children, child)
		} else if child.Kind != hfsplus.KindDir {
			return errors.New("payload path conflicts with a file")
		}
		cur = child
	}
	name = parts[len(parts)-1]
	if findChild(cur, name) != nil {
		return errors.New("payload contains duplicate names")
	}
	mode := uint16(0644)
	if fullPath == "Start-Mac.command" || fullPath == "runtime/node-arm64" || fullPath == "runtime/node-x64" {
		mode = 0755
	}
	cur.Children = append(cur.Children, &hfsplus.Entry{Name: name, Kind: hfsplus.KindFile, Data: data, Mode: mode})
	return nil
}

func findChild(parent *hfsplus.Entry, name string) *hfsplus.Entry {
	for _, child := range parent.Children {
		if strings.EqualFold(child.Name, name) {
			return child
		}
	}
	return nil
}

func makeVolumeTree(p *payload, iconBytes []byte) ([]*hfsplus.Entry, error) {
	app := &hfsplus.Entry{Name: "Shantu.app", Kind: hfsplus.KindDir, Mode: 0755}
	contents := &hfsplus.Entry{Name: "Contents", Kind: hfsplus.KindDir, Mode: 0755}
	macOS := &hfsplus.Entry{Name: "MacOS", Kind: hfsplus.KindDir, Mode: 0755}
	resources := &hfsplus.Entry{Name: "Resources", Kind: hfsplus.KindDir, Mode: 0755}
	launcher := []byte("#!/bin/sh\nset -eu\nRESOURCES=\"$(CDPATH= cd -- \"$(dirname -- \"$0\")/../Resources\" && pwd)\"\nexec /usr/bin/open -a Terminal \"$RESOURCES/Start-Mac.command\"\n")
	macOS.Children = append(macOS.Children, &hfsplus.Entry{Name: "Shantu", Kind: hfsplus.KindFile, Data: launcher, Mode: 0755})
	plist := []byte("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n<key>CFBundleIdentifier</key><string>org.shantu.map.launcher</string>\n<key>CFBundleName</key><string>山兔</string>\n<key>CFBundleDisplayName</key><string>山兔</string>\n<key>CFBundleExecutable</key><string>Shantu</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleShortVersionString</key><string>0.2.132</string>\n<key>CFBundleVersion</key><string>132</string>\n<key>LSMinimumSystemVersion</key><string>11</string>\n<key>CFBundleIconFile</key><string>AppIcon</string>\n</dict></plist>\n")
	contents.Children = append(contents.Children,
		&hfsplus.Entry{Name: "Info.plist", Kind: hfsplus.KindFile, Data: plist, Mode: 0644},
		&hfsplus.Entry{Name: "PkgInfo", Kind: hfsplus.KindFile, Data: []byte("APPL????"), Mode: 0644},
		macOS, resources,
	)
	app.Children = append(app.Children, contents)
	for path, data := range p.files {
		if err := insertFile(resources, path, data); err != nil {
			return nil, err
		}
	}
	resources.Children = append(resources.Children, &hfsplus.Entry{Name: "AppIcon.icns", Kind: hfsplus.KindFile, Data: iconBytes, Mode: 0644})
	sortTree(app)
	readme := []byte("Shantu for macOS 0.2.132-test\n\nDrag Shantu.app to Applications, then double-click it to start Shantu. The app is a launcher for the existing local-browser edition: it opens Start-Mac.command in Terminal, starts the local server on port 8787, and opens the map in your browser. Keep Terminal open while using the map; quit that Terminal session to stop the server.\n")
	return []*hfsplus.Entry{
		app,
		{Name: "Applications", Kind: hfsplus.KindSymlink, Target: "/Applications", Mode: 0755},
		{Name: "README.txt", Kind: hfsplus.KindFile, Data: readme, Mode: 0644},
	}, nil
}

func sortTree(entry *hfsplus.Entry) {
	sort.Slice(entry.Children, func(i, j int) bool { return entry.Children[i].Name < entry.Children[j].Name })
	for _, child := range entry.Children {
		if child.Kind == hfsplus.KindDir {
			sortTree(child)
		}
	}
}

func makeIcon(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, errors.New("source image is not readable")
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return nil, errors.New("source image is not a supported PNG or JPEG")
	}
	var b bytes.Buffer
	if err := icns.Encode(&b, img); err != nil {
		return nil, errors.New("source image cannot be encoded as an app icon")
	}
	return b.Bytes(), nil
}

func fatalf(format string, args ...any) {
	_, _ = fmt.Fprintf(os.Stderr, "macos-dmg: "+format+"\n", args...)
	os.Exit(2)
}
