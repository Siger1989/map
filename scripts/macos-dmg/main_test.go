package main

import (
	"encoding/binary"
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
	children, err := makeVolumeTree(&payload{manifest: manifest{AppVersion: version}, files: map[string][]byte{}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	app := findEntry(&hfsplus.Entry{Kind: hfsplus.KindDir, Children: children}, "Shantu.app")
	plist := string(findEntry(app, "Contents/Info.plist").Data)
	if !strings.Contains(plist, "<key>CFBundleShortVersionString</key><string>0.2.133</string>") ||
		!strings.Contains(plist, "<key>CFBundleVersion</key><string>0.2.133</string>") {
		t.Fatalf("plist does not use the version core: %s", plist)
	}
	readme := findEntry(&hfsplus.Entry{Kind: hfsplus.KindDir, Children: children}, "README.txt")
	if readme == nil || !strings.Contains(string(readme.Data), "Shantu for macOS "+version) {
		t.Fatal("volume README does not use the manifest appVersion")
	}
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
