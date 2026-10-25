package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"strings"
	"testing"

	"github.com/leaanthony/dmg/hfsplus"
)

func TestCheckedZipPath(t *testing.T) {
	tests := []struct {
		name    string
		want    string
		wantErr bool
	}{
		{name: "Shantu/web/index.html", want: "Shantu/web/index.html"},
		{name: "Shantu/web/", want: "Shantu/web"},
		{name: "Shantu/../escape", wantErr: true},
		{name: "Shantu/./file", wantErr: true},
		{name: "Shantu\\file", wantErr: true},
		{name: "/Shantu/file", wantErr: true},
		{name: "Shantu/中文.txt", wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := checkedZipPath(tt.name)
			if (err != nil) != tt.wantErr {
				t.Fatalf("checkedZipPath() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err == nil && got != tt.want {
				t.Fatalf("checkedZipPath() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestInsertFileModes(t *testing.T) {
	root := &hfsplus.Entry{Name: "Resources", Kind: hfsplus.KindDir, Mode: 0755}
	for _, name := range []string{"Start-Mac.command", "runtime/node-arm64", "runtime/node-x64", "runtime/node-extra", "server.mjs"} {
		if err := insertFile(root, name, []byte(name)); err != nil {
			t.Fatal(err)
		}
	}
	checks := map[string]uint16{
		"Start-Mac.command":  0755,
		"runtime/node-arm64": 0755,
		"runtime/node-x64":   0755,
		"runtime/node-extra": 0644,
		"server.mjs":         0644,
		"runtime/":           0755,
	}
	for path, want := range checks {
		entry := findEntry(root, strings.TrimSuffix(path, "/"))
		if entry == nil || entry.Mode != want {
			t.Errorf("%s mode = %v, want %04o", path, entryMode(entry), want)
		}
	}
}

func TestCheckMachOThinArchitectures(t *testing.T) {
	for _, cpu := range []uint32{0x0100000c, 0x01000007} {
		data := make([]byte, 8)
		binary.LittleEndian.PutUint32(data, 0xfeedfacf)
		binary.LittleEndian.PutUint32(data[4:], cpu)
		if err := checkMachO(data, cpu); err != nil {
			t.Errorf("checkMachO(%#x): %v", cpu, err)
		}
		if err := checkMachO(data, cpu^1); err == nil {
			t.Errorf("checkMachO(%#x) accepted a different CPU", cpu)
		}
	}
	fat := []byte{0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 1}
	if err := checkMachO(fat, 0x0100000c); err == nil {
		t.Error("checkMachO accepted a universal binary")
	}
}

func TestCheckUniversalMachORequiresArm64AndX8664(t *testing.T) {
	valid := universalFixture(0x0100000c, 0x01000007)
	if err := checkUniversalMachO(valid); err != nil {
		t.Fatalf("valid universal launcher rejected: %v", err)
	}
	for name, data := range map[string][]byte{
		"shell script": []byte("#!/bin/sh\necho launcher\n"),
		"thin arm64":   thinFixture(0x0100000c),
		"missing x64":  universalFixture(0x0100000c),
		"duplicate":    universalFixture(0x0100000c, 0x0100000c),
	} {
		t.Run(name, func(t *testing.T) {
			if err := checkUniversalMachO(data); err == nil {
				t.Fatal("invalid launcher accepted")
			}
		})
	}
	badOffset := append([]byte(nil), valid...)
	binary.BigEndian.PutUint32(badOffset[16:20], 0xff)
	if err := checkUniversalMachO(badOffset); err == nil {
		t.Fatal("out-of-range slice accepted")
	}
}

func TestReadLauncherRequiresUniversalMachO(t *testing.T) {
	path := t.TempDir() + "/launcher"
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := readLauncher(path); err == nil {
		t.Fatal("script launcher accepted")
	}
	want := universalFixture(0x0100000c, 0x01000007)
	if err := os.WriteFile(path, want, 0644); err != nil {
		t.Fatal(err)
	}
	got, err := readLauncher(path)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("readLauncher() error = %v; bytes match = %v", err, bytes.Equal(got, want))
	}
}

func TestIsSafeSemver(t *testing.T) {
	for _, version := range []string{"0.2.133-test", "1.0.0", "2.3.4-alpha.1+build.7"} {
		if !isSafeSemver(version) {
			t.Errorf("isSafeSemver(%q) = false", version)
		}
	}
	for _, version := range []string{"", "00.2.3", "1.02.3", "1.2.03", "1.2.3-01", "1.2.3/../../escape", "1.2.3\n"} {
		if isSafeSemver(version) {
			t.Errorf("isSafeSemver(%q) = true", version)
		}
	}
}

func TestParsePackageRoot(t *testing.T) {
	for _, test := range []struct {
		root       string
		version    string
		visibility string
		wantErr    bool
	}{
		{root: "Shantu-0.2.133-test-macOS-public", version: "0.2.133-test", visibility: "public"},
		{root: "Shantu-0.2.133-test-macOS-private", version: "0.2.133-test", visibility: "private"},
		{root: "Shantu-0.2.133-test/escape-macOS-public", wantErr: true},
		{root: "Shantu-01.2.3-macOS-public", wantErr: true},
		{root: "Shantu-1.2.3-macOS-other", wantErr: true},
	} {
		version, visibility, err := parsePackageRoot(test.root)
		if (err != nil) != test.wantErr {
			t.Errorf("parsePackageRoot(%q) error = %v, wantErr %v", test.root, err, test.wantErr)
			continue
		}
		if err == nil && (version != test.version || visibility != test.visibility) {
			t.Errorf("parsePackageRoot(%q) = (%q, %q), want (%q, %q)", test.root, version, visibility, test.version, test.visibility)
		}
	}
}

func TestVolumeVersionMetadataComesFromManifest(t *testing.T) {
	version := "0.2.133-test"
	launcher := universalFixture(0x0100000c, 0x01000007)
	startCommand := []byte("#!/bin/sh\necho legacy payload retained\n")
	if _, err := makeVolumeTree(&payload{manifest: manifest{AppVersion: version}, files: map[string][]byte{}, launcher: []byte("#!/bin/sh\n")}, nil); err == nil {
		t.Fatal("volume accepted a shell launcher")
	}
	children, err := makeVolumeTree(&payload{manifest: manifest{AppVersion: version}, files: map[string][]byte{"Start-Mac.command": startCommand}, launcher: launcher}, nil)
	if err != nil {
		t.Fatal(err)
	}
	app := findEntry(&hfsplus.Entry{Kind: hfsplus.KindDir, Children: children}, "Shantu.app")
	plist := string(findEntry(app, "Contents/Info.plist").Data)
	for _, purpose := range []string{"NSLocationUsageDescription", "NSLocationWhenInUseUsageDescription", "NSCameraUsageDescription"} {
		if !strings.Contains(plist, "<key>"+purpose+"</key><string>") {
			t.Fatalf("missing native permission purpose: %s", purpose)
		}
	}
	if !strings.Contains(plist, "<key>CFBundleShortVersionString</key><string>0.2.133</string>") ||
		!strings.Contains(plist, "<key>CFBundleVersion</key><string>0.2.133</string>") ||
		!strings.Contains(plist, "<key>CFBundleIdentifier</key><string>org.shantu.map.launcher</string>") ||
		!strings.Contains(plist, "<key>LSMinimumSystemVersion</key><string>13.0</string>") {
		t.Fatalf("plist does not use the version core: %s", plist)
	}
	executable := findEntry(app, "Contents/MacOS/Shantu")
	if executable == nil || executable.Mode != 0755 || !bytes.Equal(executable.Data, launcher) {
		t.Fatal("app executable is not the supplied universal launcher with executable mode")
	}
	retainedCommand := findEntry(app, "Contents/Resources/Start-Mac.command")
	if retainedCommand == nil || retainedCommand.Mode != 0755 || !bytes.Equal(retainedCommand.Data, startCommand) {
		t.Fatal("existing payload command or its executable mode was not preserved")
	}
	readme := findEntry(&hfsplus.Entry{Kind: hfsplus.KindDir, Children: children}, "README.txt")
	if readme == nil || !strings.Contains(string(readme.Data), "Shantu for macOS "+version) || strings.Contains(string(readme.Data), "Terminal") {
		t.Fatal("volume README does not use the manifest appVersion")
	}
}

func universalFixture(cpus ...uint32) []byte {
	const headerSize = 8
	const entrySize = 20
	const sliceSize = 8
	out := make([]byte, headerSize+entrySize*len(cpus)+sliceSize*len(cpus))
	binary.BigEndian.PutUint32(out, 0xcafebabe)
	binary.BigEndian.PutUint32(out[4:], uint32(len(cpus)))
	offset := uint32(headerSize + entrySize*len(cpus))
	for i, cpu := range cpus {
		entry := headerSize + i*entrySize
		binary.BigEndian.PutUint32(out[entry:], cpu)
		binary.BigEndian.PutUint32(out[entry+8:], offset)
		binary.BigEndian.PutUint32(out[entry+12:], sliceSize)
		slice := int(offset)
		copy(out[slice:slice+4], []byte{0xcf, 0xfa, 0xed, 0xfe})
		binary.LittleEndian.PutUint32(out[slice+4:], cpu)
		offset += sliceSize
	}
	return out
}

func thinFixture(cpu uint32) []byte {
	data := make([]byte, 8)
	copy(data, []byte{0xcf, 0xfa, 0xed, 0xfe})
	binary.LittleEndian.PutUint32(data[4:], cpu)
	return data
}

func findEntry(parent *hfsplus.Entry, path string) *hfsplus.Entry {
	parts := strings.Split(path, "/")
	cur := parent
	for _, part := range parts {
		if part == "" {
			continue
		}
		cur = findChild(cur, part)
		if cur == nil {
			return nil
		}
	}
	return cur
}

func entryMode(entry *hfsplus.Entry) uint16 {
	if entry == nil {
		return 0
	}
	return entry.Mode
}
