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
    string mode=Text(p,"mode");Require(mode=="Fixture"||mode=="FixtureBrowser"||mode=="Preview","FIXED_MODE");
    string fault=p.ContainsKey("fault")?Text(p,"fault"):"NONE",pause=p.ContainsKey("pause")?Text(p,"pause"):"NONE";
    Require(new[]{"NONE","BeforeCreate","AfterCreate","BeforeResume","HandshakeTimeout","ReaderFailure","ReportFailure"}.Contains(fault),"FIXED_FAULT");Require(new[]{"NONE","BeforeCreate","Suspended","Handshake","Descendant"}.Contains(pause),"FIXED_PAUSE");
    Require(mode!="Preview"||fault=="NONE"&&pause=="NONE","PREVIEW_FAULT_REJECTED");
    Preflight();
    string dir=OwnDirectory(OwnDirectory(Root,".local-data"),"admin-c1b");
    Components(Path.Combine(dir,"supervisor.lock"),true);
    IntPtr job=IntPtr.Zero,attrs=IntPtr.Zero,jobs=IntPtr.Zero,handles=IntPtr.Zero,read=IntPtr.Zero,write=IntPtr.Zero,environment=IntPtr.Zero;SafeFileHandle input=null;ProcessInfo child=new ProcessInfo();bool hasChild=false,clean=false;string failure=null;var watch=Stopwatch.StartNew();StreamReader reader=null;
    // Holding this handle never permits deleting another run's lock after an expiry.
    using(FileStream ownLock=new FileStream(Path.Combine(dir,"supervisor.lock"),FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) {
      Info(ownLock.SafeFileHandle);Components(Path.Combine(dir,"supervisor.lock"),false);
      try {
        // No listener is killed. The entry also treats EADDRINUSE as a fatal own-run failure.
        var listeners=System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
        Require(!listeners.Any(x=>x.Port==62333&&(x.Address.Equals(System.Net.IPAddress.Parse("127.0.0.2"))||x.Address.Equals(System.Net.IPAddress.Any))),"PORT_COLLISION");
        job=CreateJobObject(IntPtr.Zero,null);Require(job!=IntPtr.Zero,"JOB_CREATE");
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
        Require(CreateProcess(Node,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x80000|0x400|4|0x08000000,environment,Root,ref startup,out child),"CREATE_WITH_JOB_LIST");hasChild=true;
        bool member;Require(IsProcessInJob(child.Process,job,out member)&&member,"OWN_JOB_MEMBERSHIP");long created,exit,kernel,user;Require(GetProcessTimes(child.Process,out created,out exit,out kernel,out user),"CREATION_TIME");var image=new StringBuilder(32768);int imageLength=image.Capacity;Require(QueryFullProcessImageName(child.Process,0,image,ref imageLength)&&image.ToString().Equals(Node,StringComparison.OrdinalIgnoreCase),"FIXED_IMAGE");
        Emit(new {eventName="phase",phase="Suspended",pid=child.Pid,created=created.ToString()});
        if(pause=="Suspended")Thread.Sleep(30000);if(fault=="AfterCreate"||fault=="BeforeResume")throw new IOException(fault);
        Require(ResumeThread(child.Thread)!=INVALID,"RESUME");CloseHandle(child.Thread);child.Thread=IntPtr.Zero;CloseHandle(write);write=IntPtr.Zero;
        reader=new StreamReader(new FileStream(new SafeFileHandle(read,true),FileAccess.Read),Encoding.UTF8);read=IntPtr.Zero;
        bool handshake=false,ready=false;Task<string> line=reader.ReadLineAsync();int outputBytes=0;long started=watch.ElapsedMilliseconds;
        while(watch.ElapsedMilliseconds-started<(mode=="Preview"||mode=="FixtureBrowser"?90000:6500)) {
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
          clean=terminated&&queried&&accounting.active==0&&(!hasChild||WaitForSingleObject(child.Process,remaining)==0);
          if(hasChild&&mode!="Fixture") {
            int[] ports=mode=="Preview"?new[]{62333}:new[]{62334,62335,62336};
            bool listening=System.Net.NetworkInformation.IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(x=>ports.Contains(x.Port)&&(x.Address.Equals(System.Net.IPAddress.Parse("127.0.0.2"))||x.Address.Equals(System.Net.IPAddress.Loopback)||x.Address.Equals(System.Net.IPAddress.Any)));
            clean=clean&&!listening;
          }
          CloseHandle(job);job=IntPtr.Zero;
        } else clean=!hasChild;
        if(child.Thread!=IntPtr.Zero)CloseHandle(child.Thread);if(child.Process!=IntPtr.Zero)CloseHandle(child.Process);
        if(reader!=null)reader.Dispose();if(read!=IntPtr.Zero)CloseHandle(read);if(write!=IntPtr.Zero)CloseHandle(write);if(input!=null)input.Dispose();
        if(attrs!=IntPtr.Zero){DeleteProcThreadAttributeList(attrs);Marshal.FreeHGlobal(attrs);}if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(environment!=IntPtr.Zero)Marshal.FreeHGlobal(environment);
      }
    }
    return new {status=failure==null&&clean?"PASS":"HOLD",reason=failure??(clean?"TTL_COMPLETE":"UNKNOWN_RESIDUAL"),cleanupObserved=clean,created=hasChild,mode=mode,actualKeysRead=0};
  }
  static object DeathTest(Dictionary<string,object> p) {
    string phase=Text(p,"phase");Require(new[]{"BeforeCreate","Suspended","Handshake","Descendant"}.Contains(phase),"FIXED_DEATH_PHASE");
    var pi=new ProcessStartInfo(PowerShell,"-NoLogo -NoProfile -NonInteractive -File "+Quote(Path.Combine(Root,"scripts","admin-preview-supervisor.ps1"))+" -Operation Supervise");pi.WorkingDirectory=Root;pi.UseShellExecute=false;pi.CreateNoWindow=true;pi.RedirectStandardInput=true;pi.RedirectStandardOutput=true;pi.RedirectStandardError=true;pi.EnvironmentVariables.Clear();foreach(var v in EnvironmentBlock())pi.EnvironmentVariables[v.Key]=v.Value;
    var observed=new List<IntPtr>();var identities=new List<object>();bool reached=false,stopped=false;var watch=Stopwatch.StartNew();
    using(Process parent=Process.Start(pi)) {
      parent.StandardInput.Write(Json.Serialize(new {mode="Fixture",pause=phase}));parent.StandardInput.Close();var error=parent.StandardError.ReadToEndAsync();var line=parent.StandardOutput.ReadLineAsync();
      try {
        while(watch.ElapsedMilliseconds<20000&&!parent.HasExited) {
          if(!line.Wait(100))continue;string text=line.Result;if(text==null)break;var item=Json.Deserialize<Dictionary<string,object>>(text);
          if(item.ContainsKey("pid")&&Convert.ToInt32(item["pid"])!=parent.Id) { int pid=Convert.ToInt32(item["pid"]);var h=OpenProcess(SYNCHRONIZE|QUERY,false,pid);Require(h!=IntPtr.Zero,"OBSERVE_HANDLE");observed.Add(h);long c,e,k,u;Require(GetProcessTimes(h,out c,out e,out k,out u)&&c.ToString()==Text(item,"created"),"OBSERVE_CREATION_MISMATCH");identities.Add(new {pid=pid,created=c.ToString(),matched=true}); }
          bool target=(item.ContainsKey("phase")&&Text(item,"phase")==phase)||(phase=="Descendant"&&item.ContainsKey("eventName")&&Text(item,"eventName")=="descendant");
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
        parent.Kill();Require(parent.WaitForExit(5000),"PARENT_NOT_EXITED");
        var deadline=Stopwatch.StartNew();while(deadline.ElapsedMilliseconds<5000&&observed.Any(h=>WaitForSingleObject(h,0)!=0))Thread.Sleep(25);stopped=observed.All(h=>WaitForSingleObject(h,0)==0);
        Require(stopped,"UNKNOWN_DESCENDANT_RESIDUAL");
        return new {status="PASS",phase=phase,processHandles=observed.Count,identities=identities,allObservedExited=stopped,lockContenderRejected=lockRejected,jobHandleDuplicated=false,closedJobQueried=false,syscallInterior="NOT_OBSERVABLE"};
      } finally { if(!parent.HasExited){parent.Kill();parent.WaitForExit(5000);}foreach(var h in observed)CloseHandle(h); }
    }
  }
  public static void Run(string root,string operation,string request) {
    Root=Full(root);Components(Root,false);var p=Json.Deserialize<Dictionary<string,object>>(request);object result;
    if(operation=="Inspect") { var items=((System.Collections.IEnumerable)p["paths"]).Cast<object>().ToArray();Require(items.Length<=128,"PATH_COUNT");result=new {status="PASS",items=items.Select(x=>Inspect((string)x)).ToArray(),contentsRead=0}; }
    else if(operation=="CreateFixture")result=CreateFixture(p);
    else if(operation=="VerifyFixture")result=new {status="PASS",root=OwnedFixture(p)};
    else if(operation=="WriteFixture")result=WriteFixture(p);
    else if(operation=="ReadFixture") { string f=Text(p,"root");FixtureRoot(f);var files=new Dictionary<string,string>();foreach(string relative in new[]{"package.json",".local-data/cloud-admin/activation-proof.json",".local-data/cloud-admin/admin-server.json"})files[relative]=Convert.ToBase64String(ReadBound(Path.Combine(f,relative.Replace('/',Path.DirectorySeparatorChar)),65536));result=new {status="PASS",files=files}; }
    else if(operation=="Supervise")result=Supervise(p);
    else if(operation=="DeathTest")result=DeathTest(p);
    else throw new IOException("OPERATION");
    Emit(result);
  }
}
