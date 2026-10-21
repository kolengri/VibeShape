import { execFile, execFileSync } from "node:child_process"
import { closeSync, constants, fchmodSync, fstatSync, mkdirSync, openSync } from "node:fs"
import { open } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { z } from "zod"

const privateFileError = "Native workflows require a private file owned by this user."
const execute = promisify(execFile)

const windowsFailureSchema = z.object({
  code: z
    .union([
      z.number().int(),
      z.enum([
        "unknown",
        "ENOENT",
        "EACCES",
        "EPERM",
        "ETIMEDOUT",
        "EPIPE",
        "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      ]),
    ])
    .catch("unknown")
    .optional(),
  killed: z.boolean().optional(),
  stderr: z.string().max(131072).optional(),
})

/** Only fixed process metadata may cross the credential-reader diagnostic boundary. */
export class WindowsPrivateFileReadError extends Error {
  constructor(error: unknown) {
    const failure = windowsFailureSchema.safeParse(error)
    const detail = failure.success ? failure.data : null
    const markers = [
      ...(detail?.stderr?.matchAll(/VIBESHAPE_PRIVATE:(compile|operation|complete)/g) ?? []),
    ]
    const stage = markers.at(-1)?.[1] ?? "not-started"
    const status = detail?.killed ? "terminated" : (detail?.code ?? "unknown")
    super(`${privateFileError} Windows reader status=${status}, stage=${stage}.`)
  }
}

// Keep paths and file contents out of executable text. Windows PowerShell 5.1 is OS-provided.
// Native handles bind ACL inspection and reading to the same non-reparse filesystem object.
const windowsScript = `
$ErrorActionPreference = 'Stop'
try {
  [Console]::Error.WriteLine('VIBESHAPE_PRIVATE:compile')
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

public static class VibeShapePrivateFiles {
  [StructLayout(LayoutKind.Sequential)]
  struct FileInfo {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Creation, Access, Write;
    public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
    IntPtr security, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
  [DllImport("kernel32.dll")]
  static extern uint GetFileType(SafeFileHandle file);
  [DllImport("advapi32.dll")]
  static extern uint GetSecurityInfo(SafeFileHandle file, uint type, uint information,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll")]
  static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("advapi32.dll")]
  static extern uint SetSecurityInfo(SafeFileHandle file, uint type, uint information,
    IntPtr owner, IntPtr group, byte[] dacl, IntPtr sacl);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);

  static SecurityIdentifier CurrentUser() {
    using (var identity = WindowsIdentity.GetCurrent()) {
      if (identity.User == null) throw new IOException("Missing current user.");
      return identity.User;
    }
  }
  static SafeFileHandle Open(string path, bool directory, bool writeAcl) {
    // READ_CONTROL, optional WRITE_DAC, GENERIC_READ for files; deny concurrent write/delete.
    var handle = CreateFileW(path, 0x20000u | (writeAcl ? 0x40000u : 0u) |
      (directory ? 0u : 0x80000000u), 1, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
    try {
      if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
      FileInfo info;
      if (!GetFileInformationByHandle(handle, out info))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      if (GetFileType(handle) != 1 || (info.Attributes & 0x400) != 0 ||
          ((info.Attributes & 0x10) != 0) != directory)
        throw new IOException("Unexpected file type or reparse point.");
      return handle;
    } catch { handle.Dispose(); throw; }
  }
  static RawSecurityDescriptor Security(SafeFileHandle handle) {
    IntPtr owner, group, dacl, sacl, descriptor;
    uint result = GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl,
      out sacl, out descriptor);
    if (result != 0) throw new Win32Exception((int)result);
    try {
      var bytes = new byte[GetSecurityDescriptorLength(descriptor)];
      Marshal.Copy(descriptor, bytes, 0, bytes.Length);
      return new RawSecurityDescriptor(bytes, 0);
    } finally { LocalFree(descriptor); }
  }
  static void Validate(RawSecurityDescriptor security, SecurityIdentifier user) {
    if (!user.Equals(security.Owner) || security.DiscretionaryAcl == null ||
        security.DiscretionaryAcl.Count == 0)
      throw new IOException("Missing current-user owner or private DACL.");
    foreach (GenericAce entry in security.DiscretionaryAcl) {
      var ace = entry as CommonAce;
      // Fail closed on other principals, callback/object ACEs, and unknown ACL semantics.
      if (ace == null || ace.IsCallback || ace.AceQualifier != AceQualifier.AccessAllowed ||
          !user.Equals(ace.SecurityIdentifier))
        throw new IOException("The DACL is not restricted to the current user.");
    }
  }
  public static void Prepare(string path) {
    var user = CurrentUser();
    var policy = new DirectorySecurity();
    policy.SetOwner(user);
    policy.SetAccessRuleProtection(true, false);
    policy.AddAccessRule(new FileSystemAccessRule(user, FileSystemRights.FullControl,
      InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
      PropagationFlags.None, AccessControlType.Allow));
    // Existing directories are not reassigned; creation supplies the owner before exposure.
    Directory.CreateDirectory(path, policy);
    using (var handle = Open(path, true, true)) {
      var previous = Security(handle);
      if (!user.Equals(previous.Owner)) throw new IOException("Unexpected owner.");
      var existing = previous.DiscretionaryAcl != null && previous.DiscretionaryAcl.Count == 1
        ? previous.DiscretionaryAcl[0] as CommonAce : null;
      var inheritance = AceFlags.ContainerInherit | AceFlags.ObjectInherit;
      if ((previous.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0 &&
          existing != null && !existing.IsCallback && existing.AceQualifier == AceQualifier.AccessAllowed &&
          user.Equals(existing.SecurityIdentifier) && existing.AccessMask == 0x1f01ff &&
          existing.AceFlags == inheritance) return;
      var acl = new RawAcl(2, 1);
      acl.InsertAce(0, new CommonAce(inheritance,
        AceQualifier.AccessAllowed, 0x1f01ff, user, false, null));
      var bytes = new byte[acl.BinaryLength];
      acl.GetBinaryForm(bytes, 0);
      // Protected DACL: one inheritable current-user FullControl grant, no inherited grants.
      uint result = SetSecurityInfo(handle, 1, 0x80000004, IntPtr.Zero, IntPtr.Zero,
        bytes, IntPtr.Zero);
      if (result != 0) throw new Win32Exception((int)result);
      var security = Security(handle);
      Validate(security, user);
      if ((security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0)
        throw new IOException("Directory DACL inheritance is not protected.");
    }
  }
  public static string Read(string path, int maximum) {
    using (var handle = Open(path, false, false)) {
      Validate(Security(handle), CurrentUser());
      using (var stream = new FileStream(handle, FileAccess.Read)) {
        long size = stream.Length;
        if (size > maximum) throw new IOException("Private file is too large.");
        var bytes = new byte[maximum + 1];
        int count = 0, read;
        while (count < bytes.Length &&
            (read = stream.Read(bytes, count, bytes.Length - count)) != 0) count += read;
        if (count != size || count > maximum) throw new IOException("Private file changed.");
        return Convert.ToBase64String(bytes, 0, count);
      }
    }
  }
  public static void Write(string path, Stream input, int length) {
    var user = CurrentUser();
    var policy = new FileSecurity();
    policy.SetOwner(user);
    policy.SetAccessRuleProtection(true, false);
    policy.AddAccessRule(new FileSystemAccessRule(user, FileSystemRights.FullControl,
      AccessControlType.Allow));
    // CreateNew refuses existing files and reparse points. No inherited/default owner is used.
    using (var stream = new FileStream(path, FileMode.CreateNew,
        FileSystemRights.Write | FileSystemRights.ReadPermissions, FileShare.None, 4096,
        FileOptions.None, policy)) {
      Validate(Security(stream.SafeFileHandle), user);
      var buffer = new byte[4096];
      int count = 0, read;
      while ((read = input.Read(buffer, 0, buffer.Length)) != 0) {
        count += read;
        if (count > length) throw new IOException("Private file input is too large.");
        stream.Write(buffer, 0, read);
      }
      if (count != length) throw new IOException("Private file input is incomplete.");
      stream.Flush(true);
    }
  }
}
'@
  [Console]::Error.WriteLine('VIBESHAPE_PRIVATE:operation')
  $path = [Environment]::GetEnvironmentVariable('VIBESHAPE_PRIVATE_PATH')
  if ($env:VIBESHAPE_PRIVATE_OPERATION -eq 'prepare') {
    [VibeShapePrivateFiles]::Prepare($path)
  } elseif ($env:VIBESHAPE_PRIVATE_OPERATION -eq 'read') {
    [Console]::Out.Write([VibeShapePrivateFiles]::Read($path, [int]$env:VIBESHAPE_PRIVATE_LIMIT))
  } elseif ($env:VIBESHAPE_PRIVATE_OPERATION -eq 'write') {
    [VibeShapePrivateFiles]::Write($path, [Console]::OpenStandardInput(), [int]$env:VIBESHAPE_PRIVATE_LIMIT)
  } else { throw 'Unsupported private-file operation.' }
  [Console]::Error.WriteLine('VIBESHAPE_PRIVATE:complete')
} catch {
  [Console]::Error.WriteLine('Windows private-file protection failed.')
  exit 1
}
`
const windowsArguments = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(windowsScript, "utf16le").toString("base64"),
]

function windowsOperation(operation: "prepare" | "read" | "write", path: string, maximum = 0) {
  return {
    executable: join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    options: {
      env: {
        ...process.env,
        VIBESHAPE_PRIVATE_OPERATION: operation,
        VIBESHAPE_PRIVATE_PATH: path,
        VIBESHAPE_PRIVATE_LIMIT: String(maximum),
      },
      timeout: 15_000,
      maxBuffer: Math.max(4096, maximum * 2 + 4096),
      windowsHide: true,
      encoding: "utf8" as const,
    },
  }
}

export function preparePrivateDirectory(path: string) {
  if (process.platform === "win32") {
    const { executable, options } = windowsOperation("prepare", path)
    try {
      execFileSync(executable, windowsArguments, { ...options, stdio: ["ignore", "pipe", "pipe"] })
    } catch {
      throw new Error("Native workflows require a private directory owned by this user.")
    }
    return
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const directory = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const details = fstatSync(directory)
    if (!details.isDirectory() || (process.getuid && details.uid !== process.getuid()))
      throw new Error("Native workflows require a private directory owned by this user.")
    fchmodSync(directory, 0o700)
  } finally {
    closeSync(directory)
  }
}

export async function writePrivateFile(path: string, content: string) {
  const bytes = Buffer.from(content, "utf8")
  if (process.platform === "win32") {
    const { executable, options } = windowsOperation("write", path, bytes.length)
    try {
      const pending = execute(executable, windowsArguments, options)
      // The process result reports early exits that can close stdin before it drains.
      pending.child.stdin?.on("error", () => {})
      pending.child.stdin?.end(bytes)
      await pending
    } catch {
      throw new Error(privateFileError)
    }
    return
  }
  const file = await open(path, "wx", 0o600)
  try {
    await file.writeFile(bytes)
    await file.sync()
  } finally {
    await file.close()
  }
}

export async function readPrivateFile(path: string, maximum: number): Promise<Buffer> {
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 65536)
    throw new Error("Invalid private-file size limit.")
  if (process.platform === "win32") {
    const { executable, options } = windowsOperation("read", path, maximum)
    try {
      const { stdout } = await execute(executable, windowsArguments, options)
      return Buffer.from(stdout, "base64")
    } catch (error) {
      throw new WindowsPrivateFileReadError(error)
    }
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const details = await file.stat()
    if (
      !details.isFile() ||
      details.size > maximum ||
      (details.mode & 0o077) !== 0 ||
      (process.getuid && details.uid !== process.getuid())
    )
      throw new Error(privateFileError)
    const buffer = Buffer.alloc(maximum + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead !== details.size || bytesRead > maximum) throw new Error(privateFileError)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}
