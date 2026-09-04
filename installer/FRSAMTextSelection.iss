#define AppName "FR SAM Text Selection Backend"
#define AppVersion "0.9.0"
#define Publisher "FR"

[Setup]
AppId={{3E3D3D80-1A69-4EE8-B9F4-A66D979C873A}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
DefaultDirName={localappdata}\Programs\FR\FR SAM Text Selection
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
MinVersion=10.0
PrivilegesRequired=lowest
Compression=lzma2/max
SolidCompression=yes
OutputDir=dist
OutputBaseFilename=FR-SAM-Text-Selection-Backend-{#AppVersion}-Windows-x64
SetupLogging=yes
UninstallDisplayIcon={app}\runtime\python.exe
WizardStyle=modern
LicenseFile=stage\payload\licenses\INSTALL-NOTICE.txt
CloseApplications=no
RestartApplications=no

[Files]
Source: "stage\payload\backend\*"; DestDir: "{app}\backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\payload\vendor\sam3\*"; DestDir: "{app}\vendor\sam3"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\payload\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\payload\installer\Install-OnlineRuntime.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "stage\payload\installer\runtime-requirements.txt"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "stage\payload\scripts\FR SAM Text Selection Image Processor.jsx"; DestDir: "{userappdata}\Adobe\Adobe Photoshop 2025\Presets\Scripts"; Flags: ignoreversion
Source: "stage\payload\scripts\FR SAM Text Selection Image Processor.jsx"; DestDir: "{userappdata}\Adobe\Adobe Photoshop 2026\Presets\Scripts"; Flags: ignoreversion
Source: "tools\Check-NvidiaGpu.ps1"; Flags: dontcopy

[Code]
var
  ModelChoicePage: TInputOptionWizardPage;
  ModelFilePage: TInputFileWizardPage;

function DataRoot: String;
begin
  Result := ExpandConstant('{localappdata}\FR\FR SAM Text Selection');
end;

procedure InitializeWizard;
var
  CommandLineModel: String;
begin
  ModelChoicePage := CreateInputOptionPage(
    wpSelectDir,
    'SAM 3.1 模型',
    '选择模型来源',
    '可以复用已有模型，或由安装器从 Comfy-Org 官方模型仓库下载固定文件。安装完成后推理完全离线。',
    True,
    False
  );
  ModelChoicePage.Add('复用本机已有 sam3.1_multiplex_fp16.safetensors');
  ModelChoicePage.Add('下载固定 SAM 3.1 模型（约 1.75 GB）');

  ModelFilePage := CreateInputFilePage(
    ModelChoicePage.ID,
    '已有模型文件',
    '选择要复用的模型',
    '安装器只校验并引用该文件，不会复制或在卸载时删除它。'
  );
  ModelFilePage.Add('模型文件：', 'Safetensors 模型|*.safetensors|所有文件|*.*', '.safetensors');

  CommandLineModel := ExpandConstant('{param:ModelFile|}');
  if (CommandLineModel <> '') and FileExists(CommandLineModel) then begin
    ModelChoicePage.SelectedValueIndex := 0;
    ModelFilePage.Values[0] := CommandLineModel;
  end else begin
    ModelChoicePage.SelectedValueIndex := 1;
  end;
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = ModelFilePage.ID) and (ModelChoicePage.SelectedValueIndex <> 0);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = ModelFilePage.ID) and
     (ModelChoicePage.SelectedValueIndex = 0) and
     (not FileExists(ModelFilePage.Values[0])) then begin
    MsgBox('请选择存在的 SAM 3.1 safetensors 模型文件。', mbError, MB_OK);
    Result := False;
  end;
end;

function RunPowerShell(const ScriptPath, Parameters: String; var ResultCode: Integer): Boolean;
var
  FullParameters: String;
begin
  FullParameters :=
    '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ScriptPath + '" ' + Parameters;
  Result := Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    FullParameters,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  Result := '';
  ExtractTemporaryFile('Check-NvidiaGpu.ps1');
  if (not RunPowerShell(ExpandConstant('{tmp}\Check-NvidiaGpu.ps1'), '', ResultCode)) or
     (ResultCode <> 0) then
    Result := '未通过 NVIDIA GPU 检查。需要 Windows 10/11、NVIDIA 驱动和至少 16 GB 级显存。';
end;

procedure InstallOnlineRuntime;
var
  ResultCode: Integer;
  Parameters: String;
  Mode: String;
begin
  WizardForm.StatusLabel.Caption := '正在下载并安装固定本地推理运行时。首次安装时间取决于网络速度……';
  WizardForm.ProgressGauge.Style := npbstMarquee;
  if ModelChoicePage.SelectedValueIndex = 0 then Mode := 'existing'
  else Mode := 'download';

  Parameters :=
    '-InstallRoot "' + ExpandConstant('{app}') + '" ' +
    '-DataRoot "' + DataRoot + '" ' +
    '-ModelMode "' + Mode + '" ' +
    '-RequirementsPath "' + ExpandConstant('{app}\installer\runtime-requirements.txt') + '" ' +
    '-LogPath "' + DataRoot + '\install-runtime.log"';
  if Mode = 'existing' then
    Parameters := Parameters + ' -ModelPath "' + ModelFilePage.Values[0] + '"';

  Log('Launching fixed runtime installer with mode=' + Mode +
      ', modelPathSet=' + IntToStr(Ord(ModelFilePage.Values[0] <> '')));
  if (not RunPowerShell(
        ExpandConstant('{app}\installer\Install-OnlineRuntime.ps1'),
        Parameters,
        ResultCode
      )) or (ResultCode <> 0) then
    RaiseException(
      '固定推理运行时安装或自检失败（退出码 ' + IntToStr(ResultCode) +
      '）。请查看安装日志，确认网络、NVIDIA 驱动和磁盘空间后重试。'
    );
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    InstallOnlineRuntime;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Root: String;
  Marker: String;
begin
  if CurUninstallStep = usUninstall then begin
    Root := DataRoot;
    DeleteFile(Root + '\runtime-v2.ini');
    DelTree(Root + '\Logs', True, True, True);
    Marker := Root + '\downloaded-model.marker';
    if FileExists(Marker) and
       (MsgBox(
          '安装器下载的 SAM 3.1 模型默认保留，便于以后重装。是否同时删除该模型？',
          mbConfirmation,
          MB_YESNO or MB_DEFBUTTON2
        ) = IDYES) then begin
      DelTree(Root + '\Models', True, True, True);
      DeleteFile(Marker);
    end;
  end;
end;
