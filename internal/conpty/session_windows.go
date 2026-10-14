//go:build windows

package conpty

import (
	"errors"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

type consoleAPI struct {
	dll                            *windows.DLL
	create, resize, close, release *windows.Proc
}

var sharedAPI = sync.OnceValues(loadAPI)
var updateAttribute = windows.NewLazySystemDLL("kernel32.dll").NewProc("UpdateProcThreadAttribute")

func loadAPI() (*consoleAPI, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return nil, err
	}
	path, err := prepareRuntime(cacheDir, runtime.GOARCH)
	if err != nil {
		return nil, err
	}
	// Never search the current project or PATH for native code/dependencies.
	handle, err := windows.LoadLibraryEx(path, 0, windows.LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|windows.LOAD_LIBRARY_SEARCH_SYSTEM32)
	if err != nil {
		return nil, fmt.Errorf("load bundled ConPTY: %w", err)
	}
	api := &consoleAPI{dll: &windows.DLL{Name: path, Handle: handle}}
	for name, target := range map[string]**windows.Proc{
		"ConptyCreatePseudoConsole":  &api.create,
		"ConptyResizePseudoConsole":  &api.resize,
		"ConptyClosePseudoConsole":   &api.close,
		"ConptyReleasePseudoConsole": &api.release,
	} {
		*target, err = api.dll.FindProc(name)
		if err != nil {
			api.dll.Release()
			return nil, err
		}
	}
	// Keep the module loaded for the process lifetime; every session uses it.
	return api, nil
}

type Options struct {
	CommandLine   string
	Directory     string
	Environment   []string
	Columns, Rows uint16
}

// Session owns a pseudoconsole and its two parent-side pipe handles.
// os.File provides safe concurrent I/O/Close; mu protects the opaque HPCON.
// A HPCON created by conpty.dll must never be closed via kernel32.dll.
type Session struct {
	api           *consoleAPI
	hpc           windows.Handle
	input, output *os.File
	pid           int
	mu            sync.Mutex
	closed        bool
	closeErr      error
}

func packedSize(cols, rows uint16) uintptr {
	return uintptr(uint32(cols) | uint32(rows)<<16)
}

func validSize(cols, rows uint16) bool {
	return cols > 0 && rows > 0 && cols <= 32767 && rows <= 32767
}

func Start(options Options) (*Session, error) {
	if !validSize(options.Columns, options.Rows) {
		return nil, fmt.Errorf("invalid ConPTY dimensions %dx%d", options.Columns, options.Rows)
	}
	api, err := sharedAPI()
	if err != nil {
		return nil, err
	}
	var childInput, input, output, childOutput windows.Handle
	if err := windows.CreatePipe(&childInput, &input, nil, 0); err != nil {
		return nil, err
	}
	defer windows.CloseHandle(childInput)
	if err := windows.CreatePipe(&output, &childOutput, nil, 0); err != nil {
		windows.CloseHandle(input)
		return nil, err
	}
	defer windows.CloseHandle(childOutput)
	session := &Session{api: api, input: os.NewFile(uintptr(input), "conpty-input"), output: os.NewFile(uintptr(output), "conpty-output")}
	ok := false
	defer func() {
		if !ok {
			session.Close()
		}
	}()
	status, _, _ := api.create.Call(packedSize(options.Columns, options.Rows), uintptr(childInput), uintptr(childOutput), 0, uintptr(unsafe.Pointer(&session.hpc)))
	if status != 0 {
		return nil, fmt.Errorf("ConptyCreatePseudoConsole: HRESULT %#x", status)
	}
	process, err := startProcess(session.hpc, options)
	if err != nil {
		return nil, err
	}
	session.pid = int(process.ProcessId)
	windows.CloseHandle(process.Thread)
	windows.CloseHandle(process.Process)
	// Let the host exit (and close stdout) when the last console client exits.
	// Keeping this reference would leave the frontend waiting for EOF forever.
	status, _, _ = api.release.Call(uintptr(session.hpc))
	if status != 0 {
		return nil, fmt.Errorf("ConptyReleasePseudoConsole: HRESULT %#x", status)
	}
	ok = true
	return session, nil
}

func startProcess(hpc windows.Handle, options Options) (*windows.ProcessInformation, error) {
	command, err := windows.UTF16PtrFromString(options.CommandLine)
	if err != nil {
		return nil, err
	}
	var directory *uint16
	if options.Directory != "" {
		directory, err = windows.UTF16PtrFromString(options.Directory)
		if err != nil {
			return nil, err
		}
	}
	env, err := environmentBlock(options.Environment)
	if err != nil {
		return nil, err
	}
	var envPtr *uint16
	if len(env) != 0 {
		envPtr = &env[0]
	}
	attributes, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		return nil, err
	}
	defer attributes.Delete()
	// This special attribute takes the HPCON value, NOT a pointer to a handle.
	// Use the syscall directly instead of pretending it is a Go memory pointer.
	success, _, callErr := updateAttribute.Call(uintptr(unsafe.Pointer(attributes.List())), 0, windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, uintptr(hpc), unsafe.Sizeof(hpc), 0, 0)
	if success == 0 {
		return nil, fmt.Errorf("set pseudoconsole process attribute: %w", callErr)
	}
	startup := windows.StartupInfoEx{ProcThreadAttributeList: attributes.List()}
	startup.Cb = uint32(unsafe.Sizeof(startup))
	// Zero standard handles are populated by the attached console. Without
	// this flag, a CLI/test parent can leak its own redirected handles instead.
	startup.Flags = windows.STARTF_USESTDHANDLES
	var process windows.ProcessInformation
	if err := windows.CreateProcess(nil, command, nil, nil, false,
		windows.EXTENDED_STARTUPINFO_PRESENT|windows.CREATE_UNICODE_ENVIRONMENT,
		envPtr, directory, &startup.StartupInfo, &process); err != nil {
		return nil, fmt.Errorf("start ConPTY child: %w", err)
	}
	return &process, nil
}

func environmentBlock(environment []string) ([]uint16, error) {
	if environment == nil {
		return nil, nil // inherit the parent environment
	}
	entries := append([]string(nil), environment...)
	for _, entry := range entries {
		if strings.ContainsRune(entry, '\x00') {
			return nil, fmt.Errorf("NUL in ConPTY environment")
		}
	}
	sort.SliceStable(entries, func(i, j int) bool { return strings.ToUpper(entries[i]) < strings.ToUpper(entries[j]) })
	return utf16.Encode([]rune(strings.Join(entries, "\x00") + "\x00\x00")), nil
}

func (s *Session) Read(data []byte) (int, error)  { return s.output.Read(data) }
func (s *Session) Write(data []byte) (int, error) { return s.input.Write(data) }
func (s *Session) Pid() int                       { return s.pid }

func (s *Session) Resize(cols, rows uint16) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return os.ErrClosed
	}
	if !validSize(cols, rows) {
		return fmt.Errorf("invalid ConPTY dimensions %dx%d", cols, rows)
	}
	status, _, _ := s.api.resize.Call(uintptr(s.hpc), packedSize(cols, rows))
	if status != 0 {
		return fmt.Errorf("ConptyResizePseudoConsole: HRESULT %#x", status)
	}
	return nil
}

func (s *Session) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.closed {
		s.closed = true
		if s.hpc != 0 {
			s.api.close.Call(uintptr(s.hpc))
		}
		s.closeErr = errors.Join(s.input.Close(), s.output.Close())
	}
	return s.closeErr
}
