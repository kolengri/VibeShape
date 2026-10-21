import { join } from "node:path"
import type { AssistantExternalAgent } from "@vibeshape/automation-api/assistant"

// The supervisor joins the job before spawning the agent; the job handle is not inherited.
// Its native wait also notices host death, which cannot deliver Node signal handlers on Windows.
const supervisor = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class VibeShapeArgumentJob {
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

  public static int Run(string command, string arguments, string directory, int parentPid) {
    using (Process parent = Process.GetProcessById(parentPid)) {
      IntPtr parentHandle = parent.Handle;
      InstallJob();
      ProcessStartInfo start = new ProcessStartInfo(command, arguments);
      start.UseShellExecute = false;
      start.CreateNoWindow = true;
      start.WorkingDirectory = directory;
      start.EnvironmentVariables.Remove("VIBESHAPE_ARGUMENT_LAUNCH");
      using (Process child = Process.Start(start)) {
        uint stopped = WaitForMultipleObjects(2, new IntPtr[] { parentHandle, child.Handle }, false, UInt32.MaxValue);
        if (stopped == 0) return 1;
        if (stopped != 1) throw new Win32Exception();
        return child.ExitCode;
      }
    }
  }
}
'@
  $launch = ConvertFrom-Json $env:VIBESHAPE_ARGUMENT_LAUNCH
  $result = [VibeShapeArgumentJob]::Run($launch.command, $launch.arguments, $launch.cwd, $launch.parentPid)
  exit $result
} catch {
  [Console]::Error.WriteLine('The Windows argument agent job could not start.')
  exit 1
}
`

function quoteArgument(value: string) {
  // Windows CRT quoting: double backslashes before a literal quote or the closing quote.
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1")}"`
}

export function windowsArgumentLaunch(
  agent: AssistantExternalAgent,
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  const root = env.SystemRoot ?? env.SYSTEMROOT
  if (!root) throw new Error("Windows system directory is unavailable.")
  return {
    command: join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", supervisor],
    env: {
      ...env,
      VIBESHAPE_ARGUMENT_LAUNCH: JSON.stringify({
        command: agent.command,
        arguments: agent.args.map(quoteArgument).join(" "),
        cwd,
        parentPid: process.pid,
      }),
    },
  }
}
