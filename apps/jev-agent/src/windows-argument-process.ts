import { randomUUID } from "node:crypto"
import { join } from "node:path"
import type { AssistantExternalAgent } from "@vibeshape/automation-api/assistant"
import { windowsAgentCommand } from "./windows-agent-command"

// The supervisor joins the job before spawning the agent; the job handle is not inherited.
// Its native wait also notices host death, which cannot deliver Node signal handlers on Windows.
const supervisor = `
$ErrorActionPreference = 'Stop'
$trace = $env:VIBESHAPE_ARGUMENT_TRACE
function Trace($stage) {
  if ($trace) {
    try {
      $entry = '{"time":"' + [DateTime]::UtcNow.ToString('o') + '","stage":"' + $stage + '","entryPoint":"windows-argument-supervisor"}'
      [IO.File]::AppendAllText($trace, $entry + [Environment]::NewLine)
    } catch {}
  }
}
Trace 'script-start'
Trace ('runtime:' + $PSVersionTable.PSVersion + ':' + [Environment]::Version + ':' + [Environment]::Is64BitProcess)
try {
  Trace 'compile-start'
  # Explicit empty input keeps cmdlet setup from reading the open ACP stdin pipe.
  @() | Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class VibeShapeArgumentJob {
  static readonly string TracePath = Environment.GetEnvironmentVariable("VIBESHAPE_ARGUMENT_TRACE");
  static void Trace(string stage) {
    if (String.IsNullOrEmpty(TracePath)) return;
    try {
      System.IO.File.AppendAllText(TracePath, "{\\"entryPoint\\":\\"windows-argument-supervisor\\",\\"time\\":\\"" +
        DateTime.UtcNow.ToString("o") + "\\",\\"stage\\":\\"" + stage + "\\"}\\n");
    } catch {}
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint GetFileType(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetHandleInformation(IntPtr handle, out uint flags);

  [StructLayout(LayoutKind.Sequential)]
  struct StartupInfo {
    public uint Size;
    public IntPtr Reserved, Desktop, Title;
    public uint X, Y, Width, Height, Columns, Rows, Fill, Flags;
    public ushort ShowWindow, ReservedSize;
    public IntPtr ReservedData, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct StartupInfoEx {
    public StartupInfo Startup;
    public IntPtr Attributes;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInfo {
    public IntPtr Process, Thread;
    public uint ProcessId, ThreadId;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess,
    out IntPtr target, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute,
    IntPtr value, IntPtr size, IntPtr previous, IntPtr returnedSize);
  [DllImport("kernel32.dll")]
  static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CreateProcessW(string application, StringBuilder commandLine,
    IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags,
    IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr handle);

  static ProcessInfo StartChild(string command, string arguments, string directory) {
    IntPtr[] handles = new IntPtr[3];
    IntPtr attributes = IntPtr.Zero, handleList = IntPtr.Zero;
    bool initialized = false;
    try {
      for (int i = 0; i < handles.Length; i++) {
        IntPtr source = GetStdHandle(-10 - i);
        if (source == IntPtr.Zero || source == new IntPtr(-1)) throw new Win32Exception();
        if (!DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(),
          out handles[i], 0, true, 2)) throw new Win32Exception(); // DUPLICATE_SAME_ACCESS
      }
      IntPtr size = IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      if (size == IntPtr.Zero) throw new Win32Exception();
      attributes = Marshal.AllocHGlobal(size);
      if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref size)) throw new Win32Exception();
      initialized = true;
      handleList = Marshal.AllocHGlobal(IntPtr.Size * handles.Length);
      Marshal.Copy(handles, 0, handleList, handles.Length);
      // Restrict inheritance to the three raw ACP streams; the job handle must stay with us.
      if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handleList,
        new IntPtr(IntPtr.Size * handles.Length), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
      StartupInfoEx startup = new StartupInfoEx();
      startup.Startup.Size = (uint)Marshal.SizeOf(startup);
      startup.Startup.Flags = 0x100; // STARTF_USESTDHANDLES
      startup.Startup.Input = handles[0];
      startup.Startup.Output = handles[1];
      startup.Startup.Error = handles[2];
      startup.Attributes = attributes;
      ProcessInfo child;
      StringBuilder line = new StringBuilder(((char)34) + command + ((char)34) + " " + arguments);
      // EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW; argv is already CRT-quoted by the host.
      if (!CreateProcessW(command, line, IntPtr.Zero, IntPtr.Zero, true, 0x08080000,
        IntPtr.Zero, directory, ref startup, out child)) throw new Win32Exception();
      return child;
    } finally {
      if (initialized) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (handleList != IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      foreach (IntPtr handle in handles) if (handle != IntPtr.Zero) CloseHandle(handle);
    }
  }

  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimits {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet;
    public uint ActiveProcesses;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong ReadCount, WriteCount, OtherCount, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimits {
    public BasicLimits Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool all, uint timeout);

  static void InstallJob() {
    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    ExtendedLimits limits = new ExtendedLimits();
    limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
      throw new Win32Exception();
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) throw new Win32Exception();
    // Keep the raw handle open until process exit, even when the ACP leader exits first.
  }

  public static int Run(string command, string arguments, string directory, int parentPid, string ready) {
    Trace("job-start");
    using (Process parent = Process.GetProcessById(parentPid)) {
      IntPtr parentHandle = parent.Handle;
      InstallJob();
      Trace("job-ready");
      if (!String.IsNullOrEmpty(TracePath)) {
        foreach (int id in new int[] { -10, -11, -12 }) {
          IntPtr handle = GetStdHandle(id);
          uint flags;
          bool valid = GetHandleInformation(handle, out flags);
          int error = valid ? 0 : Marshal.GetLastWin32Error();
          Trace("stdio:" + id + ":" + handle.ToInt64() + ":" + GetFileType(handle) + ":" + valid + ":" + flags + ":" + error);
        }
      }
      Environment.SetEnvironmentVariable("VIBESHAPE_ARGUMENT_LAUNCH", null);
      Environment.SetEnvironmentVariable("VIBESHAPE_ARGUMENT_TRACE", null);
      Trace("child-start");
      ProcessInfo child = StartChild(command, arguments, directory);
      try {
        Trace("child-ready:" + child.ProcessId);
        Console.Error.WriteLine(ready);
        Console.Error.Flush();
        Trace("protocol-ready");
        uint stopped = WaitForMultipleObjects(2, new IntPtr[] { parentHandle, child.Process }, false, UInt32.MaxValue);
        Trace("wait:" + stopped);
        if (stopped == 0) return 1;
        if (stopped != 1) throw new Win32Exception();
        uint code;
        if (!GetExitCodeProcess(child.Process, out code)) throw new Win32Exception();
        return unchecked((int)code);
      } finally {
        CloseHandle(child.Thread);
        CloseHandle(child.Process);
      }
    }
  }
}
'@
  Trace 'compile-ready'
  $launch = $env:VIBESHAPE_ARGUMENT_LAUNCH | ConvertFrom-Json
  $result = [VibeShapeArgumentJob]::Run($launch.command, $launch.arguments, $launch.cwd, $launch.parentPid, $launch.ready)
  exit $result
} catch {
  Trace ('failure:' + $_.Exception.HResult)
  [Console]::Error.WriteLine('The Windows argument agent job could not start.')
  exit 1
}
`

function quoteArgument(value: string) {
  // Windows CRT quoting: double backslashes before a literal quote or the closing quote.
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`
}

export async function windowsArgumentLaunch(
  agent: AssistantExternalAgent,
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  const root = env.SystemRoot ?? env.SYSTEMROOT
  if (!root) throw new Error("Windows system directory is unavailable.")
  const executable = await windowsAgentCommand(agent, env, cwd)
  const ready = `vibeshape-arguments-ready:${randomUUID()}`
  return {
    ready,
    command: join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", supervisor],
    env: {
      ...env,
      VIBESHAPE_ARGUMENT_LAUNCH: JSON.stringify({
        command: executable.command,
        arguments: executable.args.map(quoteArgument).join(" "),
        cwd,
        parentPid: process.pid,
        ready,
      }),
    },
  }
}
