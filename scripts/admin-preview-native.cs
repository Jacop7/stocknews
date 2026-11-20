// ADMIN_PREVIEW_NATIVE_C1B. Explicit synthetic file boundary and owned Windows Job execution.
// No credential source, network client, arbitrary command, fallback AssignProcessToJobObject or PID kill API.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Principal;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class JudojuAdminNative {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength=1048576 };
  static string Root;
  const string Node = @"C:\Program Files\nodejs\node.exe";
  const string PowerShell = @"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe";
  const uint INVALID=0xffffffff, REPARSE=0x400, DIRECTORY=0x10;
  const uint SYNCHRONIZE=0x00100000, QUERY=0x1000;
  [StructLayout(LayoutKind.Sequential)] struct Security { public int Length; public IntPtr Descriptor; public int Inherit; }
  [StructLayout(LayoutKind.Sequential)] struct FileInfo { public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation,Access,Write; public uint Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow; }
  [StructLayout(LayoutKind.Sequential)] struct Startup { public int cb; public IntPtr reserved,desktop,title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process,Thread; public uint Pid,Tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long ProcessTime,JobTime; public uint Flags; public UIntPtr Min,Max; public uint Count; public UIntPtr Affinity; public uint Priority,Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFileAttributes(string name);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateDirectory(string name,IntPtr security);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHGetKnownFolderPath(ref Guid folder,uint flags,IntPtr token,out IntPtr path);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out FileInfo info);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int cls,ref ExtendedLimit info,int length);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int cls,out Accounting info,int length,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Security attributes,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool result);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr process,int flags,StringBuilder text,ref int size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("advapi32.dll",SetLastError=true)] static extern uint GetSecurityInfo(IntPtr handle,int type,uint flags,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
  [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text,uint revision,out IntPtr descriptor,out uint size);
  [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  static readonly string SelectedOwner="e85049b7-7306-42ad-ac16-6c4bf5e82212";
  static string Digest(byte[] bytes) { using(var h=SHA256.Create())return BitConverter.ToString(h.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
  static void PrivateAcl(SafeFileHandle h,bool protectedAcl=true) {
    IntPtr owner,group,dacl,sacl,descriptor;Require(GetSecurityInfo(h.DangerousGetHandle(),1,5,out owner,out group,out dacl,out sacl,out descriptor)==0,"ACL_QUERY");
    try {
      uint count=GetSecurityDescriptorLength(descriptor);Require(count>0&&count<=65536,"ACL_SIZE");byte[] raw=new byte[count];Marshal.Copy(descriptor,raw,0,(int)count);
      var sd=new RawSecurityDescriptor(raw,0);string sid=WindowsIdentity.GetCurrent().User.Value;
      Require(sd.Owner!=null&&sd.Owner.Value==sid&&sd.DiscretionaryAcl!=null,"PRIVATE_OWNER");
      Require(!protectedAcl||(sd.ControlFlags&ControlFlags.DiscretionaryAclProtected)!=0,"PROTECTED_DACL");
      foreach(GenericAce ace in sd.DiscretionaryAcl) {
        var common=ace as CommonAce;Require(common!=null,"ACL_UNKNOWN_ACE");
        if(common.AceQualifier==AceQualifier.AccessAllowed)Require(new[]{sid,"S-1-5-18","S-1-5-32-544"}.Contains(common.SecurityIdentifier.Value),"ACL_OTHER_PRINCIPAL");
        else Require(common.AceQualifier==AceQualifier.AccessDenied,"ACL_UNKNOWN_ACE");
      }
    }finally{LocalFree(descriptor);}
  }
  sealed class CreatedFile {public string FileIdentity,Sha256;}
  sealed class PrivateObservation {public byte[] Bytes;public string FileIdentity;}
  static CreatedFile SecureCreate(string target,byte[] bytes,bool directory,bool failBeforeFlush=false) {
    CreatedFile created=null;
    Components(Path.GetDirectoryName(target),false);IntPtr sd=IntPtr.Zero,sa=IntPtr.Zero;uint size;
    try {
      string sid=WindowsIdentity.GetCurrent().User.Value;
      Require(ConvertStringSecurityDescriptorToSecurityDescriptor("O:"+sid+"D:P(A;;FA;;;"+sid+")(A;;FA;;;SY)(A;;FA;;;BA)",1,out sd,out size),"PRIVATE_DESCRIPTOR");
      var security=new Security{Length=Marshal.SizeOf(typeof(Security)),Descriptor=sd,Inherit=0};sa=Marshal.AllocHGlobal(security.Length);Marshal.StructureToPtr(security,sa,false);
      if(directory){Require(CreateDirectory(target,sa),"EXCLUSIVE_PRIVATE_DIRECTORY");return null;}
      using(SafeFileHandle h=CreateFile(target,0xc0000000,0,sa,1,0x00200000,IntPtr.Zero)){
        Require(!h.IsInvalid,"EXCLUSIVE_PRIVATE_FILE");Info(h);PrivateAcl(h);
        using(var stream=new FileStream(h,FileAccess.ReadWrite)){stream.Write(bytes,0,bytes.Length);if(failBeforeFlush)throw new IOException("PRIVATE_FLUSH_INJECTED");stream.Flush(true);Require(Info(h).SizeLow==bytes.Length,"PRIVATE_WRITE_SIZE");created=new CreatedFile{FileIdentity=Identity(Info(h)),Sha256=Digest(bytes)};}
      }
    }finally{if(sa!=IntPtr.Zero)Marshal.FreeHGlobal(sa);if(sd!=IntPtr.Zero)LocalFree(sd);}
    var observed=ObservePrivateFile(target,1048576);Require(created!=null&&observed.Bytes.SequenceEqual(bytes)&&observed.FileIdentity==created.FileIdentity,"PRIVATE_WRITE_VERIFY");return created;
  }
  static byte[] PrivateRead(string target,int limit,bool protectedAcl=true){return ObservePrivateFile(target,limit,protectedAcl).Bytes;}
  static PrivateObservation ObservePrivateFile(string target,int limit,bool protectedAcl=true) {
    Components(target,false);
    using(SafeFileHandle h=CreateFile(target,0x80020000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){
      FileInfo before=Info(h);PrivateAcl(h,protectedAcl);Require(before.SizeHigh==0&&before.SizeLow<=limit,"PRIVATE_SIZE");
      using(var stream=new FileStream(h,FileAccess.Read)){
        byte[] bytes=new byte[before.SizeLow];int n=0,k;while(n<bytes.Length&&(k=stream.Read(bytes,n,bytes.Length-n))>0)n+=k;
        Require(n==bytes.Length&&stream.ReadByte()==-1&&Identity(before)==Identity(Info(h)),"PRIVATE_READ_CHANGED");
        new UTF8Encoding(false,true).GetString(bytes);Components(target,false);
        using(SafeFileHandle again=CreateFile(target,0x80020000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero)){Require(Identity(before)==Identity(Info(again)),"PRIVATE_PATH_CHANGED");PrivateAcl(again,protectedAcl);}
        return new PrivateObservation{Bytes=bytes,FileIdentity=Identity(before)};
      }
    }
  }
  // The bytes checked and delivered are one snapshot. Retained read-only handles
  // deny writes/deletes until every dependent validation and response is complete.
  sealed class PrivateSnapshot:IDisposable {
    readonly List<FileStream> Streams=new List<FileStream>();
    public readonly Dictionary<string,byte[]> Bytes=new Dictionary<string,byte[]>(StringComparer.Ordinal);
    public PrivateSnapshot(string dir,string[] leaves) {
      try {foreach(string leaf in leaves){
        string target=Path.Combine(dir,leaf);Components(target,false);
        SafeFileHandle h=CreateFile(target,0x80020000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
        FileStream stream=null;
        try {
          FileInfo before=Info(h);PrivateAcl(h);int limit=leaf=="admin-server.json"?16384:leaf=="rendered.sql"?524288:65536;
          Require(before.SizeHigh==0&&before.SizeLow<=limit,"PRIVATE_SIZE");
          stream=new FileStream(h,FileAccess.Read);Streams.Add(stream);h=null;
          byte[] bytes=new byte[before.SizeLow];int n=0,k;while(n<bytes.Length&&(k=stream.Read(bytes,n,bytes.Length-n))>0)n+=k;
          Require(n==bytes.Length&&stream.ReadByte()==-1&&Identity(before)==Identity(Info(stream.SafeFileHandle)),"PRIVATE_SNAPSHOT_CHANGED");
          new UTF8Encoding(false,true).GetString(bytes);Bytes.Add(leaf,bytes);
        }finally{if(h!=null)h.Dispose();}
      }}catch{Dispose();throw;}
    }
    public Dictionary<string,object> Object(string leaf){return Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(Bytes[leaf]));}
    public void Dispose(){foreach(var stream in Streams)stream.Dispose();Streams.Clear();}
  }
  static List<SafeFileHandle> HoldParents(string target) {
    var held=new List<SafeFileHandle>();
    try {
      string at=Path.GetPathRoot(Full(target));foreach(string part in Full(target).Substring(at.Length).Split(new[]{'\\'},StringSplitOptions.RemoveEmptyEntries)){
        at=Path.Combine(at,part);Components(at,false);var h=CreateFile(at,0x80020001,3,IntPtr.Zero,3,0x02000000|0x00200000,IntPtr.Zero);held.Add(h);
        FileInfo i;Require(!h.IsInvalid&&GetFileInformationByHandle(h,out i)&&(i.Attributes&DIRECTORY)!=0&&(i.Attributes&REPARSE)==0,"HELD_PARENT");
      }return held;
    }catch{foreach(var h in held)h.Dispose();throw;}
  }
  [StructLayout(LayoutKind.Sequential)] struct UnicodeName { public ushort Length,MaximumLength;public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] struct ObjectAttributes { public int Length;public IntPtr RootDirectory,ObjectName;public uint Attributes;public IntPtr SecurityDescriptor,SecurityQualityOfService; }
  [StructLayout(LayoutKind.Sequential)] struct IoStatusBlock { public IntPtr Status;public UIntPtr Information; }
  [DllImport("ntdll.dll")] static extern int NtCreateFile(out SafeFileHandle file,uint access,ref ObjectAttributes attributes,out IoStatusBlock io,IntPtr allocation,uint fileAttributes,uint share,uint disposition,uint options,IntPtr ea,uint eaLength);
  static SafeFileHandle AtomicPrivateDirectory(SafeFileHandle parent,string leaf) {
    Require(!String.IsNullOrEmpty(leaf)&&Path.GetFileName(leaf)==leaf&&!leaf.Contains("\\")&&!leaf.Contains(":"),"PRIVATE_DIRECTORY_LEAF");
    IntPtr name=IntPtr.Zero,unicode=IntPtr.Zero,sd=IntPtr.Zero;SafeFileHandle created=null;uint size;
    try {
      name=Marshal.StringToHGlobalUni(leaf);var text=new UnicodeName{Length=checked((ushort)(leaf.Length*2)),MaximumLength=checked((ushort)((leaf.Length+1)*2)),Buffer=name};
      unicode=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(UnicodeName)));Marshal.StructureToPtr(text,unicode,false);
      string sid=WindowsIdentity.GetCurrent().User.Value;
      Require(ConvertStringSecurityDescriptorToSecurityDescriptor("O:"+sid+"D:P(A;;FA;;;"+sid+")(A;;FA;;;SY)(A;;FA;;;BA)",1,out sd,out size),"PRIVATE_DESCRIPTOR");
      var attrs=new ObjectAttributes{Length=Marshal.SizeOf(typeof(ObjectAttributes)),RootDirectory=parent.DangerousGetHandle(),ObjectName=unicode,Attributes=0x40,SecurityDescriptor=sd};IoStatusBlock io;
      // FILE_CREATE + FILE_DIRECTORY_FILE, synchronous no-follow, relative to the held parent; no DELETE sharing.
      int status=NtCreateFile(out created,0x80120081,ref attrs,out io,IntPtr.Zero,DIRECTORY,3,2,0x00200021,IntPtr.Zero,0);
      Require(status>=0&&created!=null&&!created.IsInvalid&&io.Information.ToUInt64()==2,"EXCLUSIVE_PRIVATE_DIRECTORY_HANDLE");
      return created;
    }catch{if(created!=null)created.Dispose();throw;}
    finally{if(sd!=IntPtr.Zero)LocalFree(sd);if(unicode!=IntPtr.Zero)Marshal.FreeHGlobal(unicode);if(name!=IntPtr.Zero)Marshal.FreeHGlobal(name);}
  }
  sealed class Held:IDisposable {
    readonly List<SafeFileHandle> Items;public SafeFileHandle Last {get{return Items.Last();}}
    public Held(List<SafeFileHandle> items){Items=items;}public void Dispose(){foreach(var h in Items)h.Dispose();}
  }
  static string DirectoryHandleIdentity(FileInfo i){return i.Volume+":"+i.IndexHigh+":"+i.IndexLow+":"+i.Creation.dwHighDateTime+":"+i.Creation.dwLowDateTime;}
  sealed class PrivateRootLease:IDisposable {
    Held Parents;SafeFileHandle DirectoryHandle;public readonly string PathName,RootId;
    public PrivateRootLease(string parent,string leaf,string sourceRoot,bool create) {
      PathName=Path.Combine(parent,leaf);
      try {
        Parents=new Held(HoldParents(parent));
        DirectoryHandle=create?AtomicPrivateDirectory(Parents.Last,leaf):CreateFile(PathName,0x80020081,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        FileInfo i=new FileInfo();Require(DirectoryHandle!=null&&!DirectoryHandle.IsInvalid&&GetFileInformationByHandle(DirectoryHandle,out i)&&(i.Attributes&DIRECTORY)!=0&&(i.Attributes&REPARSE)==0,"HELD_PRIVATE_ROOT");
        PrivateAcl(DirectoryHandle);RootId=DirectoryHandleIdentity(i);string marker=Path.Combine(PathName,"actual-owner.json");
        if(create)SecureCreate(marker,Encoding.UTF8.GetBytes(Json.Serialize(new{sourceRoot=sourceRoot,rootId=RootId,ownerSid=WindowsIdentity.GetCurrent().User.Value})),false);
        var m=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(PrivateRead(marker,4096)));
        Require(m.Count==3&&Text(m,"sourceRoot")==sourceRoot&&Text(m,"rootId")==RootId&&Text(m,"ownerSid")==WindowsIdentity.GetCurrent().User.Value,"ACTUAL_ROOT_OWNER");
        Require(GetFileInformationByHandle(DirectoryHandle,out i)&&DirectoryHandleIdentity(i)==RootId,"HELD_ROOT_IDENTITY");
      }catch{Dispose();throw;}
    }
    public void Dispose(){if(DirectoryHandle!=null){DirectoryHandle.Dispose();DirectoryHandle=null;}if(Parents!=null){Parents.Dispose();Parents=null;}}
  }
  static PrivateRootLease OperationRootLease;
  static string ActualRoot(bool create) {
    string local=Path.Combine(Root,".local-data");
    if(OperationRootLease==null)OperationRootLease=new PrivateRootLease(local,"cloud-admin",Root,create);
    else Require(!create,"ACTUAL_ROOT_ALREADY_HELD");
    return OperationRootLease.PathName;
  }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateHardLink(string link,string target,IntPtr security);
  static object PrivateFixture(Dictionary<string,object> p) {
    string root=OwnedFixture(p),dir=Path.Combine(root,"private-fixture");SecureCreate(dir,null,true);var cases=new List<string>();
    byte[] bytes=Encoding.UTF8.GetBytes("SYNTHETIC_C2_PRIVATE_CANARY");string regular=Path.Combine(dir,"regular.json");
    using(var held=new Held(HoldParents(dir))){
      SecureCreate(regular,bytes,false);Require(PrivateRead(regular,4096).SequenceEqual(bytes),"FIXTURE_PRIVATE_ROUNDTRIP");cases.Add("PROTECTED_OWNER_DACL_HANDLE_UTF8_FLUSH");
      bool exclusive=false;try{SecureCreate(regular,bytes,false);}catch(IOException){exclusive=true;}Require(exclusive&&PrivateRead(regular,4096).SequenceEqual(bytes),"FIXTURE_EXCLUSIVE");cases.Add("NO_OVERWRITE");
      bool rename=false;try{Directory.Move(dir,dir+"-moved");}catch(IOException){rename=true;}Require(rename&&Directory.Exists(dir),"FIXTURE_PARENT_HELD");cases.Add("PARENT_RENAME_DENIED_WHILE_HELD");
      string broad=Path.Combine(dir,"broad.json");SecureCreate(broad,bytes,false);var original=File.GetAccessControl(broad);var changed=File.GetAccessControl(broad);
      changed.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.WorldSid,null),FileSystemRights.ReadData,AccessControlType.Allow));File.SetAccessControl(broad,changed);
      bool acl=false;try{PrivateRead(broad,4096);}catch(IOException){acl=true;}Require(acl,"FIXTURE_BROAD_DACL");
      var restored=new FileSecurity();restored.SetSecurityDescriptorSddlForm(original.GetSecurityDescriptorSddlForm(AccessControlSections.Access),AccessControlSections.Access);File.SetAccessControl(broad,restored);
      Require(PrivateRead(broad,4096).SequenceEqual(bytes),"FIXTURE_ACL_RESTORED");cases.Add("OTHER_PRINCIPAL_REJECTED_RESTORED_POSITIVE");
      string target=Path.Combine(dir,"hard-target.json"),link=Path.Combine(dir,"hard-link.json");SecureCreate(target,bytes,false);Require(CreateHardLink(link,target,IntPtr.Zero),"FIXTURE_HARDLINK_CREATE");
      bool hard=false;try{PrivateRead(target,4096);}catch(IOException){hard=true;}Require(hard,"FIXTURE_HARDLINK_REJECT");cases.Add("MULTIPLE_HARDLINKS_REJECTED");
      bool utf8=false;try{SecureCreate(Path.Combine(dir,"invalid-utf8.json"),new byte[]{255},false);}catch(DecoderFallbackException){utf8=true;}Require(utf8,"FIXTURE_UTF8_REJECT");cases.Add("INVALID_UTF8_REJECTED_AFTER_WRITE_NO_SUCCESS");
      bool partial=false;string partialFile=Path.Combine(dir,"partial.json");try{SecureCreate(partialFile,bytes,false,true);}catch(IOException){partial=true;}Require(partial&&File.Exists(partialFile),"FIXTURE_PARTIAL_PRESERVED");cases.Add("FLUSH_FAILURE_PRESERVED_NOT_SUCCESS");
    }
    using(var lease=new PrivateRootLease(dir,"atomic-held-root",root,true)){
      bool denied=false;try{Directory.Move(lease.PathName,lease.PathName+"-replacement");}catch(IOException){denied=true;}
      Require(denied&&Directory.Exists(lease.PathName),"ROOT_REPLACEMENT_MUST_FAIL_WHILE_HELD");
      SecureCreate(Path.Combine(lease.PathName,"held-canary.json"),bytes,false);Require(PrivateRead(Path.Combine(lease.PathName,"held-canary.json"),4096).SequenceEqual(bytes),"HELD_ROOT_CANARY");
      cases.Add("ATOMIC_DIRECTORY_HANDLE_MARKER_HELD_THROUGH_USE");cases.Add("ROOT_REPLACEMENT_DENIED_AT_VALIDATION_USE_BOUNDARY");
    }
    using(var lease=new PrivateRootLease(dir,"atomic-held-root",root,false))Require(PrivateRead(Path.Combine(lease.PathName,"held-canary.json"),4096).SequenceEqual(bytes),"HELD_ROOT_REOPEN_POSITIVE");
    var before=new Dictionary<string,object>{{"generation",1},{"phase","BEFORE_AUTH"},{"ownerUserId",SelectedOwner},{"authSessionId",null},{"capabilityHash",null}};
    var opened=new Dictionary<string,object>(before);opened["phase"]="BEFORE_OPEN";opened["authSessionId"]="11111111-1111-4111-8111-111111111111";opened["capabilityHash"]=new string('a',64);
    var complete=new Dictionary<string,object>(opened);complete["phase"]="COMPLETE";
    CheckJournalSequence(new List<Dictionary<string,object>>{before,opened,complete});cases.Add("NATIVE_JOURNAL_SEQUENCE_POSITIVE");
    var substituted=new Dictionary<string,object>(complete);substituted["capabilityHash"]=new string('b',64);bool conflict=false;try{CheckJournalSequence(new List<Dictionary<string,object>>{before,opened,substituted});}catch(IOException){conflict=true;}Require(conflict,"JOURNAL_FIXTURE_CONFLICT");cases.Add("NATIVE_JOURNAL_CROSS_PHASE_BINDING_REJECTED");
    string persisted=Path.Combine(dir,"persisted-journal");SecureCreate(persisted,null,true);int frame=0;foreach(var e in new[]{before,opened,substituted})SecureCreate(Path.Combine(persisted,"journal-"+(++frame).ToString("D4")+".json"),Encoding.UTF8.GetBytes(Json.Serialize(e)),false);
    bool persistedConflict=false;try{string[] names;ReadJournalEntriesAt(persisted,out names);}catch(IOException){persistedConflict=true;}Require(persistedConflict,"JOURNAL_PERSISTED_FIXTURE_CONFLICT");cases.Add("NATIVE_PERSISTED_JOURNAL_BINDING_REJECTED_BEFORE_RETURN");
    foreach(bool olderFirst in new[]{true,false}){
      var entries=new List<Dictionary<string,object>>{before,opened,complete};
      var second=new Dictionary<string,object>(before);second["generation"]=2;entries.Add(second);
      var secondOpen=new Dictionary<string,object>(second);secondOpen["phase"]="BEFORE_OPEN";secondOpen["authSessionId"]="22222222-2222-4222-8222-222222222222";secondOpen["capabilityHash"]=new string('b',64);entries.Add(secondOpen);
      var secondComplete=new Dictionary<string,object>(secondOpen);secondComplete["phase"]="COMPLETE";entries.Add(secondComplete);
      var firstClose=new Dictionary<string,object>(complete);firstClose["phase"]="CLOSED";
      var secondClose=new Dictionary<string,object>(secondComplete);secondClose["phase"]="CLOSED";
      entries.Add(olderFirst?firstClose:secondClose);entries.Add(olderFirst?secondClose:firstClose);
      var third=new Dictionary<string,object>(before);third["generation"]=3;entries.Add(third);
      CheckJournalSequence(entries);
      string dir3=Path.Combine(dir,"two-logins-"+(olderFirst?"older-first":"newer-first"));SecureCreate(dir3,null,true);int f3=0;
      foreach(var e in entries)SecureCreate(Path.Combine(dir3,"journal-"+(++f3).ToString("D4")+".json"),Encoding.UTF8.GetBytes(Json.Serialize(e)),false);
      string[] names;Require(ReadJournalEntriesAt(dir3,out names).Count==9,"HISTORICAL_CLOSE_PERSISTED");
      entries.Add(firstClose);bool duplicate=false;try{CheckJournalSequence(entries);}catch(IOException){duplicate=true;}Require(duplicate,"HISTORICAL_CLOSE_DUPLICATE");
      cases.Add("NATIVE_TWO_LOGINS_"+(olderFirst?"OLDER_FIRST":"NEWER_FIRST")+"_PERSISTED_CLOSE_AND_HIGH_WATER");
    }
    using(var lease=new PrivateRootLease(dir,"read-snapshot",root,true)){
      byte[] configBytes=Encoding.UTF8.GetBytes(Json.Serialize(new{ownerUserId=SelectedOwner,fixture=false}));
      string serverTime=DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"),endTime=DateTimeOffset.UtcNow.AddMinutes(10).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
      byte[] expectedBytes=Encoding.UTF8.GetBytes(Json.Serialize(new{ownerUserId=SelectedOwner,fixture=false,activationDecisionSha256=new string('d',64)}));
      byte[] proofBytes=Encoding.UTF8.GetBytes(Json.Serialize(new{ownerUserId=SelectedOwner,fixture=false,activationDecisionSha256=new string('d',64),expiresAt=endTime}));
      var launch=new{launchEffect="11111111-1111-4111-8111-111111111111",ownerUserId=SelectedOwner,decisionSha256=new string('d',64),serverTime=serverTime,expiresAt=endTime,requestQpc=Stopwatch.GetTimestamp().ToString(),frequency=Stopwatch.Frequency.ToString(),proofSha256=Digest(proofBytes),configSha256=Digest(configBytes),operatorPid=1,operatorCreated="1",operatorImage=Node,setupStartQpc="1",setupDeadlineQpc="2"};
      SecureCreate(Path.Combine(lease.PathName,"launch-consumed.json"),Encoding.UTF8.GetBytes(Json.Serialize(launch)),false);
      SecureCreate(Path.Combine(lease.PathName,"activation-expected.json"),expectedBytes,false);SecureCreate(Path.Combine(lease.PathName,"activation-proof.json"),proofBytes,false);
      string configPath=Path.Combine(lease.PathName,"admin-server.json");SecureCreate(configPath,configBytes,false);
      using(var snapshot=new PrivateSnapshot(lease.PathName,LeaseLeaves)){
        long observed;Require(ActualRemaining(snapshot,out observed)>0,"SNAPSHOT_POSITIVE");
        bool writeDenied=false,replaceDenied=false;try{File.WriteAllText(configPath,"SYNTHETIC_CHANGED_AFTER_VALIDATION");}catch(IOException){writeDenied=true;}
        try{File.Move(configPath,configPath+"-old");}catch(IOException){replaceDenied=true;}
        Require(writeDenied&&replaceDenied&&snapshot.Bytes["admin-server.json"].SequenceEqual(configBytes),"VALIDATED_DELIVERY_SNAPSHOT");
      }
      File.WriteAllText(configPath,Json.Serialize(new{ownerUserId=SelectedOwner,fixture=false,changed=true}));
      bool changedDenied=false;using(var snapshot=new PrivateSnapshot(lease.PathName,LeaseLeaves)){try{long observed;ActualRemaining(snapshot,out observed);}catch(IOException){changedDenied=true;}}
      Require(changedDenied,"CHANGED_CONFIG_DIGEST_REJECTED");File.WriteAllBytes(configPath,configBytes);
      using(var snapshot=new PrivateSnapshot(lease.PathName,LeaseLeaves)){long observed;Require(ActualRemaining(snapshot,out observed)>0,"RESTORED_SNAPSHOT_POSITIVE");}
      cases.Add("NATIVE_VALIDATION_TO_DELIVERY_WRITES_REPLACEMENTS_DENIED_SAME_SNAPSHOT");cases.Add("NATIVE_CHANGED_CONFIG_DIGEST_REJECTED_RESTORED_POSITIVE");
    }

    foreach(string scenario in new[]{"positive","replacement","partial","missing-receipt"}){
      using(var lease=new PrivateRootLease(dir,"cleanup-"+scenario,root,true)){
        string decision=new string('c',64);
        foreach(string leaf in SecretLeaves){var created=SecureCreate(Path.Combine(lease.PathName,leaf),bytes,false);if(scenario!="missing-receipt"||leaf!="activation-expected.json")RecordCreationAt(lease.PathName,lease.RootId,root,decision,leaf,created);}
        if(scenario=="replacement"){string expected=Path.Combine(lease.PathName,"activation-expected.json");File.Delete(expected);SecureCreate(expected,Encoding.UTF8.GetBytes("SYNTHETIC_REPLACEMENT"),false);}
        var cleanup=DeleteCreatedAt(lease.PathName,lease.RootId,root,decision,scenario=="partial"?1:-1);
        if(scenario=="positive")Require(cleanup.status=="PASS"&&cleanup.allVerified&&cleanup.allDeleted&&cleanup.files.All(x=>x.disposition=="DELETED"),"CLEANUP_POSITIVE_FIXTURE");
        else if(scenario=="partial")Require(cleanup.status=="HOLD"&&cleanup.anyDeletionAttempted&&!cleanup.allDeleted&&cleanup.files[0].disposition=="DELETED"&&cleanup.files.Skip(1).All(x=>x.disposition=="NOT_ATTEMPTED")&&!File.Exists(Path.Combine(lease.PathName,SecretLeaves[0]))&&SecretLeaves.Skip(1).All(x=>File.Exists(Path.Combine(lease.PathName,x))),"CLEANUP_PARTIAL_FIXTURE");
        else Require(cleanup.status=="HOLD"&&!cleanup.anyDeletionAttempted&&!cleanup.allVerified&&cleanup.files.All(x=>x.disposition=="NOT_ATTEMPTED")&&SecretLeaves.All(x=>File.Exists(Path.Combine(lease.PathName,x))),"CLEANUP_PREVALIDATION_FIXTURE");
        cases.Add("CREATION_BOUND_CLEANUP_"+scenario.ToUpperInvariant().Replace('-','_'));
      }
    }
    var origin=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(OperatorIdentity(new Dictionary<string,object>())));
    var bound=new Dictionary<string,object>{{"operatorPid",origin["pid"]},{"operatorCreated",origin["created"]},{"operatorImage",origin["image"]}};
    IntPtr fixtureOriginHandle=OpenBoundOperator(bound,true);CloseHandle(fixtureOriginHandle);cases.Add("ORIGINAL_OPERATOR_LIVE_PARENT_IMAGE_CREATION_BOUND");
    var wrongCreation=new Dictionary<string,object>(bound);wrongCreation["operatorCreated"]="0";bool creationDenied=false;try{IntPtr h=OpenBoundOperator(wrongCreation,true);CloseHandle(h);}catch(IOException){creationDenied=true;}Require(creationDenied,"OPERATOR_CREATION_FIXTURE");
    var wrongParent=new Dictionary<string,object>(bound);wrongParent["operatorPid"]=Process.GetCurrentProcess().Id;bool parentDenied=false;try{IntPtr h=OpenBoundOperator(wrongParent,true);CloseHandle(h);}catch(IOException){parentDenied=true;}Require(parentDenied,"OPERATOR_PARENT_FIXTURE");cases.Add("OPERATOR_WRONG_CREATION_OR_IMMEDIATE_PARENT_REJECTED");
    long nativeStart=Stopwatch.GetTimestamp();var setup=new Dictionary<string,object>{{"setupStartQpc",nativeStart.ToString()},{"setupDeadlineQpc",checked(nativeStart+Stopwatch.Frequency*300L).ToString()}};RequireSetupDeadline(setup);
    setup["setupStartQpc"]=(nativeStart-Stopwatch.Frequency*301L).ToString();setup["setupDeadlineQpc"]=(nativeStart-Stopwatch.Frequency).ToString();bool expiredSetup=false;try{RequireSetupDeadline(setup);}catch(IOException){expiredSetup=true;}Require(expiredSetup,"NATIVE_SETUP_FIXTURE");cases.Add("NATIVE_SETUP_DEADLINE_POSITIVE_AND_EXPIRED_REJECTED");
    foreach(int n in new[]{1,3,128,299,380,384})Require(ActualLeaf("session-inventory-"+n+"-ack.json"),"INVENTORY_BATCH_LEAF_POSITIVE");
    foreach(string leaf in new[]{"session-inventory-0-ack.json","session-inventory-385-ack.json","session-inventory-01-ack.json","session-inventory-384-extra.json","../session-inventory-1-ack.json"})Require(!ActualLeaf(leaf),"INVENTORY_BATCH_LEAF_REJECTED");cases.Add("BOUNDED_INVENTORY_BATCH_1_TO_384_FIXED_LEAF_NAMES");
    ActualStatusFixture(root,cases);
    return new{status="PASS",mode="FIXTURE",cases=cases.ToArray(),actualBrandRegistered=false,actualKeysRead=0,actualHostStarted=false};
  }
  static readonly string[] SecretLeaves=new[]{"admin-server.json","activation-proof.json","activation-expected.json"};
  const int ActualMaxLoginGenerations=128;
  const int ActualMaxJournalFiles=4*ActualMaxLoginGenerations;
  const int ActualMaxInventoryObservations=3*ActualMaxLoginGenerations;
  static readonly string[] ActualOperationLeaves={"activation-expected.json","activation-proof.json","admin-server.json","decision.json","approval.json","rendered.sql","launch-consumed.json",
    "effect-input-intent.json","effect-auth-intent.json","effect-auth-ack.json","effect-sql-intent.json","effect-sql-ack.json","effect-launch-intent.json","effect-launch-ack.json","effect-host-exit.json","effect-fence-intent.json","effect-fence-ack.json","effect-cleanup.json","effect-hold.json"};
  static readonly string[] ActualInternalLeaves={"actual-owner.json","journal.lock","host-runtime.json","effect-secret-cleanup.json"};
  static int ActualStatusFileLimit {get{return ActualOperationLeaves.Length+ActualInternalLeaves.Length+SecretLeaves.Length
    +ActualMaxJournalFiles+2*(ActualMaxLoginGenerations+ActualMaxInventoryObservations);}}
  static void RecordCreationAt(string dir,string rootId,string sourceRoot,string decisionSha,string leaf,CreatedFile created) {
    Require(SecretLeaves.Contains(leaf)&&created!=null&&System.Text.RegularExpressions.Regex.IsMatch(decisionSha,"^[0-9a-f]{64}$"),"CREATION_RECEIPT_BINDING");
    SecureCreate(Path.Combine(dir,"creation-"+leaf),Encoding.UTF8.GetBytes(Json.Serialize(new{schemaVersion=1,productId="judoju-news",sourceRoot=sourceRoot,ownerSid=WindowsIdentity.GetCurrent().User.Value,rootId=rootId,leaf=leaf,fileIdentity=created.FileIdentity,sha256=created.Sha256,decisionSha256=decisionSha})),false);
  }
  static bool ActualLeaf(string leaf) {
    return ActualOperationLeaves.Contains(leaf)||ActualIndexedReceipt(leaf,"session-cleanup-",ActualMaxLoginGenerations)
      ||ActualIndexedReceipt(leaf,"session-inventory-",ActualMaxInventoryObservations);
  }
  static bool ActualIndexedReceipt(string leaf,string prefix,int maximum) {
    if(!leaf.StartsWith(prefix,StringComparison.Ordinal))return false;
    string suffix=leaf.EndsWith("-intent.json",StringComparison.Ordinal)?"-intent.json":
      leaf.EndsWith("-ack.json",StringComparison.Ordinal)?"-ack.json":null;
    if(suffix==null||leaf.Length<=prefix.Length+suffix.Length)return false;
    string index=leaf.Substring(prefix.Length,leaf.Length-prefix.Length-suffix.Length);
    int n;
    return int.TryParse(index,System.Globalization.NumberStyles.None,System.Globalization.CultureInfo.InvariantCulture,out n)
      &&n>0&&n<=maximum&&index==n.ToString(System.Globalization.CultureInfo.InvariantCulture);
  }
  static object ActualFile(Dictionary<string,object> p,bool write) {
    string leaf=Text(p,"leaf");Require(ActualLeaf(leaf),"ACTUAL_FIXED_FILE");
    Require(p.Count==(write?2:1),"ACTUAL_FILE_ARGUMENTS");string dir=ActualRoot(false);
    using(var parents=new Held(HoldParents(dir))){
      if(write){byte[] bytes=Convert.FromBase64String(Text(p,"bytes"));Require(bytes.Length>0&&bytes.Length<=524288,"ACTUAL_SIZE");new UTF8Encoding(false,true).GetString(bytes);var created=SecureCreate(Path.Combine(dir,leaf),bytes,false);if(SecretLeaves.Contains(leaf))RecordCreationAt(dir,OperationRootLease.RootId,Root,Digest(PrivateRead(Path.Combine(dir,"decision.json"),65536)),leaf,created);return new{status="PASS",leaf=leaf,sha256=created.Sha256,fileIdentity=created.FileIdentity,rootId=OperationRootLease.RootId,flushed=true};}
      return new{status="PASS",bytes=Convert.ToBase64String(PrivateRead(Path.Combine(dir,leaf),524288))};
    }
  }
  static void CheckJournalEntry(Dictionary<string,object> entry) {
    Require(entry!=null&&entry.Count==5&&entry.Keys.All(k=>new[]{"generation","phase","ownerUserId","authSessionId","capabilityHash"}.Contains(k)),"JOURNAL_SCHEMA");
    string phase=Text(entry,"phase");Require(Text(entry,"ownerUserId")==SelectedOwner&&new[]{"BEFORE_AUTH","BEFORE_OPEN","COMPLETE","RESIDUAL","CLOSED"}.Contains(phase),"JOURNAL_OWNER");
    Require(entry["generation"] is int&&(int)entry["generation"]>=1&&(int)entry["generation"]<=ActualMaxLoginGenerations,"LOGIN_GENERATION");
    Require(entry["authSessionId"]==null||entry["authSessionId"] is string&&System.Text.RegularExpressions.Regex.IsMatch((string)entry["authSessionId"],"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),"JOURNAL_AUTH_SESSION");
    Require(entry["capabilityHash"]==null||entry["capabilityHash"] is string&&System.Text.RegularExpressions.Regex.IsMatch((string)entry["capabilityHash"],"^[0-9a-f]{64}$"),"JOURNAL_HASH");
    Require(phase!="BEFORE_AUTH"||entry["authSessionId"]==null&&entry["capabilityHash"]==null,"JOURNAL_FIRST_IDENTITY");
    Require(!new[]{"BEFORE_OPEN","COMPLETE","CLOSED"}.Contains(phase)||entry["authSessionId"]!=null&&entry["capabilityHash"]!=null,"JOURNAL_KNOWN_IDENTITY");
  }
  static void CheckJournalSequence(List<Dictionary<string,object>> entries) {
    Require(entries.Count<=ActualMaxJournalFiles,"JOURNAL_CAPACITY");var verified=new List<Dictionary<string,object>>();
    foreach(var entry in entries){
      CheckJournalEntry(entry);int generation=(int)entry["generation"];string phase=Text(entry,"phase");
      int latest=verified.Count==0?0:verified.Max(x=>(int)x["generation"]);
      var same=verified.Where(x=>(int)x["generation"]==generation).ToArray();var last=same.LastOrDefault();
      Require(!same.Any(x=>Text(x,"phase")==phase),"JOURNAL_DUPLICATE_PHASE");
      var latestEntry=verified.LastOrDefault(x=>(int)x["generation"]==latest);
      if(phase=="BEFORE_AUTH")Require(generation==latest+1&&(latestEntry==null||new[]{"COMPLETE","RESIDUAL","CLOSED"}.Contains(Text(latestEntry,"phase"))),"JOURNAL_SEQUENCE");
      else {
        Require(last!=null&&(generation==latest||phase=="CLOSED"),"JOURNAL_SEQUENCE");string previous=Text(last,"phase");
        Require(phase=="BEFORE_OPEN"&&previous=="BEFORE_AUTH"||phase=="COMPLETE"&&previous=="BEFORE_OPEN"||phase=="RESIDUAL"&&new[]{"BEFORE_AUTH","BEFORE_OPEN"}.Contains(previous)||phase=="CLOSED"&&new[]{"COMPLETE","RESIDUAL"}.Contains(previous),"JOURNAL_SEQUENCE");
      }
      foreach(string field in new[]{"authSessionId","capabilityHash"}){var known=same.FirstOrDefault(x=>x[field]!=null);Require(phase!="CLOSED"||known!=null,"JOURNAL_BINDING_CONFLICT");if(known!=null)Require(Object.Equals(known[field],entry[field]),"JOURNAL_BINDING_CONFLICT");}
      verified.Add(entry);
    }
  }
  static List<Dictionary<string,object>> ReadJournalEntriesAt(string dir,out string[] files){List<byte[]> ignored;return ReadJournalEntriesAt(dir,out files,out ignored);}
  static List<Dictionary<string,object>> ReadJournalEntriesAt(string dir,out string[] files,out List<byte[]> rawFrames) {
    files=Directory.GetFiles(dir,"journal-*.json").OrderBy(x=>x,StringComparer.Ordinal).ToArray();Require(files.Length<=ActualMaxJournalFiles,"JOURNAL_CAPACITY");var entries=new List<Dictionary<string,object>>();rawFrames=new List<byte[]>();
    for(int n=0;n<files.Length;n++){Require(Path.GetFileName(files[n])=="journal-"+(n+1).ToString("D4")+".json","JOURNAL_GAP");byte[] bytes=PrivateRead(files[n],65536);rawFrames.Add(bytes);entries.Add(Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes)));}
    CheckJournalSequence(entries);return entries;
  }
  static object ActualJournal(Dictionary<string,object> p) {
    Require(p.Count==3,"JOURNAL_ARGUMENTS");int generation=Convert.ToInt32(p["generation"]);Require(generation>=1&&generation<=ActualMaxJournalFiles,"JOURNAL_CAPACITY");
    string previous=Text(p,"previousSha256"),dir=ActualRoot(false);byte[] bytes=Convert.FromBase64String(Text(p,"bytes"));Require(bytes.Length>0&&bytes.Length<=65536,"JOURNAL_SIZE");
    var entry=Json.Deserialize<Dictionary<string,object>>(new UTF8Encoding(false,true).GetString(bytes));CheckJournalEntry(entry);
    using(var parents=new Held(HoldParents(dir)))using(var journalLock=new FileStream(Path.Combine(dir,"journal.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)){
      string[] old;var entries=ReadJournalEntriesAt(dir,out old);Require(old.Length==generation-1,"JOURNAL_CAS");
      Require(previous==(old.Length==0?new string('0',64):Digest(PrivateRead(old[old.Length-1],65536))),"JOURNAL_PREVIOUS");
      entries.Add(entry);CheckJournalSequence(entries);
      string leaf="journal-"+generation.ToString("D4")+".json";SecureCreate(Path.Combine(dir,leaf),bytes,false);
      return new{status="PASS",generation=generation,sha256=Digest(bytes),flushed=true};
    }
  }
  static Dictionary<string,object> ActualJson(string leaf) { return Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(PrivateRead(Path.Combine(ActualRoot(false),leaf),524288))); }
  static object ReadActualJournal(Dictionary<string,object> p) {
    Require(p.Count==0,"JOURNAL_READ_ARGUMENTS");string dir=ActualRoot(false);var frames=new List<object>();
    using(var held=new Held(HoldParents(dir))){string[] files;List<byte[]> rawFrames;ReadJournalEntriesAt(dir,out files,out rawFrames);foreach(byte[] bytes in rawFrames)frames.Add(new{bytes=Convert.ToBase64String(bytes),sha256=Digest(bytes)});}
    return new{status="PASS",frames=frames};
  }
  static string[] ActualStatusNames(string dir) {
    // Report unexpected names too, so an unexpected file still blocks the exact pre-apply inventory.
    string[] names=Directory.EnumerateFiles(dir).Take(ActualStatusFileLimit+1).Select(Path.GetFileName).ToArray();
    Require(names.Length<=ActualStatusFileLimit,"STATUS_CAPACITY");
    Array.Sort(names,StringComparer.Ordinal);return names;
  }
  static object ActualStatus(Dictionary<string,object> p) {
    Require(p.Count==0,"STATUS_ARGUMENTS");return new{status="PASS",files=ActualStatusNames(ActualRoot(false))};
  }
  static void ActualStatusFixture(string root,List<string> cases) {
    using(var fixture=new PrivateRootLease(root,"status-capacity",root,true)){
      string dir=fixture.PathName;
      var cleanup=Enumerable.Range(1,ActualMaxLoginGenerations).SelectMany(n=>new[]{"session-cleanup-"+n+"-intent.json","session-cleanup-"+n+"-ack.json"});
      var inventory=Enumerable.Range(1,ActualMaxInventoryObservations).SelectMany(n=>new[]{"session-inventory-"+n+"-intent.json","session-inventory-"+n+"-ack.json"});
      var receipts=cleanup.Concat(inventory).ToArray();
      foreach(string name in receipts)Require(ActualLeaf(name),"STATUS_RECEIPT_SUPPORTED");
      var journal=Enumerable.Range(1,ActualMaxJournalFiles).Select(n=>"journal-"+n.ToString("D4")+".json");
      var names=ActualOperationLeaves.Concat(ActualInternalLeaves).Concat(SecretLeaves.Select(n=>"creation-"+n)).Concat(journal).Concat(receipts).ToArray();
      const string lastObservation="session-inventory-384-ack.json";
      foreach(string name in names.Where(n=>n!="actual-owner.json"&&n!="effect-cleanup.json"&&n!=lastObservation))
        File.WriteAllBytes(Path.Combine(dir,name),new byte[0]);
      var interrupted=ActualStatusNames(dir);
      Require(interrupted.Length>1100&&interrupted.Contains("effect-hold.json")&&!interrupted.Contains(lastObservation),"LATE_HOLD_STATUS_CAPACITY");
      cases.Add("LATE_HOLD_FULL_SESSION_INVENTORY_STATUS");
      File.WriteAllBytes(Path.Combine(dir,lastObservation),new byte[0]);
      File.WriteAllBytes(Path.Combine(dir,"effect-cleanup.json"),new byte[0]);
      var maximum=ActualStatusNames(dir);
      Require(maximum.Length==ActualStatusFileLimit&&maximum.SequenceEqual(names.OrderBy(n=>n,StringComparer.Ordinal)),"MAXIMUM_STATUS_CAPACITY");
      File.WriteAllBytes(Path.Combine(dir,"unexpected.json"),new byte[0]);
      bool bounded=false;try{ActualStatusNames(dir);}catch(IOException e){bounded=e.Message=="STATUS_CAPACITY";}
      Require(bounded,"OVERSIZE_STATUS_MUST_HOLD");
      foreach(string name in SecretLeaves.Concat(new[]{"effect-hold.json","unexpected.json"}))File.Delete(Path.Combine(dir,name));
      var completed=ActualStatusNames(dir);
      Require(completed.Length==ActualStatusFileLimit-SecretLeaves.Length-1&&completed.Contains("effect-cleanup.json")
        &&completed.Contains(lastObservation)&&!completed.Intersect(SecretLeaves).Any(),"COMPLETED_CLEANUP_STATUS_CAPACITY");
      cases.Add("FULL_SESSION_CLEANUP_STATUS_CAPACITY");cases.Add("OVERSIZE_STATUS_INVENTORY_REJECTED");
    }
  }
  [StructLayout(LayoutKind.Sequential)] struct Disposition { public int Delete; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetFileInformationByHandle(SafeFileHandle handle,int cls,ref Disposition info,uint size);
  sealed class DeleteTarget:IDisposable {
    public string Leaf;public SafeFileHandle Handle;public FileStream Stream;
    public void Dispose(){if(Stream!=null){Stream.Dispose();Stream=null;}if(Handle!=null){Handle.Dispose();Handle=null;}}
  }
  sealed class FileDisposition {public string leaf;public string disposition="NOT_ATTEMPTED";}
  sealed class SecretCleanupResult {
    public int schemaVersion=1;public string ownerUserId=SelectedOwner,rootId,decisionSha256;
    public string status="HOLD",reason="NOT_COMPLETE";public bool allVerified=false,anyDeletionAttempted=false,allDeleted=false,auditRetained=true;
    public FileDisposition[] files=SecretLeaves.Select(leaf=>new FileDisposition{leaf=leaf}).ToArray();
  }
  static SecretCleanupResult DeleteCreatedAt(string dir,string rootId,string sourceRoot,string decisionSha,int failAfter) {
    var result=new SecretCleanupResult{rootId=rootId,decisionSha256=decisionSha};var targets=new List<DeleteTarget>();
    try {
      foreach(string leaf in SecretLeaves){
        var receipt=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(PrivateRead(Path.Combine(dir,"creation-"+leaf),8192)));
        Require(receipt.Count==9&&receipt.Keys.All(k=>new[]{"schemaVersion","productId","sourceRoot","ownerSid","rootId","leaf","fileIdentity","sha256","decisionSha256"}.Contains(k))
          &&receipt["schemaVersion"] is int&&(int)receipt["schemaVersion"]==1&&Text(receipt,"productId")=="judoju-news"
          &&Text(receipt,"sourceRoot")==sourceRoot&&Text(receipt,"ownerSid")==WindowsIdentity.GetCurrent().User.Value
          &&Text(receipt,"rootId")==rootId&&Text(receipt,"leaf")==leaf&&Text(receipt,"decisionSha256")==decisionSha,"CLEANUP_CREATION_RECEIPT");
        var target=new DeleteTarget{Leaf=leaf};targets.Add(target);
        target.Handle=CreateFile(Path.Combine(dir,leaf),0x80030000,0,IntPtr.Zero,3,0x00200000,IntPtr.Zero);
        FileInfo before=Info(target.Handle);PrivateAcl(target.Handle);Require(before.SizeHigh==0&&before.SizeLow<=65536,"CLEANUP_SIZE");
        target.Stream=new FileStream(target.Handle,FileAccess.Read);byte[] bytes=new byte[before.SizeLow];int count=0,read;
        while(count<bytes.Length&&(read=target.Stream.Read(bytes,count,bytes.Length-count))>0)count+=read;
        Require(count==bytes.Length&&target.Stream.ReadByte()==-1&&Identity(before)==Identity(Info(target.Handle))
          &&Identity(before)==Text(receipt,"fileIdentity")&&Digest(bytes)==Text(receipt,"sha256"),"CLEANUP_CREATION_CHANGED");
      }
      result.allVerified=true;
      for(int i=0;i<targets.Count;i++){
        var target=targets[i];result.anyDeletionAttempted=true;result.files[i].disposition="UNKNOWN";
        var disposition=new Disposition{Delete=1};Require(SetFileInformationByHandle(target.Handle,4,ref disposition,(uint)Marshal.SizeOf(typeof(Disposition))),"OWNED_DISPOSITION");
        target.Dispose();uint attrs=GetFileAttributes(Path.Combine(dir,target.Leaf));int error=Marshal.GetLastWin32Error();Require(attrs==INVALID&&error==2,"CLEANUP_ABSENCE_UNKNOWN");
        result.files[i].disposition="DELETED";
        if(failAfter==i+1)throw new IOException("FIXTURE_CLEANUP_INTERRUPTED");
      }
      result.allDeleted=true;result.status="PASS";result.reason="ACKNOWLEDGED";
    }catch(IOException error){result.reason=System.Text.RegularExpressions.Regex.IsMatch(error.Message,"^[A-Z_]{3,80}$")?error.Message:"CLEANUP_UNCONFIRMED";}
    catch{result.reason="CLEANUP_UNCONFIRMED";}
    finally{foreach(var target in targets)try{target.Dispose();}catch{result.status="HOLD";result.reason="CLEANUP_HANDLE_CLOSE_UNCONFIRMED";result.allDeleted=false;}}
    return result;
  }
  static object DeleteActualSecrets(Dictionary<string,object> p) {
    Require(p.Count==0,"CLEANUP_ARGUMENTS");string dir=ActualRoot(false);Dictionary<string,object> fence=ActualJson("effect-fence-ack.json"),launch=ActualJson("launch-consumed.json");
    Require(Text(fence,"decisionSha256")==Text(launch,"decisionSha256")&&Text(fence,"ownerUserId")==SelectedOwner&&Text(fence,"observedOutcome")=="ACKNOWLEDGED","FENCE_REQUIRED");
    string jobName="Local\\JudojuAdminC2-"+Text(launch,"launchEffect");IntPtr job=OpenJobObject(4,false,jobName);if(job!=IntPtr.Zero){CloseHandle(job);throw new IOException("JOB_STILL_LIVE");}Require(Marshal.GetLastWin32Error()==2,"JOB_STATE_UNKNOWN");
    Require(!System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(x=>x.Port==62333&&(x.Address.Equals(System.Net.IPAddress.Parse("127.0.0.2"))||x.Address.Equals(System.Net.IPAddress.Any))),"PORT_STILL_LIVE");
    var result=DeleteCreatedAt(dir,OperationRootLease.RootId,Root,Text(launch,"decisionSha256"),-1);
    try{SecureCreate(Path.Combine(dir,"effect-secret-cleanup.json"),Encoding.UTF8.GetBytes(Json.Serialize(result)),false);}
    catch{result.status="HOLD";result.reason="CLEANUP_AUDIT_UNCONFIRMED";result.auditRetained=false;}
    return result;
  }
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry {
    public uint Size,Usage,Pid;public UIntPtr Heap;public uint Module,Threads,ParentPid;public int Priority;public uint Flags;
    [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string Exe;
  }
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32First(IntPtr snapshot,ref ProcessEntry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool Process32Next(IntPtr snapshot,ref ProcessEntry entry);
  static int ParentPid() {
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0);Require(snapshot!=IntPtr.Zero&&snapshot!=new IntPtr(-1),"PARENT_SNAPSHOT");
    try{var entry=new ProcessEntry{Size=(uint)Marshal.SizeOf(typeof(ProcessEntry))};bool next=Process32First(snapshot,ref entry);int current=Process.GetCurrentProcess().Id;
      while(next){if(entry.Pid==(uint)current){Require(entry.ParentPid>0&&entry.ParentPid<=Int32.MaxValue,"PARENT_PID");return (int)entry.ParentPid;}next=Process32Next(snapshot,ref entry);}throw new IOException("PARENT_NOT_OBSERVED");
    }finally{CloseHandle(snapshot);}
  }
  static IntPtr OpenBoundOperator(Dictionary<string,object> receipt,bool immediateParent) {
    Require(receipt["operatorPid"] is int&&(int)receipt["operatorPid"]>0&&Text(receipt,"operatorImage")==Node,"OPERATOR_BINDING");int pid=(int)receipt["operatorPid"];
    if(immediateParent)Require(ParentPid()==pid,"ORIGINAL_OPERATOR_PARENT_REQUIRED");
    IntPtr handle=OpenProcess(SYNCHRONIZE|QUERY,false,pid);
    try{long creation=0,exit=0,kernel=0,user=0;Require(handle!=IntPtr.Zero&&WaitForSingleObject(handle,0)==258&&GetProcessTimes(handle,out creation,out exit,out kernel,out user)&&creation.ToString()==Text(receipt,"operatorCreated"),"ORIGINAL_OPERATOR_LIVE_REQUIRED");
      var image=new StringBuilder(32768);int size=image.Capacity;Require(QueryFullProcessImageName(handle,0,image,ref size)&&image.ToString().Equals(Node,StringComparison.OrdinalIgnoreCase),"ORIGINAL_OPERATOR_IMAGE");return handle;
    }catch{if(handle!=IntPtr.Zero)CloseHandle(handle);throw;}
  }
  static object OperatorIdentity(Dictionary<string,object> p) {
    Require(p.Count==0,"OPERATOR_IDENTITY_ARGUMENTS");int pid=ParentPid();IntPtr handle=OpenProcess(SYNCHRONIZE|QUERY,false,pid);
    try{long creation=0,exit=0,kernel=0,user=0;Require(handle!=IntPtr.Zero&&WaitForSingleObject(handle,0)==258&&GetProcessTimes(handle,out creation,out exit,out kernel,out user),"OPERATOR_IDENTITY_LIVE");
      var image=new StringBuilder(32768);int size=image.Capacity;Require(QueryFullProcessImageName(handle,0,image,ref size)&&image.ToString().Equals(Node,StringComparison.OrdinalIgnoreCase),"OPERATOR_IDENTITY_IMAGE");
      return new{status="PASS",pid=pid,created=creation.ToString(),image=Node,qpc=Stopwatch.GetTimestamp().ToString(),frequency=Stopwatch.Frequency.ToString()};
    }finally{if(handle!=IntPtr.Zero)CloseHandle(handle);}
  }
  static void RequireSetupDeadline(Dictionary<string,object> launch) {
    long start=Int64.Parse(Text(launch,"setupStartQpc")),end=Int64.Parse(Text(launch,"setupDeadlineQpc")),now=Stopwatch.GetTimestamp();
    Require(start>=0&&end-start==checked(Stopwatch.Frequency*300L)&&now>=start&&now<end,"NATIVE_SETUP_EXHAUSTED");
  }
  static readonly string[] LeaseLeaves=new[]{"launch-consumed.json","activation-expected.json","activation-proof.json","admin-server.json"};
  static long ActualRemaining(PrivateSnapshot snapshot,out long now) {
    var l=snapshot.Object("launch-consumed.json");Require(l.Count==14&&l.Keys.All(k=>new[]{"launchEffect","ownerUserId","decisionSha256","serverTime","expiresAt","requestQpc","frequency","proofSha256","configSha256","operatorPid","operatorCreated","operatorImage","setupStartQpc","setupDeadlineQpc"}.Contains(k)),"LAUNCH_SCHEMA");
    Require(Text(l,"ownerUserId")==SelectedOwner&&System.Text.RegularExpressions.Regex.IsMatch(Text(l,"launchEffect"),"^[0-9a-f-]{36}$"),"LAUNCH_OWNER");
    long start=Int64.Parse(Text(l,"requestQpc")),frequency=Int64.Parse(Text(l,"frequency")),current=Stopwatch.GetTimestamp();
    Require(frequency==Stopwatch.Frequency&&start>=0&&current>=start,"MONOTONIC_UNKNOWN");
    var server=DateTimeOffset.ParseExact(Text(l,"serverTime"),"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.AssumeUniversal);
    var expires=DateTimeOffset.ParseExact(Text(l,"expiresAt"),"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.AssumeUniversal);
    Require(expires>server&&(expires-server).TotalMilliseconds<=1800000,"SERVER_LEASE");
    now=server.ToUnixTimeMilliseconds()+(long)Math.Ceiling((current-start)*1000.0/frequency);
    long remaining=expires.ToUnixTimeMilliseconds()-now;Require(remaining>0&&remaining<=1800000,"LEASE_EXPIRED");
    Dictionary<string,object> expected=snapshot.Object("activation-expected.json"),proof=snapshot.Object("activation-proof.json"),config=snapshot.Object("admin-server.json");
    Require(Text(expected,"ownerUserId")==SelectedOwner&&Text(proof,"ownerUserId")==SelectedOwner&&Text(config,"ownerUserId")==SelectedOwner,"SELECTED_OWNER");
    Require(!(bool)proof["fixture"]&&!(bool)config["fixture"]&&!(bool)expected["fixture"],"ACTUAL_ONLY");
    Require(Text(l,"decisionSha256")==Text(expected,"activationDecisionSha256")&&Text(proof,"activationDecisionSha256")==Text(l,"decisionSha256"),"LEASE_DECISION");
    Require(Text(l,"proofSha256")==Digest(snapshot.Bytes["activation-proof.json"])&&Text(l,"configSha256")==Digest(snapshot.Bytes["admin-server.json"]),"LEASE_BYTES");
    var proofEnd=DateTimeOffset.ParseExact(Text(proof,"expiresAt"),"yyyy-MM-dd'T'HH:mm:ss.fff'Z'",System.Globalization.CultureInfo.InvariantCulture,System.Globalization.DateTimeStyles.AssumeUniversal);
    Require(expires<=proofEnd,"PROOF_LEASE");return remaining;
  }
  static object ActualRead(Dictionary<string,object> p) {
    Require(p.Count==0,"ACTUAL_READ_ARGUMENTS");string dir=ActualRoot(false);
    using(var parents=new Held(HoldParents(dir)))using(var snapshot=new PrivateSnapshot(dir,LeaseLeaves.Concat(new[]{"host-runtime.json","decision.json","approval.json","rendered.sql"}).ToArray())){
      var h=snapshot.Object("host-runtime.json");Require(h.Count==5,"HOST_SCHEMA");
      var l=snapshot.Object("launch-consumed.json");string effect=Text(l,"launchEffect"),jobName="Local\\JudojuAdminC2-"+effect;
      Require(Text(h,"jobName")==jobName&&Text(h,"launchEffect")==effect&&Text(h,"launchSha256")==Digest(snapshot.Bytes["launch-consumed.json"]),"HOST_BINDING");
      IntPtr job=OpenJobObject(4,false,jobName),owner=IntPtr.Zero,originalOperator=IntPtr.Zero;
      try {
        originalOperator=OpenBoundOperator(l,false);Require(job!=IntPtr.Zero,"LIVE_JOB_REQUIRED");bool belongs;Require(IsProcessInJob(Process.GetCurrentProcess().Handle,job,out belongs)&&belongs,"CURRENT_PROCESS_JOB");
        int ownerPid=Convert.ToInt32(h["ownerPid"]);owner=OpenProcess(SYNCHRONIZE|QUERY,false,ownerPid);long creation,exit,kernel,user;
        Require(owner!=IntPtr.Zero&&WaitForSingleObject(owner,0)==258&&GetProcessTimes(owner,out creation,out exit,out kernel,out user)&&creation.ToString()==Text(h,"ownerCreated"),"LIVE_OWNER_REQUIRED");
        long now;long remaining=ActualRemaining(snapshot,out now);var files=new Dictionary<string,string>();
        foreach(string leaf in LeaseLeaves.Concat(new[]{"decision.json","approval.json","rendered.sql"}))files[leaf]=Convert.ToBase64String(snapshot.Bytes[leaf]);
        return new{status="PASS",files=files,authoritativeNow=now,remainingMs=remaining,launchEffect=effect,ownerPid=ownerPid,ownerCreated=Text(h,"ownerCreated")};
      }finally{if(originalOperator!=IntPtr.Zero)CloseHandle(originalOperator);if(owner!=IntPtr.Zero)CloseHandle(owner);if(job!=IntPtr.Zero)CloseHandle(job);}
    }
  }
  static IntPtr PrivateJob(string name) {
    IntPtr sd=IntPtr.Zero,sa=IntPtr.Zero;uint size;
    try {
      string sid=WindowsIdentity.GetCurrent().User.Value;
      Require(ConvertStringSecurityDescriptorToSecurityDescriptor("O:"+sid+"D:P(A;;GA;;;"+sid+")(A;;GA;;;SY)(A;;GA;;;BA)",1,out sd,out size),"JOB_DESCRIPTOR");
      var security=new Security{Length=Marshal.SizeOf(typeof(Security)),Descriptor=sd,Inherit=0};sa=Marshal.AllocHGlobal(security.Length);Marshal.StructureToPtr(security,sa,false);
      IntPtr job=CreateJobObject(sa,name);int error=Marshal.GetLastWin32Error();if(job==IntPtr.Zero||error==183){if(job!=IntPtr.Zero)CloseHandle(job);throw new IOException("EXCLUSIVE_JOB_REQUIRED");}return job;
    }finally{if(sa!=IntPtr.Zero)Marshal.FreeHGlobal(sa);if(sd!=IntPtr.Zero)LocalFree(sd);}
  }
  static void Require(bool value,string reason) { if(!value) throw new IOException(reason); }
  static string Text(Dictionary<string,object> p,string name) { object value; Require(p.TryGetValue(name,out value)&&value is string,"FIELD_"+name); return (string)value; }
  static void Emit(object value) { Console.Out.WriteLine(Json.Serialize(value)); Console.Out.Flush(); }
  static string Full(string p) { Require(Path.IsPathRooted(p),"ABSOLUTE_PATH"); return Path.GetFullPath(p).TrimEnd(Path.DirectorySeparatorChar); }
  static void Components(string p,bool missingLeaf) {
    string f=Full(p),drive=Path.GetPathRoot(f),at=drive;
    string[] parts=f.Substring(drive.Length).Split(new char[]{Path.DirectorySeparatorChar},StringSplitOptions.RemoveEmptyEntries);
    for(int i=0;i<parts.Length;i++) {
      at=Path.Combine(at,parts[i]); uint attrs=GetFileAttributes(at);
      if(attrs==INVALID) { int error=Marshal.GetLastWin32Error(); Require(missingLeaf&&i==parts.Length-1&&(error==2||error==3),"PATH_UNKNOWN"); return; }
      Require((attrs&REPARSE)==0,"REPARSE_POINT"); if(i<parts.Length-1)Require((attrs&DIRECTORY)!=0,"PARENT_NOT_DIRECTORY");
    }
  }
  static object Inspect(string p) {
    Components(p,true); uint attr=GetFileAttributes(p);
    if(attr==INVALID) { int e=Marshal.GetLastWin32Error(); Require(e==2||e==3,"METADATA_UNKNOWN");return new {path=p,exists=false}; }
    return new {path=p,exists=true,attributes=attr};
  }
  static void FixtureRoot(string p) {
    string f=Full(p),r=Full(Root);Require(!f.Equals(r,StringComparison.OrdinalIgnoreCase)&&!f.StartsWith(r+"\\",StringComparison.OrdinalIgnoreCase)&&!r.StartsWith(f+"\\",StringComparison.OrdinalIgnoreCase),"ACTUAL_ROOT");
    Components(f,false);Require(Directory.Exists(f),"FIXTURE_ROOT");
  }
  static string DirectoryIdentity(string dir) {
    Components(dir,false);
    using(SafeFileHandle h=CreateFile(dir,0x80,7,IntPtr.Zero,3,0x02000000|0x00200000,IntPtr.Zero)) {
      FileInfo i=new FileInfo();Require(!h.IsInvalid&&GetFileInformationByHandle(h,out i)&&(i.Attributes&DIRECTORY)!=0&&(i.Attributes&REPARSE)==0,"DIRECTORY_IDENTITY");
      return i.Volume+":"+i.IndexHigh+":"+i.IndexLow+":"+i.Creation.dwHighDateTime+":"+i.Creation.dwLowDateTime;
    }
  }
  static string KnownFixtureBase(bool create) {
    // Resolve the current token's known folder, not a caller TEMP/LOCALAPPDATA override.
    Guid localAppData=new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091");IntPtr pointer;
    Require(SHGetKnownFolderPath(ref localAppData,0,IntPtr.Zero,out pointer)==0,"KNOWN_TEMP_PARENT");string local;
    try{local=Marshal.PtrToStringUni(pointer);}finally{Marshal.FreeCoTaskMem(pointer);}
    string parent=Path.Combine(local,"Temp"),dir=Path.Combine(parent,"JudojuNewsAdminC1B");Components(parent,false);
    bool made=false;
    if(create){made=CreateDirectory(dir,IntPtr.Zero);if(!made)Require(Marshal.GetLastWin32Error()==183,"TEMP_BASE_CREATE");}
    Components(dir,false);string id=DirectoryIdentity(dir),sid=WindowsIdentity.GetCurrent().User.Value,marker=Path.Combine(dir,"base-owner.json");
    if(made)WriteBound(marker,Encoding.UTF8.GetBytes(Json.Serialize(new {product="judoju-news",sourceRoot=Root,ownerSid=sid,baseId=id})));
    var owner=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ReadBound(marker,4096)));
    Require(owner.Count==4&&Text(owner,"product")=="judoju-news"&&Text(owner,"sourceRoot")==Root&&Text(owner,"ownerSid")==sid&&Text(owner,"baseId")==id,"TEMP_BASE_OWNER");
    return dir;
  }
  static object CreateFixture(Dictionary<string,object> p) {
    Require(p.Count==0,"FIXED_CREATE_ARGUMENTS");string parent=KnownFixtureBase(true),dir=Path.Combine(parent,"fixture-"+Guid.NewGuid().ToString("N"));Require(CreateDirectory(dir,IntPtr.Zero),"EXCLUSIVE_FIXTURE_ROOT");FixtureRoot(dir);
    string id=DirectoryIdentity(dir),sid=WindowsIdentity.GetCurrent().User.Value;byte[] random=new byte[32];using(RandomNumberGenerator rng=RandomNumberGenerator.Create())rng.GetBytes(random);string nonce=BitConverter.ToString(random).Replace("-","").ToLowerInvariant();
    WriteBound(Path.Combine(dir,"fixture-owner.json"),Encoding.UTF8.GetBytes(Json.Serialize(new {sourceRoot=Root,ownerSid=sid,rootId=id,nonce=nonce})));
    Require(DirectoryIdentity(dir)==id,"FIXTURE_IDENTITY_CHANGED");return new {status="PASS",root=dir,rootId=id,nonce=nonce,createdExclusive=true};
  }
  static string OwnedFixture(Dictionary<string,object> p) {
    string parent=KnownFixtureBase(false),dir=Full(Text(p,"root"));
    Require(String.Equals(Path.GetDirectoryName(dir),parent,StringComparison.OrdinalIgnoreCase)&&System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(dir),"^fixture-[0-9a-f]{32}$"),"OWNED_TEMP_ONLY");
    FixtureRoot(dir);string id=DirectoryIdentity(dir);var owner=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(ReadBound(Path.Combine(dir,"fixture-owner.json"),4096)));
    Require(owner.Count==4&&Text(owner,"sourceRoot")==Root&&Text(owner,"ownerSid")==WindowsIdentity.GetCurrent().User.Value&&Text(owner,"rootId")==id&&Text(p,"rootId")==id&&Text(owner,"nonce")==Text(p,"nonce"),"FIXTURE_OWNER");return dir;
  }
  static string Identity(FileInfo f) { return f.Volume+":"+f.IndexHigh+":"+f.IndexLow+":"+f.SizeHigh+":"+f.SizeLow+":"+f.Write.dwHighDateTime+":"+f.Write.dwLowDateTime; }
  static FileInfo Info(SafeFileHandle h) { FileInfo i=new FileInfo();Require(!h.IsInvalid&&GetFileInformationByHandle(h,out i),"HANDLE_INFO");Require((i.Attributes&(REPARSE|DIRECTORY))==0&&i.Links==1,"REGULAR_SINGLE_LINK");return i; }
  static byte[] ReadBound(string file,int max) {
    Components(file,false);
    using(SafeFileHandle h=CreateFile(file,0x80000000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero)) {
      FileInfo before=Info(h);Require(before.SizeHigh==0&&before.SizeLow<=max,"SIZE_LIMIT");
      using(FileStream stream=new FileStream(h,FileAccess.Read)) {
        byte[] bytes=new byte[(int)before.SizeLow];int n=0,got;while(n<bytes.Length&&(got=stream.Read(bytes,n,bytes.Length-n))>0)n+=got;
        Require(n==bytes.Length&&stream.ReadByte()==-1,"READ_SIZE");
        Require(Identity(before)==Identity(Info(h)),"HANDLE_CHANGED");Components(file,false);
        using(SafeFileHandle reopened=CreateFile(file,0x80000000,1,IntPtr.Zero,3,0x00200000,IntPtr.Zero))Require(Identity(before)==Identity(Info(reopened)),"PATH_IDENTITY_CHANGED");
        return bytes;
      }
    }
  }
  static void WriteBound(string file,byte[] bytes,bool failBeforeFlush=false) {
    Components(Path.GetDirectoryName(file),false);Require(GetFileAttributes(file)==INVALID&&Marshal.GetLastWin32Error()==2,"EXCLUSIVE_TARGET");
    using(FileStream stream=new FileStream(file,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None)) {
      FileInfo before=Info(stream.SafeFileHandle);stream.Write(bytes,0,bytes.Length);if(failBeforeFlush)throw new IOException("FLUSH_INJECTED");stream.Flush(true);FileInfo after=Info(stream.SafeFileHandle);
      Require(before.Volume==after.Volume&&before.IndexHigh==after.IndexHigh&&before.IndexLow==after.IndexLow&&after.SizeHigh==0&&after.SizeLow==bytes.Length,"WRITE_IDENTITY");Components(file,false);
    }
    Require(ReadBound(file,65536).SequenceEqual(bytes),"WRITE_VERIFICATION");
  }
  static object WriteFixture(Dictionary<string,object> p) {
    string root=OwnedFixture(p);string[] existing=Directory.GetFileSystemEntries(root);Require(existing.Length==1&&Path.GetFileName(existing[0])=="fixture-owner.json","FIXTURE_NOT_EMPTY");
    byte[] proof=Convert.FromBase64String(Text(p,"proof")),config=Convert.FromBase64String(Text(p,"config"));Require(proof.Length<=65536&&config.Length<=16384,"SIZE_LIMIT");
    var c=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(config));
    Require(Text(c,"publishableKey")=="FIXTURE_PUBLISHABLE"&&Text(c,"secretKey")=="FIXTURE_SECRET"&&Text(c,"encryptionKey")==new String('d',64)&&(bool)c["fixture"],"SYNTHETIC_ONLY");
    string phase="LOCK";
    using(FileStream ownedLock=new FileStream(Path.Combine(root,"fixture.lock"),FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None)) {
      try {
        WriteBound(Path.Combine(root,"package.json"),Encoding.UTF8.GetBytes("{\"name\":\"@judoju/news\"}"));
        string dir=Path.Combine(root,".local-data","cloud-admin");Directory.CreateDirectory(dir);Components(dir,false);
        phase="PROOF";WriteBound(Path.Combine(dir,"activation-proof.json"),proof,p.ContainsKey("fault")&&Text(p,"fault")=="PROOF_FLUSH");
        if(p.ContainsKey("fault")&&Text(p,"fault")=="AFTER_PROOF")throw new IOException("FIXTURE_INJECTED");
        phase="CONFIG";WriteBound(Path.Combine(dir,"admin-server.json"),config);
        return new {status="PASS",mode="FIXTURE",proofFlushed=true,configFlushed=true,actualKeysRead=0};
      } catch { return new {status="HOLD",reason="PARTIAL_"+phase,filesPreserved=true}; }
    }
  }
  static string Quote(string s) { Require(!s.Contains("\"")&&!s.Contains("\r")&&!s.Contains("\n"),"FIXED_ARGUMENT");return "\""+s+"\""; }
  static Dictionary<string,string> EnvironmentBlock() {
    var d=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    foreach(string k in new[]{"SystemRoot","WINDIR","ComSpec","TEMP","TMP","USERPROFILE","APPDATA","LOCALAPPDATA","ProgramFiles","ProgramFiles(x86)","ProgramData","PATHEXT","PATH","NUMBER_OF_PROCESSORS","PROCESSOR_ARCHITECTURE","OS"}) { string v=Environment.GetEnvironmentVariable(k);if(v!=null)d[k]=v; }
    d["NODE_ENV"]="production";d["CI"]="1";d["EXPO_NO_TELEMETRY"]="1";d["NEXT_TELEMETRY_DISABLED"]="1";d["JUDOJU_ADMIN_PROFILE"]="preview";return d;
  }
  static void Preflight() {
    // Do not spawn an unowned Node/PowerShell preflight before the Job exists.
    // Same native Inspect/Components engine used by the JS environment boundary.
    try {
      foreach(string dir in new[]{Root,Path.Combine(Root,"apps","admin"),Path.Combine(Root,"apps","mobile")}) {
        Components(dir,false);Require((GetFileAttributes(dir)&DIRECTORY)!=0,"ENV_PARENT");
        foreach(string name in new[]{".env",".env.local",".env.production",".env.production.local",".env.development",".env.development.local",".env.test",".env.test.local"}) {
          string file=Path.Combine(dir,name);Inspect(file);uint attr=GetFileAttributes(file);int error=Marshal.GetLastWin32Error();Require(attr==INVALID&&(error==2||error==3),"ENV_PRESENT");
        }
        Components(dir,false);
      }
    } catch { throw new IOException("PREFLIGHT_HOLD"); }
  }
  static string OwnDirectory(string parent,string leaf) {
    Require(leaf==".local-data"||leaf=="admin-c1b","FIXED_DIRECTORY");Components(parent,false);string target=Path.Combine(parent,leaf);uint attr=GetFileAttributes(target);
    if(attr==INVALID){Require(Marshal.GetLastWin32Error()==2,"DIRECTORY_UNKNOWN");Directory.CreateDirectory(target);}
    Components(target,false);Require((GetFileAttributes(target)&DIRECTORY)!=0,"OWN_DIRECTORY");return target;
  }
  static object Supervise(Dictionary<string,object> p) {
    IntPtr consumingOperator=IntPtr.Zero;Dictionary<string,object> consumingLaunch=null;PrivateSnapshot consumingFiles=null;
    try{
    var watch=Stopwatch.StartNew();
    string mode=Text(p,"mode");Require(mode=="Fixture"||mode=="FixtureBrowser"||mode=="Preview"||mode=="Actual","FIXED_MODE");
    string fault=p.ContainsKey("fault")?Text(p,"fault"):"NONE",pause=p.ContainsKey("pause")?Text(p,"pause"):"NONE";
    Require(new[]{"NONE","BeforeCreate","AfterCreate","BeforeResume","HandshakeTimeout","ReaderFailure","ReportFailure"}.Contains(fault),"FIXED_FAULT");Require(new[]{"NONE","BeforeCreate","Suspended","Handshake","Descendant"}.Contains(pause),"FIXED_PAUSE");
    Require(mode!="Preview"&&mode!="Actual"||fault=="NONE"&&pause=="NONE","PREVIEW_FAULT_REJECTED");
    long actualBudget=0,actualNow=0;if(mode=="Actual"){Require(p.Count==1,"ACTUAL_SUPERVISE_ARGUMENTS");consumingFiles=new PrivateSnapshot(ActualRoot(false),LeaseLeaves);actualBudget=ActualRemaining(consumingFiles,out actualNow);consumingLaunch=consumingFiles.Object("launch-consumed.json");consumingOperator=OpenBoundOperator(consumingLaunch,true);RequireSetupDeadline(consumingLaunch);}
    Preflight();if(mode=="Actual"){Require(WaitForSingleObject(consumingOperator,0)==258,"CONSUMING_OPERATOR_EXITED");RequireSetupDeadline(consumingLaunch);}
    string dir=OwnDirectory(OwnDirectory(Root,".local-data"),"admin-c1b");
    Components(Path.Combine(dir,"supervisor.lock"),true);
    IntPtr job=IntPtr.Zero,attrs=IntPtr.Zero,jobs=IntPtr.Zero,handles=IntPtr.Zero,read=IntPtr.Zero,write=IntPtr.Zero,environment=IntPtr.Zero;SafeFileHandle input=null;ProcessInfo child=new ProcessInfo();bool hasChild=false,clean=false,jobClean=false;bool? childExitObserved=null,portClosedObserved=null;string failure=null;StreamReader reader=null;
    // Holding this handle never permits deleting another run's lock after an expiry.
    using(FileStream ownLock=new FileStream(Path.Combine(dir,"supervisor.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) {
      Info(ownLock.SafeFileHandle);Components(Path.Combine(dir,"supervisor.lock"),false);
      try {
        // No listener is killed. The entry also treats EADDRINUSE as a fatal own-run failure.
        var listeners=System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
        portClosedObserved=!listeners.Any(x=>x.Port==62333&&(x.Address.Equals(System.Net.IPAddress.Parse("127.0.0.2"))||x.Address.Equals(System.Net.IPAddress.Any)));
        Require(portClosedObserved==true,"PORT_COLLISION");
        if(mode=="Actual") {
          Require(WaitForSingleObject(consumingOperator,0)==258,"CONSUMING_OPERATOR_EXITED");RequireSetupDeadline(consumingLaunch);
          var launch=consumingLaunch;string effect=Text(launch,"launchEffect"),jobName="Local\\JudojuAdminC2-"+effect;
          job=PrivateJob(jobName);long ownCreation,ownExit,ownKernel,ownUser;
          Require(GetProcessTimes(Process.GetCurrentProcess().Handle,out ownCreation,out ownExit,out ownKernel,out ownUser),"OWNER_CREATION");
          using(var held=new Held(HoldParents(ActualRoot(false))))SecureCreate(Path.Combine(ActualRoot(false),"host-runtime.json"),Encoding.UTF8.GetBytes(Json.Serialize(new{jobName=jobName,ownerPid=Process.GetCurrentProcess().Id,ownerCreated=ownCreation.ToString(),launchEffect=effect,launchSha256=Digest(consumingFiles.Bytes["launch-consumed.json"])})),false);
        } else job=CreateJobObject(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"JOB_CREATE");
        var limit=new ExtendedLimit();limit.Basic.Flags=0x2000;Require(SetInformationJobObject(job,9,ref limit,Marshal.SizeOf(limit)),"KILL_ON_CLOSE");
        Emit(new {eventName="phase",phase="BeforeCreate",pid=Process.GetCurrentProcess().Id});
        if(pause=="BeforeCreate")Thread.Sleep(30000);if(fault=="BeforeCreate")throw new IOException(fault);
        IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);Require(size.ToInt64()>0,"ATTRIBUTE_SIZE");attrs=Marshal.AllocHGlobal(size);Require(InitializeProcThreadAttributeList(attrs,2,0,ref size),"ATTRIBUTE_INIT");
        jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);Require(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x2000d),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"JOB_LIST");
        var sa=new Security {Length=Marshal.SizeOf(typeof(Security)),Inherit=1};Require(CreatePipe(out read,out write,ref sa,0),"PIPE");Require(SetHandleInformation(read,1,0),"PIPE_INHERIT");
        input=CreateFile("NUL",0x80000000,3,IntPtr.Zero,3,0,IntPtr.Zero);Require(!input.IsInvalid,"NUL");Require(SetHandleInformation(input.DangerousGetHandle(),1,1),"STDIN_INHERIT");
        handles=Marshal.AllocHGlobal(2*IntPtr.Size);Marshal.WriteIntPtr(handles,0,write);Marshal.WriteIntPtr(handles,IntPtr.Size,input.DangerousGetHandle());Require(UpdateProcThreadAttribute(attrs,0,new IntPtr(0x20002),handles,new IntPtr(2*IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"HANDLE_LIST");
        var env=EnvironmentBlock();if(fault=="HandshakeTimeout")env["JUDOJU_C1B_FIXTURE_NO_HANDSHAKE"]="1";
        environment=Marshal.StringToHGlobalUni(String.Join("\0",env.OrderBy(x=>x.Key,StringComparer.OrdinalIgnoreCase).Select(x=>x.Key+"="+x.Value))+"\0\0");
        string command=Quote(Node)+" "+Quote(Path.Combine(Root,"scripts","admin-preview-entry.mjs"))+" --mode "+mode;
        var startup=new StartupEx();startup.Startup.cb=Marshal.SizeOf(typeof(StartupEx));startup.Startup.flags=0x100;startup.Startup.input=input.DangerousGetHandle();startup.Startup.output=write;startup.Startup.error=write;startup.Attributes=attrs;
        if(mode=="Actual"){Require(WaitForSingleObject(consumingOperator,0)==258,"CONSUMING_OPERATOR_EXITED");RequireSetupDeadline(consumingLaunch);}
        Require(CreateProcess(Node,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x80000|0x400|4|0x08000000,environment,Root,ref startup,out child),"CREATE_WITH_JOB_LIST");hasChild=true;
        bool member;Require(IsProcessInJob(child.Process,job,out member)&&member,"OWN_JOB_MEMBERSHIP");long created,exit,kernel,user;Require(GetProcessTimes(child.Process,out created,out exit,out kernel,out user),"CREATION_TIME");var image=new StringBuilder(32768);int imageLength=image.Capacity;Require(QueryFullProcessImageName(child.Process,0,image,ref imageLength)&&image.ToString().Equals(Node,StringComparison.OrdinalIgnoreCase),"FIXED_IMAGE");
        Emit(new {eventName="phase",phase="Suspended",pid=child.Pid,created=created.ToString()});
        if(pause=="Suspended")Thread.Sleep(30000);if(fault=="AfterCreate"||fault=="BeforeResume")throw new IOException(fault);
        if(mode=="Actual"){Require(WaitForSingleObject(consumingOperator,0)==258,"CONSUMING_OPERATOR_EXITED");RequireSetupDeadline(consumingLaunch);}
        Require(ResumeThread(child.Thread)!=INVALID,"RESUME");CloseHandle(child.Thread);child.Thread=IntPtr.Zero;CloseHandle(write);write=IntPtr.Zero;
        reader=new StreamReader(new FileStream(new SafeFileHandle(read,true),FileAccess.Read),Encoding.UTF8);read=IntPtr.Zero;
        bool handshake=false,ready=false;Task<string> line=reader.ReadLineAsync();int outputBytes=0;long started=watch.ElapsedMilliseconds;
        while(mode=="Actual"?watch.ElapsedMilliseconds<actualBudget:watch.ElapsedMilliseconds-started<(mode=="Preview"||mode=="FixtureBrowser"?90000:6500)) {
          if(mode=="Actual"){Require(WaitForSingleObject(consumingOperator,0)==258,"CONSUMING_OPERATOR_EXITED");if(!ready)RequireSetupDeadline(consumingLaunch);}
          if(!handshake&&watch.ElapsedMilliseconds-started>5000)throw new IOException("HANDSHAKE_TIMEOUT");
          if(!ready&&watch.ElapsedMilliseconds-started>30000)throw new IOException("START_TIMEOUT");
          if(fault=="ReaderFailure")throw new IOException(fault);
          if(line.Wait(50)) {
            string value=line.Result;if(value==null)throw new IOException("CHILD_OUTPUT_CLOSED");outputBytes+=Encoding.UTF8.GetByteCount(value);Require(outputBytes<=262144,"OUTPUT_LIMIT");
            Dictionary<string,object> item=null;try{item=Json.Deserialize<Dictionary<string,object>>(value);}catch{}
            if(item!=null&&item.ContainsKey("eventName")) {
              string evt=Text(item,"eventName");if(evt=="handshake"){handshake=true;Emit(new {eventName="phase",phase="Handshake",pid=child.Pid,created=created.ToString()});if(pause=="Handshake")Thread.Sleep(30000);}
              if(evt=="ready"){ready=true;Emit(item);}
              if(evt=="descendant"){
                int pid=Convert.ToInt32(item["pid"]);IntPtr handle=OpenProcess(SYNCHRONIZE|QUERY,false,pid);Require(handle!=IntPtr.Zero,"DESCENDANT_HANDLE");
                try{long c,e,k,u;bool owned;Require(GetProcessTimes(handle,out c,out e,out k,out u)&&IsProcessInJob(handle,job,out owned)&&owned,"DESCENDANT_IDENTITY");Emit(new {eventName="descendant",pid=pid,created=c.ToString(),ownerPid=child.Pid});}finally{CloseHandle(handle);}
                if(pause=="Descendant")Thread.Sleep(30000);
              }
            }
            if(fault=="ReportFailure")throw new IOException(fault);
            line=reader.ReadLineAsync();
          }
          if(WaitForSingleObject(child.Process,0)==0)throw new IOException("CHILD_EXITED");
        }
        Require(handshake&&ready,"NOT_READY");
      } catch(Exception e) { failure=e.Message; }
      finally {
        // Normal cleanup queries while this live owner handle is still held; no query of a closed job.
        if(job!=IntPtr.Zero) {
          bool terminated=TerminateJobObject(job,0);var deadline=Stopwatch.StartNew();Accounting accounting=new Accounting();bool queried=false;
          while(deadline.ElapsedMilliseconds<5000) { queried=QueryInformationJobObject(job,1,out accounting,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero);if(queried&&accounting.active==0)break;Thread.Sleep(20); }
          uint remaining=(uint)Math.Max(0,5000-deadline.ElapsedMilliseconds);
          childExitObserved=hasChild?(bool?)(WaitForSingleObject(child.Process,remaining)==0):null;
          clean=terminated&&queried&&accounting.active==0&&(!hasChild||childExitObserved==true);
          CloseHandle(job);job=IntPtr.Zero;
        } else clean=!hasChild;
        jobClean=clean;
        try {
          int[] ports=mode=="FixtureBrowser"?new[]{62334,62335,62336}:new[]{62333};
          portClosedObserved=!System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(x=>ports.Contains(x.Port)&&(x.Address.Equals(System.Net.IPAddress.Parse("127.0.0.2"))||x.Address.Equals(System.Net.IPAddress.Loopback)||x.Address.Equals(System.Net.IPAddress.Any)));
        }catch{portClosedObserved=null;if(failure==null)failure="PORT_OBSERVATION_FAILED";}
        if(portClosedObserved==false&&failure==null)failure="PORT_STILL_LISTENING";
        if(hasChild&&mode!="Fixture")clean=clean&&portClosedObserved==true;
        if(child.Thread!=IntPtr.Zero)CloseHandle(child.Thread);if(child.Process!=IntPtr.Zero)CloseHandle(child.Process);
        if(reader!=null)reader.Dispose();if(read!=IntPtr.Zero)CloseHandle(read);if(write!=IntPtr.Zero)CloseHandle(write);if(input!=null)input.Dispose();
        if(attrs!=IntPtr.Zero){DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);}if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
      }
    }
    return new {status=failure==null&&clean?"PASS":"HOLD",reason=failure??(clean?"TTL_COMPLETE":"UNKNOWN_RESIDUAL"),cleanupObserved=clean,jobCleanupObserved=jobClean,created=hasChild,childExitedObserved=childExitObserved,portClosedObserved=portClosedObserved,mode=mode,actualConfigChecked=mode=="Actual",actualKeysRead=mode=="Actual"?2:0,actualKeyReadScope="DISTINCT_CONFIG_API_KEY_VALUES",actualProviderKeyRequests=0};
    }finally{if(consumingOperator!=IntPtr.Zero)CloseHandle(consumingOperator);if(consumingFiles!=null)consumingFiles.Dispose();}
  }
  static object DeathTest(Dictionary<string,object> p) {
    string phase=Text(p,"phase");Require(new[]{"BeforeCreate","Suspended","Handshake","Descendant","AfterLaunchAck"}.Contains(phase),"FIXED_DEATH_PHASE");
    var pi=new ProcessStartInfo(PowerShell,"-NoLogo -NoProfile -NonInteractive -File "+Quote(Path.Combine(Root,"scripts","admin-preview-supervisor.ps1"))+" -Operation Supervise");pi.WorkingDirectory=Root;pi.UseShellExecute=false;pi.CreateNoWindow=true;pi.RedirectStandardInput=true;pi.RedirectStandardOutput=true;pi.RedirectStandardError=true;pi.EnvironmentVariables.Clear();foreach(var v in EnvironmentBlock())pi.EnvironmentVariables[v.Key]=v.Value;
    string pausePhase=phase=="AfterLaunchAck"?"Suspended":phase;PrivateRootLease handoffRoot=null;bool handoffRejected=false;
    var observed=new List<IntPtr>();var identities=new List<object>();bool reached=false,stopped=false;var watch=Stopwatch.StartNew();
    using(Process parent=Process.Start(pi)) {
      parent.StandardInput.Write(Json.Serialize(new {mode="Fixture",pause=pausePhase}));parent.StandardInput.Close();var error=parent.StandardError.ReadToEndAsync();var line=parent.StandardOutput.ReadLineAsync();
      try {
        while(watch.ElapsedMilliseconds<20000&&!parent.HasExited) {
          if(!line.Wait(100))continue;string text=line.Result;if(text==null)break;var item=Json.Deserialize<Dictionary<string,object>>(text);
          if(item.ContainsKey("pid")&&Convert.ToInt32(item["pid"])!=parent.Id) { int pid=Convert.ToInt32(item["pid"]);var h=OpenProcess(SYNCHRONIZE|QUERY,false,pid);Require(h!=IntPtr.Zero,"OBSERVE_HANDLE");observed.Add(h);long c,e,k,u;Require(GetProcessTimes(h,out c,out e,out k,out u)&&c.ToString()==Text(item,"created"),"OBSERVE_CREATION_MISMATCH");identities.Add(new {pid=pid,created=c.ToString(),matched=true}); }
          bool target=(item.ContainsKey("phase")&&Text(item,"phase")==pausePhase)||(phase=="Descendant"&&item.ContainsKey("eventName")&&Text(item,"eventName")=="descendant");
          if(target){reached=true;break;}line=parent.StandardOutput.ReadLineAsync();
        }
        Require(reached,"DEATH_PHASE_NOT_REACHED");bool lockRejected=false;
        if(p.ContainsKey("lockProbe")&&(bool)p["lockProbe"]) {
          // Only another fixed fixture supervisor is launched. Its failure must not affect the owner.
          using(Process contender=Process.Start(pi)) {
            contender.StandardInput.Write(Json.Serialize(new {mode="Fixture"}));contender.StandardInput.Close();var output=contender.StandardOutput.ReadToEndAsync();var err=contender.StandardError.ReadToEndAsync();
            if(!contender.WaitForExit(10000)){contender.Kill();throw new IOException("LOCK_PROBE_TIMEOUT");}
            lockRejected=contender.ExitCode!=0&&output.Result.Contains("HOLD")&&!parent.HasExited;Require(lockRejected,"LOCK_NOT_EXCLUSIVE");Require(err.Result.Length<4096,"LOCK_PROBE_OUTPUT");
          }
        }
        if(phase=="AfterLaunchAck"){
          Require(identities.Count==1,"HANDOFF_FIXTURE_CHILD");var childIdentity=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(identities[0]));
          var made=Json.Deserialize<Dictionary<string,object>>(Json.Serialize(CreateFixture(new Dictionary<string,object>())));
          string fixtureRoot=OwnedFixture(new Dictionary<string,object>{{"root",made["root"]},{"rootId",made["rootId"]},{"nonce",made["nonce"]}});
          handoffRoot=new PrivateRootLease(fixtureRoot,"handoff-proof",fixtureRoot,true);long start=Stopwatch.GetTimestamp();
          var launch=new Dictionary<string,object>{{"operatorPid",childIdentity["pid"]},{"operatorCreated",childIdentity["created"]},{"operatorImage",Node},{"setupStartQpc",start.ToString()},{"setupDeadlineQpc",checked(start+Stopwatch.Frequency*300L).ToString()},{"fixture",true}};
          SecureCreate(Path.Combine(handoffRoot.PathName,"synthetic-launch-ack.json"),Encoding.UTF8.GetBytes(Json.Serialize(launch)),false);
          IntPtr live=OpenBoundOperator(launch,false);CloseHandle(live);RequireSetupDeadline(launch);
          Require(!File.Exists(Path.Combine(handoffRoot.PathName,"host-runtime.json")),"HANDOFF_FIXTURE_NO_HOST_BEFORE_DEATH");
        }
        parent.Kill();Require(parent.WaitForExit(5000),"PARENT_NOT_EXITED");
        var deadline=Stopwatch.StartNew();while(deadline.ElapsedMilliseconds<5000&&observed.Any(h=>WaitForSingleObject(h,0)!=0))Thread.Sleep(25);stopped=observed.All(h=>WaitForSingleObject(h,0)==0);
        Require(stopped,"UNKNOWN_DESCENDANT_RESIDUAL");
        if(phase=="AfterLaunchAck"){
          var saved=Json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(PrivateRead(Path.Combine(handoffRoot.PathName,"synthetic-launch-ack.json"),8192)));
          try{IntPtr live=OpenBoundOperator(saved,false);CloseHandle(live);RequireSetupDeadline(saved);SecureCreate(Path.Combine(handoffRoot.PathName,"host-runtime.json"),Encoding.UTF8.GetBytes("SYNTHETIC_MUST_NOT_CREATE"),false);}
          catch(IOException){handoffRejected=true;}
          Require(handoffRejected&&!File.Exists(Path.Combine(handoffRoot.PathName,"host-runtime.json")),"DEAD_OPERATOR_REPLAY_MUST_NOT_CREATE_HOST");
        }

        return new {status="PASS",phase=phase,processHandles=observed.Count,identities=identities,allObservedExited=stopped,lockContenderRejected=lockRejected,jobHandleDuplicated=false,closedJobQueried=false,syscallInterior="NOT_OBSERVABLE",afterLaunchAckReplayRejected=handoffRejected,actualBrandRegistered=false,actualConfigRead=false,operatorFixtureParentConstraint="ACTUAL_REQUIRES_IMMEDIATE_PARENT; DEATH_PROBE_CHECKS_SAME_LIVENESS_WITHOUT_PARENT"};
      } finally { if(!parent.HasExited){parent.Kill();parent.WaitForExit(5000);}foreach(var h in observed)CloseHandle(h);if(handoffRoot!=null)handoffRoot.Dispose(); }
    }
  }
  public static void Run(string root,string operation,string request) {
    Require(OperationRootLease==null,"OPERATION_ROOT_ALREADY_HELD");Root=Full(root);Components(Root,false);var p=Json.Deserialize<Dictionary<string,object>>(request);object result;
    try{
    if(operation=="Inspect") { var items=((System.Collections.IEnumerable)p["paths"]).Cast<object>().ToArray();Require(items.Length<=128,"PATH_COUNT");result=new {status="PASS",items=items.Select(x=>Inspect((string)x)).ToArray(),contentsRead=0}; }
    else if(operation=="CreateFixture")result=CreateFixture(p);
    else if(operation=="VerifyFixture")result=new {status="PASS",root=OwnedFixture(p)};
    else if(operation=="WriteFixture")result=WriteFixture(p);
    else if(operation=="ReadFixture") { string f=Text(p,"root");FixtureRoot(f);var files=new Dictionary<string,string>();foreach(string relative in new[]{"package.json",".local-data/cloud-admin/activation-proof.json",".local-data/cloud-admin/admin-server.json"})files[relative]=Convert.ToBase64String(ReadBound(Path.Combine(f,relative.Replace('/',Path.DirectorySeparatorChar)),65536));result=new {status="PASS",files=files}; }
    else if(operation=="PrivateFixture")result=PrivateFixture(p);
    else if(operation=="Supervise")result=Supervise(p);
    else if(operation=="DeathTest")result=DeathTest(p);
    else if(operation=="CreateActual"){Require(p.Count==0,"ACTUAL_CREATE_ARGUMENTS");result=new{status="PASS",root=ActualRoot(true),createdExclusive=true};}
    else if(operation=="WriteActualFile")result=ActualFile(p,true);
    else if(operation=="ReadActualFile")result=ActualFile(p,false);
    else if(operation=="ReadActual")result=ActualRead(p);
    else if(operation=="AppendActualJournal")result=ActualJournal(p);
    else if(operation=="ReadActualJournal")result=ReadActualJournal(p);
    else if(operation=="ActualStatus")result=ActualStatus(p);
    else if(operation=="DeleteActualSecrets")result=DeleteActualSecrets(p);
    else if(operation=="OperatorIdentity")result=OperatorIdentity(p);
    else if(operation=="Clock"){Require(p.Count==0,"CLOCK_ARGUMENTS");result=new{status="PASS",qpc=Stopwatch.GetTimestamp().ToString(),frequency=Stopwatch.Frequency.ToString()};}
    else if(operation=="ReadOperatorToken"){
      Require(p.Count==0,"TOKEN_ARGUMENTS");string file=Path.Combine(Root,".local-data","cloud-auth","cli-home","access-token");
      using(var held=new Held(HoldParents(Path.GetDirectoryName(file))))result=new{status="PASS",bytes=Convert.ToBase64String(PrivateRead(file,8192,false))};
    }
    else throw new IOException("OPERATION");
    Emit(result);
    }finally{if(OperationRootLease!=null){OperationRootLease.Dispose();OperationRootLease=null;}}
  }
}
