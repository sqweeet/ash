//go:build windows

package app

import (
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows/registry"
)

// ensureSystemPath restores the effective Windows PATH when a GUI launcher
// hands Ash a truncated one. Adding System32 alone can launch PowerShell, but
// it still leaves terminals unable to find git, rg, node/npm, bun, and other
// developer tools installed through the normal machine/user PATH entries.
//
// Read both persistent registry sources, then append only missing entries to
// the inherited PATH. This preserves an intentional caller-provided ordering
// while recovering the same tool locations Explorer would normally provide.
func ensureSystemPath() {
	windir := os.Getenv("windir")
	if windir == "" {
		windir = os.Getenv("SystemRoot")
	}
	if windir == "" {
		windir = `C:\Windows`
	}

	required := []string{
		filepath.Join(windir, "System32"),
		filepath.Join(windir, "System32", "WindowsPowerShell", "v1.0"),
		windir,
		filepath.Join(windir, "System32", "Wbem"),
	}
	registryPaths := []string{
		registryPath(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager\Environment`),
		registryPath(registry.CURRENT_USER, `Environment`),
	}

	merged := appendMissingPathEntries(os.Getenv("PATH"), registryPaths...)
	merged = appendMissingPathEntries(merged, strings.Join(required, ";"))
	if merged != os.Getenv("PATH") {
		_ = os.Setenv("PATH", merged)
	}
}

func registryPath(root registry.Key, path string) string {
	key, err := registry.OpenKey(root, path, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer key.Close()

	value, valueType, err := key.GetStringValue("Path")
	if err != nil || value == "" {
		return ""
	}
	if valueType == registry.EXPAND_SZ {
		if expanded, err := registry.ExpandString(value); err == nil {
			return expanded
		}
	}
	return value
}

func appendMissingPathEntries(current string, additions ...string) string {
	parts := strings.Split(current, ";")
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		if normalized := normalizePathEntry(part); normalized != "" {
			seen[normalized] = struct{}{}
		}
	}

	for _, addition := range additions {
		for _, part := range strings.Split(addition, ";") {
			part = strings.TrimSpace(part)
			normalized := normalizePathEntry(part)
			if normalized == "" {
				continue
			}
			if _, exists := seen[normalized]; exists {
				continue
			}
			parts = append(parts, part)
			seen[normalized] = struct{}{}
		}
	}
	return strings.Join(parts, ";")
}

func normalizePathEntry(path string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(path), `\/`))
}
