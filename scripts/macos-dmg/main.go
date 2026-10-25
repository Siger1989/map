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
	"regexp"
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

var safeSemverPattern = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?(\+([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$`)

func isSafeSemver(value string) bool {
	parts := safeSemverPattern.FindStringSubmatch(value)
	if parts == nil {
		return false
	}
	if parts[5] != "" {
		for _, identifier := range strings.Split(parts[5], ".") {
			if len(identifier) > 1 && identifier[0] == '0' {
				numeric := true
				for _, char := range identifier {
					if char < '0' || char > '9' {
						numeric = false
						break
					}
				}
				if numeric {
					return false
				}
			}
		}
	}
	return true
}

func appVersionCore(value string) string {
	return strings.SplitN(strings.SplitN(value, "+", 2)[0], "-", 2)[0]
}

func parsePackageRoot(root string) (string, string, error) {
	if !strings.HasPrefix(root, "Shantu-") {
		return "", "", errors.New("unexpected package prefix")
	}
	visibility := ""
	for _, candidate := range []string{"public", "private"} {
		if strings.HasSuffix(root, "-macOS-"+candidate) {
			visibility = candidate
			break
		}
	}
	if visibility == "" {
		return "", "", errors.New("unexpected package prefix")
	}
	version := strings.TrimSuffix(strings.TrimPrefix(root, "Shantu-"), "-macOS-"+visibility)
	if !isSafeSemver(version) {
		return "", "", errors.New("package prefix contains an unsafe version")
	}
	return version, visibility, nil
}

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
	launcher []byte
}

func main() {
	input := flag.String("input", "", "portable macOS ZIP package")
	output := flag.String("output", "", "new DMG output path")
	iconPath := flag.String("icon", "", "PNG or JPEG app icon source")
	launcherPath := flag.String("launcher", "", "universal arm64/x86_64 macOS app executable")
	flag.Parse()
	if *input == "" || *output == "" || *iconPath == "" || *launcherPath == "" {
		fatalf("-input, -output, -icon, and -launcher are required")
	}
	if !strings.EqualFold(filepath.Ext(*output), ".dmg") {
		fatalf("output path must end in .dmg")
	}
	if _, err := os.Stat(*output); err == nil {
		fatalf("output already exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		fatalf("cannot inspect output path")
	}

	launcher, err := readLauncher(*launcherPath)
	if err != nil {
		fatalf("launcher validation failed: %v", err)
	}
	p, err := readPayload(*input)
	if err != nil {
		fatalf("input validation failed: %v", err)
	}
	p.launcher = launcher
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
	prefixVersion, visibility, err := parsePackageRoot(root)
	if err != nil {
		return nil, err
	}
	if manifestPath == "" {
		return nil, errors.New("manifest.json is missing from package root")
	}
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
	if m.Format != "shantu-macos-portable" || m.FormatVersion != 1 || !isSafeSemver(m.AppVersion) ||
		m.AppVersion != prefixVersion || m.Platform != "macOS" || m.Visibility != visibility {
		return nil, errors.New("manifest metadata does not match the package prefix")
	}
	if len(m.Architectures) != 2 || m.Architectures[0] != "arm64" || m.Architectures[1] != "x64" {
		return nil, errors.New("manifest architecture list is unexpected")
	}
	if len(m.Files) < 7 {
		return nil, errors.New("manifest has too few payload files")
	}
	wantWebFiles := 0
	for name := range m.Files {
		if strings.HasPrefix(name, "web/") {
			wantWebFiles++
		}
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
	for _, required := range []string{"README-Mac.md", "Start-Mac.command", "server.mjs", "web/index.html", "runtime/LICENSE-node-arm64.txt", "runtime/LICENSE-node-x64.txt", "runtime/node-arm64", "runtime/node-x64"} {
		if _, ok := files[required]; !ok {
			return nil, errors.New("required package file is missing")
		}
	}
	_, hasPrivateSeed := files["web/native/default-map-sources.json"]
	if (visibility == "private") != hasPrivateSeed {
		return nil, errors.New("map-source seed does not match package visibility")
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
	var order binary.ByteOrder
	switch string(data[:4]) {
	case "\xcf\xfa\xed\xfe":
		order = binary.LittleEndian
	case "\xfe\xed\xfa\xcf":
		order = binary.BigEndian
	default:
		return errors.New("unrecognized Mach-O magic")
	}
	if order.Uint32(data[4:8]) != expectedCPU {
		return errors.New("wrong CPU type")
	}
	return nil
}

func readLauncher(filename string) ([]byte, error) {
	info, err := os.Stat(filename)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("launcher must be a readable regular Mach-O file")
	}
	if info.Size() < 8 || info.Size() > 512<<20 {
		return nil, errors.New("launcher size is outside the 8-byte to 512-MiB safety range")
	}
	data, err := os.ReadFile(filename)
	if err != nil {
		return nil, errors.New("launcher cannot be read")
	}
	if err := checkUniversalMachO(data); err != nil {
		return nil, err
	}
	return data, nil
}

// checkUniversalMachO accepts only a real universal 64-bit Mach-O containing
// both Apple Silicon and Intel slices. Scripts and thin executables are refused.
func checkUniversalMachO(data []byte) error {
	if len(data) < 8 {
		return errors.New("launcher is not a universal Mach-O executable")
	}
	magic := binary.BigEndian.Uint32(data[:4])
	var order binary.ByteOrder = binary.BigEndian
	var is64 bool
	switch magic {
	case 0xcafebabe:
	case 0xcafebabf:
		is64 = true
	case 0xbebafeca:
		order = binary.LittleEndian
	case 0xbfbafeca:
		order = binary.LittleEndian
		is64 = true
	default:
		return errors.New("launcher must be a universal Mach-O binary, not a script or thin executable")
	}
	count := order.Uint32(data[4:8])
	entrySize := uint64(20)
	if is64 {
		entrySize = 32
	}
	if count < 2 || count > 32 || uint64(len(data)) < 8+uint64(count)*entrySize {
		return errors.New("launcher has an invalid universal Mach-O architecture table")
	}
	found := map[uint32]bool{}
	for i := uint32(0); i < count; i++ {
		entry := 8 + uint64(i)*entrySize
		cpu := order.Uint32(data[entry : entry+4])
		var offset, size uint64
		if is64 {
			offset = order.Uint64(data[entry+8 : entry+16])
			size = order.Uint64(data[entry+16 : entry+24])
		} else {
			offset = uint64(order.Uint32(data[entry+8 : entry+12]))
			size = uint64(order.Uint32(data[entry+12 : entry+16]))
		}
		if (cpu != 0x0100000c && cpu != 0x01000007) || found[cpu] || size < 8 || offset > uint64(len(data)) || size > uint64(len(data))-offset {
			return errors.New("launcher universal slices are invalid or contain duplicate/unsupported architectures")
		}
		if err := checkMachO(data[offset:offset+size], cpu); err != nil {
			return fmt.Errorf("launcher slice has invalid Mach-O header: %w", err)
		}
		found[cpu] = true
	}
	if !found[0x0100000c] || !found[0x01000007] {
		return errors.New("launcher must contain both arm64 and x86_64 slices")
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
	if err := checkUniversalMachO(p.launcher); err != nil {
		return nil, fmt.Errorf("invalid native launcher: %w", err)
	}
	app := &hfsplus.Entry{Name: "Shantu.app", Kind: hfsplus.KindDir, Mode: 0755}
	contents := &hfsplus.Entry{Name: "Contents", Kind: hfsplus.KindDir, Mode: 0755}
	macOS := &hfsplus.Entry{Name: "MacOS", Kind: hfsplus.KindDir, Mode: 0755}
	resources := &hfsplus.Entry{Name: "Resources", Kind: hfsplus.KindDir, Mode: 0755}
	macOS.Children = append(macOS.Children, &hfsplus.Entry{Name: "Shantu", Kind: hfsplus.KindFile, Data: p.launcher, Mode: 0755})
	bundleVersion := appVersionCore(p.manifest.AppVersion)
	plist := []byte(fmt.Sprintf("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n<key>CFBundleIdentifier</key><string>org.shantu.map.launcher</string>\n<key>CFBundleName</key><string>山兔</string>\n<key>CFBundleDisplayName</key><string>山兔</string>\n<key>CFBundleExecutable</key><string>Shantu</string>\n<key>CFBundlePackageType</key><string>APPL</string>\n<key>CFBundleShortVersionString</key><string>%s</string>\n<key>CFBundleVersion</key><string>%s</string>\n<key>LSMinimumSystemVersion</key><string>13.0</string>\n<key>CFBundleIconFile</key><string>AppIcon</string>\n<key>NSLocationUsageDescription</key><string>用于在地图上显示您的真实系统位置，并在您开始轨迹记录后记录路线。</string>\n<key>NSLocationWhenInUseUsageDescription</key><string>用于地图定位和您主动开始的轨迹记录。</string>\n<key>NSCameraUsageDescription</key><string>用于您主动拍摄照片并添加到地图标记。</string>\n<key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoads</key><true/></dict>\n</dict></plist>\n", bundleVersion, bundleVersion))
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
	readme := []byte(fmt.Sprintf("Shantu for macOS %s\n\nDrag Shantu.app to Applications, then double-click it to open the map in the Shantu app window. The app starts its bundled local service and displays the map in a native WebKit window. Quit Shantu to stop the service.\n", p.manifest.AppVersion))
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
